/**
 * Pure date and statistics helpers. No DOM access, so they run in the
 * browser (as window.RepStats) and in Node tests (via require).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RepStats = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TYPES = {
    strength: { label: "Strength", color: "var(--red)" },
    cardio: { label: "Cardio", color: "var(--blue)" },
    mobility: { label: "Mobility", color: "var(--green)" },
    sport: { label: "Sport", color: "var(--yellow)" }
  };

  /* ---------- dates (local time, YYYY-MM-DD strings) ---------- */
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  /** Monday of the week containing d. */
  const weekStart = d => { const x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)); };

  const inRange = (w, from, to) => { const d = parse(w.date); return d >= from && d < to; };
  const sumMinutes = list => list.reduce((a, w) => a + (Number(w.minutes) || 0), 0);

  /** Consecutive days with at least one workout, ending today (or yesterday if today is empty). */
  function streak(workouts, today) {
    const days = new Set(workouts.map(w => w.date));
    let n = 0, d = startOfDay(today);
    if (!days.has(ymd(d))) d = addDays(d, -1);
    while (days.has(ymd(d))) { n++; d = addDays(d, -1); }
    return n;
  }

  function summary(workouts, today) {
    const ws = weekStart(today);
    const thisWeek = workouts.filter(w => inRange(w, ws, addDays(ws, 7)));
    const rated = workouts.filter(w => w.rpe && parse(w.date) >= addDays(startOfDay(today), -13));
    return {
      sessions: thisWeek.length,
      minutes: sumMinutes(thisWeek),
      streak: streak(workouts, today),
      total: workouts.length,
      avgRpe: rated.length ? rated.reduce((a, w) => a + Number(w.rpe), 0) / rated.length : null
    };
  }

  /** Minutes per week for the last `count` weeks, oldest first. */
  function weeklyMinutes(workouts, today, count = 8) {
    const ws0 = weekStart(today), out = [];
    for (let i = count - 1; i >= 0; i--) {
      const s = addDays(ws0, -7 * i);
      out.push({ start: s, minutes: sumMinutes(workouts.filter(w => inRange(w, s, addDays(s, 7)))) });
    }
    return out;
  }

  /** Share of training minutes per type over the last `days` days (a workout without minutes counts as 1). */
  function typeMix(workouts, today, days = 30) {
    const since = addDays(startOfDay(today), -(days - 1));
    const counts = {}; let total = 0;
    workouts.filter(w => parse(w.date) >= since).forEach(w => {
      const m = Number(w.minutes) || 1;
      counts[w.type] = (counts[w.type] || 0) + m; total += m;
    });
    return { counts, total };
  }

  /** Epley estimate of a one-rep max. */
  const estimate1RM = (weight, reps) => Number(weight) * (1 + (Number(reps) || 1) / 30);

  /** Heaviest weight per strength exercise (case-insensitive), with the best estimated 1RM. */
  function records(workouts) {
    const best = {};
    workouts.filter(w => w.type === "strength" && w.weight).forEach(w => {
      const k = w.name.trim().toLowerCase();
      const e = estimate1RM(w.weight, w.reps), wt = Number(w.weight), cur = best[k];
      if (!cur || wt > cur.weight) best[k] = { name: w.name, weight: wt, reps: w.reps, date: w.date, e1rm: Math.max(e, cur ? cur.e1rm : 0) };
      else cur.e1rm = Math.max(cur.e1rm, e);
    });
    return Object.values(best).sort((a, b) => b.weight - a.weight);
  }

  /** Short human summary like "5×5 @ 80 kg · 40 min · RPE 8". */
  function detail(w, units) {
    const bits = [];
    if (w.type === "strength" && (w.sets || w.reps))
      bits.push((w.sets || "?") + "×" + (w.reps || "?") + (w.weight ? " @ " + w.weight + " " + units.w : ""));
    if (w.distance) bits.push(w.distance + " " + units.d);
    if (w.minutes) bits.push(w.minutes + " min");
    if (w.rpe) bits.push("RPE " + w.rpe);
    return bits.join(" · ");
  }

  const sortByDateDesc = list => list.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return { TYPES, ymd, parse, addDays, startOfDay, weekStart, streak, summary, weeklyMinutes, typeMix, estimate1RM, records, detail, sortByDateDesc };
});
