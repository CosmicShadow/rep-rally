/** UI wiring: renders the four tabs and handles logging, settings and the coach chat. */
(function () {
  "use strict";
  const Stats = window.RepStats, Coach = window.RepCoach, Store = window.RepStorage;
  const { TYPES, ymd, parse, addDays, weekStart, startOfDay } = Stats;

  const COMMON = ["Squats", "Bench press", "Deadlift", "Overhead press", "Pull-ups", "Push-ups", "Run", "Walk", "Cycling", "Swim", "Yoga", "Stretching", "HIIT", "Basketball", "Soccer", "Pickleball"];
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const today = () => startOfDay(new Date());
  const short = d => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const S = Store.load(today());
  const save = () => Store.save(S);
  const units = () => (S.settings.units === "imperial" ? { w: "lb", d: "mi" } : { w: "kg", d: "km" });
  const hasExamples = () => S.workouts.some(w => w.example);
  const hasKey = () => Boolean(S.settings.apiKey);

  function relDay(s) {
    const diff = Math.round((today() - parse(s)) / 864e5);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff < 7) return parse(s).toLocaleDateString(undefined, { weekday: "long" });
    return short(parse(s));
  }

  /* ---------- home ---------- */
  function renderHome() {
    const s = Stats.summary(S.workouts, today()), goal = S.settings.goal, ws = weekStart(today());
    $("#hello").textContent = (S.settings.name ? "Let's go, " + S.settings.name : "Let's go") + "!";
    $("#weekLabel").textContent = short(ws) + " – " + short(addDays(ws, 6));

    const pct = Math.min(1, s.sessions / goal), C = 2 * Math.PI * 44;
    $("#ring").innerHTML =
      '<circle cx="54" cy="54" r="44" fill="none" stroke="var(--sunk)" stroke-width="12"/>' +
      '<circle cx="54" cy="54" r="44" fill="none" stroke="var(--accent)" stroke-width="12" stroke-linecap="round" transform="rotate(-90 54 54)" stroke-dasharray="' + C * pct + " " + C + '"/>' +
      '<text x="54" y="58" text-anchor="middle" font-size="30" fill="var(--ink)">' + s.sessions + "/" + goal + "</text>" +
      '<text x="54" y="76" text-anchor="middle" font-size="11" fill="var(--muted)" letter-spacing="1">WORKOUTS</text>';
    $("#sMin").textContent = s.minutes;
    $("#sStreak").textContent = s.streak;
    $("#sTotal").textContent = s.total;
    $("#sRpe").textContent = s.avgRpe ? s.avgRpe.toFixed(1) : "–";
    $("#exampleBanner").hidden = !hasExamples();

    const list = $("#recent"), items = Stats.sortByDateDesc(S.workouts).slice(0, 8);
    list.innerHTML = "";
    $("#recentCount").textContent = S.workouts.length ? "showing " + items.length + " of " + S.workouts.length : "";
    if (!items.length) {
      list.innerHTML = '<li class="empty">No workouts yet. Tap “Log workout” to add your first one.</li>';
      return;
    }
    items.forEach(w => list.appendChild(workoutRow(w)));
  }

  function workoutRow(w) {
    const li = document.createElement("li"); li.className = "item";
    const plate = document.createElement("span"); plate.className = "plate"; plate.style.background = TYPES[w.type].color;
    const mid = document.createElement("div");
    const nm = document.createElement("div"); nm.className = "name"; nm.textContent = w.name;
    if (w.example) { const t = document.createElement("span"); t.className = "tag"; t.textContent = "Example"; nm.appendChild(t); }
    const meta = document.createElement("div"); meta.className = "meta"; meta.textContent = relDay(w.date) + " · " + Stats.detail(w, units());
    mid.append(nm, meta);
    if (w.notes) { const n = document.createElement("div"); n.className = "meta note"; n.textContent = "“" + w.notes + "”"; mid.appendChild(n); }
    const del = document.createElement("button"); del.className = "del"; del.textContent = "Delete"; del.setAttribute("aria-label", "Delete " + w.name);
    del.onclick = () => {
      if (del.dataset.armed) { S.workouts = S.workouts.filter(x => x.id !== w.id); save(); renderAll(); toast("Deleted"); return; }
      del.dataset.armed = "1"; del.textContent = "Confirm?";
      setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = "Delete"; } }, 3000);
    };
    li.append(plate, mid, del);
    return li;
  }

  /* ---------- progress ---------- */
  function renderWeekChart() {
    const weeks = Stats.weeklyMinutes(S.workouts, today(), 8);
    const max = Math.max(60, ...weeks.map(w => w.minutes));
    const step = max <= 120 ? 30 : max <= 300 ? 60 : max <= 600 ? 120 : 240;
    const top = Math.ceil(max / step) * step;
    const L = 34, R = 312, T = 14, B = 146, H = B - T, bw = (R - L) / weeks.length;
    let g = "";
    for (let v = 0; v <= top; v += step) {
      const y = B - (v / top) * H;
      g += '<line x1="' + L + '" x2="' + R + '" y1="' + y + '" y2="' + y + '" stroke="var(--line)" stroke-width="1"/>' +
        '<text x="' + (L - 6) + '" y="' + (y + 3) + '" text-anchor="end">' + v + "</text>";
    }
    weeks.forEach((w, i) => {
      const h = (w.minutes / top) * H, x = L + i * bw + bw * 0.18, width = bw * 0.64, cur = i === weeks.length - 1;
      g += '<rect x="' + x + '" y="' + (B - h) + '" width="' + width + '" height="' + h + '" rx="3" fill="' + (cur ? "var(--accent)" : "var(--muted)") + '" opacity="' + (cur ? 1 : 0.45) + '"/>';
      if (w.minutes) g += '<text class="v" x="' + (x + width / 2) + '" y="' + (B - h - 4) + '" text-anchor="middle">' + w.minutes + "</text>";
      g += '<text x="' + (x + width / 2) + '" y="' + (B + 15) + '" text-anchor="middle">' + (cur ? "This wk" : w.start.getMonth() + 1 + "/" + w.start.getDate()) + "</text>";
    });
    $("#weekChart").innerHTML = g;
  }

  function renderMix() {
    const { counts, total } = Stats.typeMix(S.workouts, today(), 30);
    const bar = $("#mix"), legend = $("#mixLegend");
    bar.innerHTML = ""; legend.innerHTML = "";
    Object.keys(TYPES).forEach(k => {
      if (counts[k]) {
        const seg = document.createElement("div");
        seg.style.width = (counts[k] / total) * 100 + "%"; seg.style.background = TYPES[k].color;
        bar.appendChild(seg);
      }
      const l = document.createElement("span"), dot = document.createElement("i");
      dot.style.background = TYPES[k].color;
      l.append(dot, TYPES[k].label + " " + (total ? Math.round(((counts[k] || 0) / total) * 100) : 0) + "%");
      legend.appendChild(l);
    });
  }

  function renderRecords() {
    const prs = Stats.records(S.workouts), box = $("#prs"), u = units();
    if (!prs.length) { box.innerHTML = '<p class="empty">Log a strength workout with a weight to see your records.</p>'; return; }
    box.innerHTML = '<div class="pr"><span class="h">Lift</span><span class="h r">Best</span><span class="h r">Est. 1-rep max</span></div>';
    const grid = box.firstChild;
    prs.slice(0, 8).forEach(p => {
      const a = document.createElement("div"), name = document.createElement("div"), meta = document.createElement("div");
      name.style.fontWeight = "700"; name.textContent = p.name;
      meta.className = "meta"; meta.textContent = p.weight + " " + u.w + " × " + (p.reps || "?") + " · " + relDay(p.date);
      a.append(name, meta);
      const b = document.createElement("b"); b.className = "r num"; b.textContent = p.weight;
      const c = document.createElement("b"); c.className = "r num"; c.textContent = Math.round(p.e1rm * 2) / 2;
      grid.append(a, b, c);
    });
  }

  function renderSettings() {
    $("#sName").value = S.settings.name;
    $("#sUnits").value = S.settings.units;
    $("#sGoal").value = String(S.settings.goal);
    $("#sModel").value = S.settings.model;
    $("#sKey").value = S.settings.apiKey;
    $("#keyStatus").classList.toggle("on", hasKey());
    $("#keyStatus span").textContent = hasKey() ? "AI coach on" : "AI coach off";
    $("#removeKey").hidden = !hasKey();
    $("#offlineNote").hidden = hasKey();
    $$(".unitW").forEach(e => (e.textContent = units().w));
    $$(".unitD").forEach(e => (e.textContent = units().d));
    const names = new Set(COMMON); S.workouts.forEach(w => names.add(w.name));
    const dl = $("#nameList"); dl.innerHTML = "";
    names.forEach(n => { const o = document.createElement("option"); o.value = n; dl.appendChild(o); });
  }

  function renderAll() { renderHome(); renderWeekChart(); renderMix(); renderRecords(); renderSettings(); }

  /* ---------- navigation ---------- */
  function go(view) {
    $$("[data-view]").forEach(s => (s.hidden = s.dataset.view !== view));
    $$(".tabs button").forEach(b => (b.dataset.tab === view ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    window.scrollTo(0, 0);
    if (view === "coach") scrollChat();
  }
  $$(".tabs button").forEach(b => (b.onclick = () => go(b.dataset.tab)));
  $$("[data-go]").forEach(b => (b.onclick = () => go(b.dataset.go)));
  $("#toSettings").onclick = e => { e.preventDefault(); go("progress"); $("#settings").scrollIntoView(); $("#sKey").focus(); };

  let toastTimer;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
  }

  /* ---------- log form ---------- */
  let curType = "strength";
  Object.entries(TYPES).forEach(([k, t]) => {
    const b = document.createElement("button"), ring = document.createElement("i"), label = document.createElement("span");
    b.type = "button"; b.dataset.type = k; b.style.color = t.color; label.textContent = t.label;
    b.append(ring, label);
    b.setAttribute("aria-pressed", String(k === curType));
    b.onclick = () => { curType = k; $$("#typePick button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.type === k))); syncFields(); };
    $("#typePick").appendChild(b);
  });
  function syncFields() { $("#strengthFields").hidden = curType !== "strength"; $("#cardioFields").hidden = curType !== "cardio"; }
  syncFields();
  $("#fDate").value = ymd(today());
  $("#fRpe").oninput = e => ($("#rpeOut").textContent = e.target.value);

  $("#logForm").onsubmit = e => {
    e.preventDefault();
    const name = $("#fName").value.trim(), err = $("#formErr");
    if (!name) { err.textContent = "Add a name for the workout, like “Squats” or “Run”."; err.hidden = false; $("#fName").focus(); return; }
    if (!$("#fDate").value) { err.textContent = "Pick the date you trained."; err.hidden = false; return; }
    err.hidden = true;
    const num = id => { const v = $(id).value; return v === "" ? undefined : Number(v); };
    const w = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: $("#fDate").value, type: curType, name,
      minutes: num("#fMin"), rpe: Number($("#fRpe").value), notes: $("#fNotes").value.trim()
    };
    if (curType === "strength") { w.sets = num("#fSets"); w.reps = num("#fReps"); w.weight = num("#fWeight"); }
    if (curType === "cardio") w.distance = num("#fDist");

    const hadExamples = hasExamples();
    if (hadExamples) S.workouts = S.workouts.filter(x => !x.example);
    const prevBest = Stats.records(S.workouts).find(p => p.name.toLowerCase() === name.toLowerCase());
    S.workouts.push(w); save();

    ["#fName", "#fMin", "#fSets", "#fReps", "#fWeight", "#fDist", "#fNotes"].forEach(id => ($(id).value = ""));
    $("#fDate").value = ymd(today());
    renderAll(); go("home");
    if (w.weight && prevBest && w.weight > prevBest.weight) toast("New personal record!");
    else toast(hadExamples ? "Saved. Examples cleared." : "Workout saved");
  };

  /* ---------- settings ---------- */
  for (let i = 1; i <= 7; i++) {
    const o = document.createElement("option"); o.value = i; o.textContent = i + " workout" + (i > 1 ? "s" : "") + " / week";
    $("#sGoal").appendChild(o);
  }
  Coach.MODELS.forEach(m => { const o = document.createElement("option"); o.value = m.id; o.textContent = m.label; $("#sModel").appendChild(o); });
  $("#settingsForm").onsubmit = e => e.preventDefault();
  $("#sName").onchange = e => { S.settings.name = e.target.value.trim().slice(0, 40); save(); renderHome(); };
  $("#sGoal").onchange = e => { S.settings.goal = Number(e.target.value); save(); renderHome(); toast("Goal updated"); };
  $("#sUnits").onchange = e => { S.settings.units = e.target.value; save(); renderAll(); };
  $("#sModel").onchange = e => { S.settings.model = e.target.value; save(); toast("Coach model updated"); };
  $("#sKey").onchange = e => { S.settings.apiKey = e.target.value.trim(); save(); renderSettings(); toast(hasKey() ? "AI coach turned on" : "AI coach turned off"); };
  $("#removeKey").onclick = () => { S.settings.apiKey = ""; save(); renderSettings(); toast("Key removed"); };
  $("#clearExamples").onclick = () => { S.workouts = S.workouts.filter(w => !w.example); save(); renderAll(); toast("Examples cleared"); };
  $("#wipe").onclick = function () {
    if (!this.dataset.armed) {
      this.dataset.armed = "1"; this.textContent = "Tap again to delete everything";
      setTimeout(() => { delete this.dataset.armed; this.textContent = "Delete all my workouts"; }, 4000);
      return;
    }
    S.workouts = []; save(); renderAll();
    delete this.dataset.armed; this.textContent = "Delete all my workouts"; toast("All workouts deleted");
  };

  /* ---------- coach chat ---------- */
  const chatEl = $("#chat");
  let busy = false, ctl = null;

  // Escape first, then allow **bold** only.
  function fmt(text) {
    const d = document.createElement("div"); d.textContent = text;
    return d.innerHTML.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/^#+\s*/gm, "");
  }
  function bubble(role, text) {
    const b = document.createElement("div");
    b.className = "msg " + (role === "user" ? "me" : role === "note" ? "note" : "coach");
    if (role === "assistant") b.innerHTML = fmt(text); else b.textContent = text;
    chatEl.appendChild(b);
    return b;
  }
  function renderChat() {
    chatEl.innerHTML = "";
    if (!S.chat.length) bubble("assistant", "I'm your coach. I can see your workouts, so ask me what to do next, how you're trending, or tap “Hype me up” when you need a push.");
    S.chat.forEach(m => bubble(m.role, m.content));
  }
  function scrollChat() { requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight)); }
  function setBusy(on) { busy = on; $("#sendBtn").hidden = on; $("#stopBtn").hidden = !on; }

  $$(".tone button").forEach(b => {
    b.setAttribute("aria-pressed", String(b.dataset.tone === S.tone));
    b.onclick = () => { S.tone = b.dataset.tone; save(); $$(".tone button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.tone === S.tone))); };
  });

  async function ask(text) {
    text = text.trim();
    if (!text || busy) return;
    S.chat.push({ role: "user", content: text });
    bubble("user", text);

    if (!hasKey()) {
      const line = Coach.pepLine();
      S.chat.push({ role: "assistant", content: line });
      bubble("assistant", line);
      save(); scrollChat();
      return;
    }

    save();
    const out = bubble("assistant", "Thinking…");
    scrollChat(); setBusy(true);
    ctl = new AbortController();
    try {
      const reply = await Coach.streamReply({
        apiKey: S.settings.apiKey, model: S.settings.model,
        system: Coach.systemPrompt(S, today()), messages: Coach.trimHistory(S.chat),
        signal: ctl.signal, onText: t => (out.innerHTML = fmt(t))
      });
      S.chat.push({ role: "assistant", content: reply });
    } catch (e) {
      if (e.partial) { out.innerHTML = fmt(e.partial); S.chat.push({ role: "assistant", content: e.partial }); }
      else out.remove();
      if (e.code !== "cancelled" || !e.partial) bubble("note", e.message || "Something went wrong. Try again.");
    } finally {
      if (S.chat.length > 40) S.chat = S.chat.slice(-40);
      save(); setBusy(false); scrollChat();
    }
  }

  $("#composer").onsubmit = e => { e.preventDefault(); const t = $("#ask").value; $("#ask").value = ""; $("#ask").style.height = ""; ask(t); };
  $("#ask").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#composer").requestSubmit(); } });
  $("#ask").addEventListener("input", e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px"; });
  $("#stopBtn").onclick = () => ctl && ctl.abort();
  $$("#chips button").forEach(b => (b.onclick = () => ask(b.textContent)));
  $("#pepBtn").onclick = () => { go("coach"); ask("Hype me up for today"); };
  $("#clearChat").onclick = () => { S.chat = []; save(); renderChat(); };

  renderAll();
  renderChat();

  // Deep links: index.html#log, #progress, #coach
  const start = location.hash.slice(1);
  if (["log", "progress", "coach"].includes(start)) go(start);
})();
