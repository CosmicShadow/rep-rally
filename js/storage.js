/**
 * Loads and saves app state in localStorage. Every access is wrapped so the
 * app still runs (without saving) in private windows or when storage is blocked.
 */
(function (root) {
  "use strict";
  const KEY = "reprally.v1";
  const { ymd, addDays, startOfDay } = root.RepStats;

  /** Example log relative to today, shown on first launch and flagged `example: true`. */
  function examples(today) {
    const t = startOfDay(today);
    const mk = (ago, o) => Object.assign({ id: "ex-" + ago + "-" + o.name, date: ymd(addDays(t, -ago)), example: true, notes: "" }, o);
    return [
      mk(0, { type: "strength", name: "Squats", minutes: 40, sets: 5, reps: 5, weight: 80, rpe: 8 }),
      mk(1, { type: "cardio", name: "Run", minutes: 28, distance: 5, rpe: 6 }),
      mk(3, { type: "strength", name: "Bench press", minutes: 35, sets: 4, reps: 8, weight: 55, rpe: 7 }),
      mk(4, { type: "mobility", name: "Yoga", minutes: 30, rpe: 3 }),
      mk(6, { type: "strength", name: "Squats", minutes: 40, sets: 5, reps: 5, weight: 75, rpe: 8 }),
      mk(8, { type: "sport", name: "Pickleball", minutes: 60, rpe: 6 }),
      mk(10, { type: "cardio", name: "Run", minutes: 31, distance: 5, rpe: 7 }),
      mk(13, { type: "strength", name: "Deadlift", minutes: 45, sets: 3, reps: 5, weight: 100, rpe: 9 }),
      mk(15, { type: "strength", name: "Bench press", minutes: 35, sets: 4, reps: 8, weight: 52.5, rpe: 7 }),
      mk(18, { type: "cardio", name: "Cycling", minutes: 50, distance: 18, rpe: 6 }),
      mk(22, { type: "strength", name: "Squats", minutes: 40, sets: 5, reps: 5, weight: 70, rpe: 7 }),
      mk(27, { type: "cardio", name: "Run", minutes: 33, distance: 5, rpe: 7 }),
      mk(34, { type: "mobility", name: "Stretching", minutes: 20, rpe: 2 }),
      mk(40, { type: "strength", name: "Deadlift", minutes: 45, sets: 3, reps: 5, weight: 92.5, rpe: 8 }),
      mk(45, { type: "cardio", name: "Walk", minutes: 45, distance: 4, rpe: 3 })
    ];
  }

  const DEFAULT_SETTINGS = { name: "", goal: 4, units: "metric", apiKey: "", model: root.RepCoach.DEFAULT_MODEL };

  function load(today) {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* storage blocked */ }
    if (!s || typeof s !== "object") s = {};
    return {
      workouts: Array.isArray(s.workouts) ? s.workouts : examples(today),
      settings: Object.assign({}, DEFAULT_SETTINGS, s.settings || {}),
      chat: Array.isArray(s.chat) ? s.chat : [],
      tone: s.tone === "drill" ? "drill" : "cheer"
    };
  }

  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage blocked or full */ }
  }

  root.RepStorage = { load, save, examples };
})(self);
