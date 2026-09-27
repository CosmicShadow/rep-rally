/**
 * The AI coach: builds the prompt from the user's log and streams a reply
 * from the Anthropic Messages API straight from the browser, using a key the
 * user supplies. Works in the browser (window.RepCoach) and in Node tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./stats.js"));
  else root.RepCoach = factory(root.RepStats);
})(typeof self !== "undefined" ? self : this, function (Stats) {
  "use strict";

  const API_URL = "https://api.anthropic.com/v1/messages";

  const MODELS = [
    { id: "claude-opus-5", label: "Claude Opus 5 (best answers)" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5 (balanced)" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest, cheapest)" }
  ];
  const DEFAULT_MODEL = MODELS[0].id;

  const PEP_LINES = [
    "Nobody ever regretted the workout they finished. Go get one more.",
    "Small plates add up. Add 2.5 kg or one more rep than last time.",
    "Show up today. Motivation follows action, not the other way around.",
    "Your streak is counting on you. Even 20 minutes keeps it alive.",
    "Hard days build strong people. Warm up, then go to work."
  ];

  const TONES = {
    cheer: "an upbeat cheerleader coach: warm, energetic, celebrates wins, then pushes for a bit more",
    drill: "a tough-love drill sergeant: blunt, loud energy, short punchy sentences, demanding but never insulting or body-shaming"
  };

  /** Plain-text snapshot of the user's training that the model can reason over. */
  function describeTraining(state, today) {
    const units = state.settings.units === "imperial" ? { w: "lb", d: "mi" } : { w: "kg", d: "km" };
    const s = Stats.summary(state.workouts, today);
    const recent = Stats.sortByDateDesc(state.workouts).slice(0, 20)
      .map(w => "- " + w.date + " " + Stats.TYPES[w.type].label + ": " + w.name + " (" + Stats.detail(w, units) + ")" + (w.notes ? " notes: " + w.notes : ""))
      .join("\n") || "(none logged yet)";
    const prs = Stats.records(state.workouts).slice(0, 6)
      .map(p => "- " + p.name + ": " + p.weight + " " + units.w + " x " + (p.reps || "?"))
      .join("\n") || "(none)";
    const onlyExamples = state.workouts.length > 0 && state.workouts.every(w => w.example);
    return [
      "Today is " + Stats.ymd(today) + ". User name: " + (state.settings.name || "not given") + ". Units: " + units.w + "/" + units.d + ".",
      "Weekly goal: " + state.settings.goal + " workouts. This week so far: " + s.sessions + " workouts, " + s.minutes + " minutes. Current streak: " + s.streak + " days. " +
        "Average effort (RPE) last 2 weeks: " + (s.avgRpe ? s.avgRpe.toFixed(1) : "n/a") + ".",
      onlyExamples ? "NOTE: the log below is example data, not the user's own; encourage them to log their first real workout." : "",
      "Recent workouts (newest first):\n" + recent,
      "Heaviest lifts:\n" + prs
    ].filter(Boolean).join("\n");
  }

  function systemPrompt(state, today) {
    return "You are Coach inside Rep Rally, a phone workout tracker. Your style is " + (TONES[state.tone] || TONES.cheer) + ".\n" +
      "Latency-sensitive; begin your visible answer immediately. Reply in under 110 words, plain text for a small phone screen, " +
      "with at most 4 short bullet lines using '- '. Use the user's real numbers when relevant. " +
      "Motivate them to push harder safely: progressive overload of about 2.5-10% or one more rep, a proper warm-up, sleep and rest days, " +
      "and stopping if something hurts. You are not a doctor; for pain, injury or medical questions, tell them to check with a professional.\n\n" +
      "USER DATA:\n" + describeTraining(state, today);
  }

  /** Last `max` chat turns, trimmed so the list starts on a user turn as the API requires. */
  function trimHistory(chat, max = 12) {
    const turns = chat.slice(-max).map(m => ({ role: m.role, content: m.content }));
    while (turns.length && turns[0].role !== "user") turns.shift();
    return turns;
  }

  /** Request headers and body for one streamed coach reply. */
  function buildRequest({ apiKey, model, system, messages }) {
    const headers = {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // Required for calls made directly from a browser page.
      "anthropic-dangerous-direct-browser-access": "true"
    };
    const body = { model, max_tokens: 4096, stream: true, system, messages };
    if (model !== "claude-haiku-4-5") body.output_config = { effort: "low" }; // quick chat replies
    if (model === "claude-opus-5") {
      // If a safety classifier declines, let the API retry on its recommended fallback model.
      headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
      body.fallbacks = "default";
    }
    return { headers, body };
  }

  /**
   * Incremental Server-Sent Events parser. Feed it text chunks; it calls
   * onEvent(parsedJson) for every complete `data:` line.
   */
  function createSSEParser(onEvent) {
    let buf = "";
    return function feed(chunk) {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, "");
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        try { onEvent(JSON.parse(data)); } catch (e) { /* ignore keep-alives and partial junk */ }
      }
    };
  }

  class CoachError extends Error {
    constructor(code, message, partial) { super(message); this.code = code; this.partial = partial || ""; }
  }

  const HTTP_ERRORS = {
    400: ["bad_request", "The request was rejected. Try a different model in Settings."],
    401: ["bad_key", "That API key didn't work. Check it in Settings."],
    403: ["bad_key", "That API key doesn't have access to this model."],
    404: ["bad_model", "This model isn't available to your key. Pick another one in Settings."],
    429: ["rate_limited", "Too many requests. Wait a minute and try again."],
    529: ["overloaded", "The AI service is busy right now. Try again shortly."]
  };

  /** Streams one reply. Resolves with the full text; rejects with CoachError. */
  async function streamReply({ apiKey, model, system, messages, signal, onText, fetchImpl }) {
    const { headers, body } = buildRequest({ apiKey, model, system, messages });
    let res;
    try {
      res = await (fetchImpl || fetch)(API_URL, { method: "POST", headers, body: JSON.stringify(body), signal });
    } catch (e) {
      if (e && e.name === "AbortError") throw new CoachError("cancelled", "Stopped.");
      throw new CoachError("network", "Couldn't reach the coach. Check your connection.");
    }
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).error.message; } catch (e) { /* no JSON body */ }
      const [code, msg] = HTTP_ERRORS[res.status] || ["server", "The AI service had a problem (" + res.status + "). Try again."];
      throw new CoachError(code, msg + (detail && code === "bad_request" ? " (" + detail + ")" : ""));
    }

    let text = "", stopReason = null, streamError = null;
    const feed = createSSEParser(ev => {
      if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") {
        text += ev.delta.text;
        if (onText) onText(text);
      } else if (ev.type === "message_delta" && ev.delta) {
        stopReason = ev.delta.stop_reason || stopReason;
      } else if (ev.type === "error") {
        streamError = ev.error || { type: "server" };
      }
    });

    const reader = res.body.getReader(), decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        feed(decoder.decode(value, { stream: true }));
      }
      feed(decoder.decode() + "\n");
    } catch (e) {
      if (e && e.name === "AbortError") throw new CoachError("cancelled", "Stopped.", text);
      throw new CoachError("network", "The connection dropped mid-reply.", text);
    }

    if (streamError) {
      const code = streamError.type === "overloaded_error" ? "overloaded" : "server";
      throw new CoachError(code, code === "overloaded" ? HTTP_ERRORS[529][1] : "The reply was interrupted. Try again.", text);
    }
    if (stopReason === "refusal") throw new CoachError("refused", "The coach can't help with that one. Try asking another way.");
    if (!text.trim()) throw new CoachError("empty", "The coach didn't reply. Try asking again.");
    return text;
  }

  const pepLine = (rand = Math.random) => PEP_LINES[Math.floor(rand() * PEP_LINES.length)];

  return { API_URL, MODELS, DEFAULT_MODEL, PEP_LINES, describeTraining, systemPrompt, trimHistory, buildRequest, createSSEParser, streamReply, CoachError, pepLine };
});
