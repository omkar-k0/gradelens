const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/model.js");
const sb = require("./fixture.studybook.json");

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("parses states, weights and dates", () => {
  const { modules } = M.parseStudybook(sb);
  const by = Object.fromEntries(modules.map((m) => [m.name, m]));
  assert.equal(by["Module A"].state, "graded");
  assert.equal(by["Language Course"].state, "passed-ungraded");
  assert.equal(by["Module C"].state, "partial");
  assert.equal(by["Thesis"].state, "open");
  close(by["Module B"].parts[0].weight, 0.75);
  assert.equal(by["Module B"].gradedOn, "2026-02-05");
  // open part takes the scheduled date, not the old attempt
  assert.equal(by["Module C"].nextDate, "2027-02-09");
  assert.equal(by["Module C"].semester, 2);
});

test("weighted average uses graded modules only, truncated", () => {
  const { modules } = M.parseStudybook(sb);
  const avg = M.weightedAverage(modules);
  // (1.3*10 + 2.8*6) / 16 = 1.8625
  close(avg.raw, 1.8625);
  assert.equal(avg.final, 1.8);
  assert.equal(M.weightedAverage(modules, { truncate: false }).final, avg.raw);
});

test("final range: best and worst case over open weight", () => {
  const { modules } = M.parseStudybook(sb);
  // gradable credits: 10 + 6 + 8 + 30 = 54 (ungraded language course excluded)
  // fixed = 13 + 16.8 + 8*0.25*1.3 = 32.4 ; open weight = 8*0.75 + 30 = 36
  const r = M.finalRange(modules);
  close(r.openEcts, 36);
  assert.equal(r.best, Math.floor(((32.4 + 36 * 1.0) / 54) * 10) / 10); // 1.26 -> 1.2
  assert.equal(r.worst, Math.floor(((32.4 + 36 * 4.0) / 54) * 10) / 10); // 3.26 -> 3.2
});

test("required grade for a target, with truncation slack", () => {
  const { modules } = M.parseStudybook(sb);
  const r = M.requiredForTarget(modules, 1.5);
  // x = ((1.5 + 0.0999) * 54 - 32.4) / 36
  close(r.x, ((1.5999 * 54) - 32.4) / 36);
  assert.equal(r.status, "reachable");
  assert.equal(r.step, 1.3); // 1.4999.. -> must hit 1.3 or better
  const c = r.perModule.find((m) => m.name === "Module C");
  close(c.openShare, 0.75);
  assert.equal(c.projectedModuleGrade, 1.3); // 0.25*1.3 + 0.75*1.3
  assert.equal(r.perModule[0].name, "Module C"); // sorted by next date
});

test("unreachable and secured edges", () => {
  const { modules } = M.parseStudybook(sb);
  assert.equal(M.requiredForTarget(modules, 1.0).status, "unreachable");
  assert.equal(M.requiredForTarget(modules, 3.9).status, "secured-with-any-pass");
});

test("helpers", () => {
  assert.equal(M.parseGermanDate("1. Prüfungsversuch: 19.01.2026, 10:00 Uhr"), "2026-01-19");
  assert.equal(M.parseWeight("25%"), 0.25);
  assert.equal(M.stepAtLeast(1.66), 1.3);
  assert.equal(M.stepAtLeast(1.7), 1.7);
  assert.equal(M.gradeLabel(1.5), "sehr gut");
  assert.throws(() => M.parseStudybook({}), /modulebereiche4list/);
});

test("trajectory is chronological with a running average", () => {
  const t = M.analyse(sb).trajectory;
  assert.deepEqual(t.map((p) => p.module), ["Module A", "Module B"]);
  assert.equal(t[0].runningAverage, 1.3);
  assert.equal(t[1].runningAverage, 1.8);
});

