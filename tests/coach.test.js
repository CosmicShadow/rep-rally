const test = require("node:test");
const assert = require("node:assert/strict");
const Coach = require("../js/coach.js");

const TODAY = new Date(2025, 8, 10);
const state = (over = {}) => Object.assign({
  workouts: [{ id: "a", date: "2025-09-10", type: "strength", name: "Squats", minutes: 40, sets: 5, reps: 5, weight: 80, rpe: 8 }],
  settings: { name: "Sam", goal: 4, units: "metric" },
  tone: "cheer"
}, over);

/** A fake fetch that streams the given SSE text in small chunks. */
function fakeFetch(sse, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ error: { message: "nope" } }),
    body: {
      getReader() {
        const bytes = new TextEncoder().encode(sse);
        let i = 0;
        return { read: async () => (i >= bytes.length ? { done: true } : { done: false, value: bytes.slice(i, (i += 7)) }) };
      }
    }
  });
}
const sse = events => events.map(e => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join("");
const delta = text => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });

test("system prompt includes the user's numbers and tone", () => {
  const p = Coach.systemPrompt(state({ tone: "drill" }), TODAY);
  assert.match(p, /drill sergeant/);
  assert.match(p, /User name: Sam/);
  assert.match(p, /Squats \(5×5 @ 80 kg/);
  assert.doesNotMatch(p, /example data/);
});

test("system prompt flags example-only logs", () => {
  const p = Coach.systemPrompt(state({ workouts: [{ id: "x", date: "2025-09-09", type: "cardio", name: "Run", minutes: 30, example: true }] }), TODAY);
  assert.match(p, /example data/);
});

test("trimHistory keeps recent turns and starts on a user turn", () => {
  const chat = [];
  for (let i = 0; i < 10; i++) chat.push({ role: "user", content: "q" + i }, { role: "assistant", content: "a" + i });
  chat.push({ role: "user", content: "last" });
  const t = Coach.trimHistory(chat, 4);
  assert.equal(t[0].role, "user");
  assert.equal(t[t.length - 1].content, "last");
  assert.ok(t.length <= 4);
});

test("buildRequest sets browser headers and model-specific options", () => {
  const opus = Coach.buildRequest({ apiKey: "k", model: "claude-opus-5", system: "s", messages: [] });
  assert.equal(opus.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(opus.headers["anthropic-version"], "2023-06-01");
  assert.equal(opus.body.fallbacks, "default");
  assert.equal(opus.body.output_config.effort, "low");
  assert.equal(opus.body.stream, true);

  const haiku = Coach.buildRequest({ apiKey: "k", model: "claude-haiku-4-5", system: "s", messages: [] });
  assert.equal(haiku.body.output_config, undefined);
  assert.equal(haiku.body.fallbacks, undefined);
  assert.equal(haiku.headers["anthropic-beta"], undefined);
});

test("SSE parser handles events split across chunks", () => {
  const seen = [];
  const feed = Coach.createSSEParser(e => seen.push(e));
  feed('event: x\ndata: {"a":');
  feed('1}\n\ndata: {"b":2}\r\n');
  assert.deepEqual(seen, [{ a: 1 }, { b: 2 }]);
});

test("streamReply assembles streamed text", async () => {
  const updates = [];
  const text = await Coach.streamReply({
    apiKey: "k", model: "claude-opus-5", system: "s", messages: [{ role: "user", content: "hi" }],
    onText: t => updates.push(t),
    fetchImpl: fakeFetch(sse([{ type: "message_start" }, delta("Let's "), delta("go!"), { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" }]))
  });
  assert.equal(text, "Let's go!");
  assert.equal(updates[updates.length - 1], "Let's go!");
});

test("streamReply maps a 401 to a bad_key error", async () => {
  await assert.rejects(
    Coach.streamReply({ apiKey: "bad", model: "claude-opus-5", system: "s", messages: [], fetchImpl: fakeFetch("", 401) }),
    e => e.code === "bad_key"
  );
});

test("streamReply reports refusals", async () => {
  await assert.rejects(
    Coach.streamReply({ apiKey: "k", model: "claude-opus-5", system: "s", messages: [], fetchImpl: fakeFetch(sse([{ type: "message_delta", delta: { stop_reason: "refusal" } }])) }),
    e => e.code === "refused"
  );
});

test("streamReply keeps partial text when the stream errors", async () => {
  await assert.rejects(
    Coach.streamReply({ apiKey: "k", model: "claude-opus-5", system: "s", messages: [], fetchImpl: fakeFetch(sse([delta("Half"), { type: "error", error: { type: "overloaded_error" } }])) }),
    e => e.code === "overloaded" && e.partial === "Half"
  );
});
