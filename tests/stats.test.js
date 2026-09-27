const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/stats.js");

// Wednesday 10 September 2025, local time.
const TODAY = new Date(2025, 8, 10);
const day = ago => S.ymd(S.addDays(TODAY, -ago));

test("weekStart returns the Monday of the week", () => {
  assert.equal(S.ymd(S.weekStart(TODAY)), "2025-09-08");
  assert.equal(S.ymd(S.weekStart(new Date(2025, 8, 14))), "2025-09-08"); // Sunday
  assert.equal(S.ymd(S.weekStart(new Date(2025, 8, 8))), "2025-09-08"); // Monday
});

test("streak counts back from today", () => {
  const w = [0, 1, 2, 4].map(a => ({ date: day(a) }));
  assert.equal(S.streak(w, TODAY), 3);
});

test("streak still counts when today has no workout yet", () => {
  const w = [1, 2].map(a => ({ date: day(a) }));
  assert.equal(S.streak(w, TODAY), 2);
});

test("streak is zero after a missed day", () => {
  assert.equal(S.streak([{ date: day(2) }], TODAY), 0);
  assert.equal(S.streak([], TODAY), 0);
});

test("summary counts only this week's sessions and minutes", () => {
  const w = [
    { date: day(0), minutes: 30, rpe: 8 },
    { date: day(2), minutes: 45, rpe: 6 }, // Monday
    { date: day(3), minutes: 60, rpe: 7 } // previous Sunday
  ];
  const s = S.summary(w, TODAY);
  assert.equal(s.sessions, 2);
  assert.equal(s.minutes, 75);
  assert.equal(s.total, 3);
  assert.equal(s.avgRpe, 7);
});

test("weeklyMinutes returns oldest-first buckets ending with this week", () => {
  const w = [{ date: day(0), minutes: 20 }, { date: day(7), minutes: 40 }];
  const weeks = S.weeklyMinutes(w, TODAY, 3);
  assert.deepEqual(weeks.map(x => x.minutes), [0, 40, 20]);
});

test("typeMix ignores workouts older than the window", () => {
  const w = [
    { date: day(0), type: "cardio", minutes: 30 },
    { date: day(10), type: "strength", minutes: 10 },
    { date: day(40), type: "sport", minutes: 90 }
  ];
  const m = S.typeMix(w, TODAY, 30);
  assert.equal(m.total, 40);
  assert.equal(m.counts.sport, undefined);
});

test("estimate1RM uses the Epley formula", () => {
  assert.equal(S.estimate1RM(100, 5), 100 * (1 + 5 / 30));
  assert.equal(S.estimate1RM(100, undefined), 100 * (1 + 1 / 30));
});

test("records keeps the heaviest lift per exercise, case-insensitive", () => {
  const w = [
    { type: "strength", name: "Squats", weight: 80, reps: 5, date: day(0) },
    { type: "strength", name: "squats", weight: 70, reps: 12, date: day(5) },
    { type: "strength", name: "Bench press", weight: 60, reps: 8, date: day(2) },
    { type: "cardio", name: "Run", distance: 5, date: day(1) }
  ];
  const r = S.records(w);
  assert.equal(r.length, 2);
  assert.equal(r[0].name, "Squats");
  assert.equal(r[0].weight, 80);
  // 70 x 12 estimates higher than 80 x 5, so the best estimate is kept separately.
  assert.equal(r[0].e1rm, S.estimate1RM(70, 12));
});

test("detail formats strength and cardio entries", () => {
  const u = { w: "kg", d: "km" };
  assert.equal(S.detail({ type: "strength", sets: 5, reps: 5, weight: 80, minutes: 40, rpe: 8 }, u), "5×5 @ 80 kg · 40 min · RPE 8");
  assert.equal(S.detail({ type: "cardio", distance: 5, minutes: 28 }, u), "5 km · 28 min");
});
