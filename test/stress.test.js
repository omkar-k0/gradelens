process.env.TZ = "Europe/Berlin"; // the portal and its exams run on German time
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/model.js");
const mod = (o) => ({ modulebereiche4list: [{ name: "1. Fachsemester", module: [o] }] });
const T = { today: "2026-11-09" };

test("A1 failed attempt (5,0 / nicht bestanden) must not count as a graded module", () => {
  const sb = { modulebereiche4list: [{ name: "1", module: [
    { modulid: 1, name: "Passed", credits: 5, note: { note: 1.0, status: "bestanden" }, pruefungen: [] },
    { modulid: 2, name: "Failed", credits: 5, note: { note: 5.0, status: "nicht bestanden" },
      pruefungen: [{ pruefungid: 21, name: "Exam", note: { note: 5.0, status: "nicht bestanden" } }] } ] }] };
  const r = M.analyse(sb, T);
  assert.equal(r.average.raw, 1.0, `average was ${r.average.raw}`);
});

test("A2 unknown grading system must be refused, not silently averaged", () => {
  const sb = { ...mod({ modulid: 1, name: "X", credits: 5, note: { note: 15, status: "bestanden" }, pruefungen: [] }) };
  const r = M.analyse(sb, T);
  assert.ok(!(r.average.raw > 4), `average ${r.average.raw} accepted from an out-of-range grade`);
});

test("A3 hostile module id / date strings are rejected or coerced", () => {
  const sb = mod({ modulid: '"><img src=x onerror=alert(1)>', name: "X", credits: 5,
    pruefungen: [{ pruefungid: 1, name: "E", note: {}, pruefungstermin: { datum: '<svg onload=alert(1)>' } }] });
  const m = M.parseStudybook(sb, T).modules[0];
  assert.ok(typeof m.id === "number" || /^[\w-]+$/.test(String(m.id)), `id kept as ${m.id}`);
  assert.ok(m.nextDate === null || /^\d{4}-\d{2}-\d{2}$/.test(m.nextDate), `date kept as ${m.nextDate}`);
});

test("A4 weights that do not sum to 100% are flagged", () => {
  const sb = mod({ modulid: 1, name: "X", credits: 5, pruefungen: [
    { pruefungid: 1, name: "a", gewichtung: "60%", note: {} }, { pruefungid: 2, name: "b", gewichtung: "60%", note: {} } ] });
  const r = M.analyse(sb, T);
  assert.ok(r.warnings.length > 0, "silently renormalised 120% to 100%");
});

test("A5 JSON from a blob/arraybuffer XHR ('{}') gives a clear error", () => {
  assert.throws(() => M.analyse({}, T), /modulebereiche4list/);
});

test("A6 'today' is the Berlin calendar day, not UTC (00:30 local)", () => {
  // 2026-11-13 00:30 Berlin = 2026-11-12 23:30 UTC; an exam on 12.11 is already past locally
  const sb = mod({ modulid: 1, name: "X", credits: 5, pruefungen: [{ pruefungid: 1, name: "E", note: {},
    pruefungsergebnisse: [{ datum: "1. Prüfungsversuch: 12.11.2026, 10:00 Uhr" }], pruefungstermin: { datum: "2027-02-26" } }] });
  const realDate = Date; global.Date = class extends realDate { constructor(...a) { super(...(a.length ? a : ["2026-11-12T23:30:00Z"])); } static now() { return new realDate("2026-11-12T23:30:00Z").getTime(); } };
  try { assert.equal(M.parseStudybook(sb).modules[0].nextDate, "2027-02-26"); } finally { global.Date = realDate; }
});

test("A7 empty / brand-new student (nothing graded) does not crash", () => {
  const r = M.analyse(mod({ modulid: 1, name: "X", credits: 5, pruefungen: [{ pruefungid: 1, name: "E", note: {} }] }), T);
  const w = M.whatIf(r.modules, {}, 1.5);
  assert.ok(w && Number.isFinite(w.projectedRaw));
});

test("A8 huge payload parses in reasonable time (500 modules)", () => {
  const mods = Array.from({ length: 500 }, (_, i) => ({ modulid: i, name: "M" + i, credits: 5, note: { note: 2.0, status: "bestanden" },
    pruefungen: [{ pruefungid: i, name: "E", note: { note: 2.0 }, pruefungsergebnisse: [{ onlydatum: "01.01.2026, 10:00" }] }] }));
  const t0 = Date.now(); M.analyse({ modulebereiche4list: [{ name: "1", module: mods }] }, T); 
  assert.ok(Date.now() - t0 < 200);
});

test("A1b failed part becomes an open retake, not a graded part", () => {
  const sb = mod({ modulid: 3, name: "Retake", credits: 6, note: { status: "nicht bestanden" }, pruefungen: [
    { pruefungid: 31, name: "Exam", gewichtung: "75%", note: { note: 5.0, status: "nicht bestanden" }, pruefungstermin: { datum: "2027-02-01" } },
    { pruefungid: 32, name: "Participation", gewichtung: "25%", note: { note: 1.3, status: "bestanden" } } ] });
  const [m] = M.parseStudybook(sb, T).modules;
  assert.equal(m.state, "partial");
  assert.equal(m.retake, true);
  assert.equal(m.parts[0].grade, null);
  assert.equal(m.nextDate, "2027-02-01");
});

test("A2b a declared unsupported grading system is refused with a clear code", () => {
  const sb = { stn: { notensystem: "Punkte15" }, ...mod({ modulid: 1, name: "X", credits: 5, pruefungen: [] }) };
  assert.throws(() => M.parseStudybook(sb, T), (e) => e.code === "UNSUPPORTED_GRADING");
});

test("A3b non-object junk inside arrays does not crash", () => {
  const sb = { modulebereiche4list: [null, { name: "2", module: [null, 7, { modulid: 1, name: "Ok", credits: "5", pruefungen: [null, "x"] }] }] };
  const r = M.analyse(sb, T);
  assert.equal(r.modules.length, 3);
  assert.ok(r.modules.every((m) => m.credits === 0 || Number.isFinite(m.credits)));
});
