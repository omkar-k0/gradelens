/*
 * Grade Lens model: pure functions, no DOM, no network.
 * Input: the JSON the FOM Online Campus already loads from
 *   GET /campus/api/epm/studybook/{studiengangId}
 * Output: modules, summary, trajectory, final-grade range and target maths.
 *
 * Truncation after the first decimal is observed in the portal's own module grades
 * (0.75*2.7 + 0.25*3.3 = 2.85 is shown as 2.8).
 * ASSUMPTION (unverified against the FOM Prüfungsordnung):
 *   final grade = ECTS-weighted mean of all graded modules (thesis module included
 *   with its credits). Switch truncation off with { truncate: false }.
 */
(function (root) {
  "use strict";

  const GRADE_STEPS = [1.0, 1.3, 1.7, 2.0, 2.3, 2.7, 3.0, 3.3, 3.7, 4.0];
  const BEST = 1.0;
  const WORST = 4.0;

  const isNum = (v) => typeof v === "number" && Number.isFinite(v);

  function parseWeight(w) {
    if (w == null || w === "") return null;
    const n = parseFloat(String(w).replace(",", ".").replace("%", ""));
    return isNum(n) ? n / 100 : null;
  }

  // "1. Prüfungsversuch: 19.01.2026, 10:00 Uhr" or "19.01.2026, 10:00" -> "2026-01-19"
  function parseGermanDate(s) {
    if (!s) return null;
    const m = String(s).match(/(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  }

  function semesterFromAreaName(name, fallback) {
    const m = String(name || "").match(/(\d+)/);
    return m ? Number(m[1]) : fallback;
  }

  // ---------- validation boundary: everything from FOM is untrusted ----------
  const SUPPORTED_GRADING = ["NummerischCredits4+"]; // German 1,0–4,0 numeric scale
  const PASSED = "bestanden";
  const FAILED = /nicht\s*bestanden|failed/i;
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const MAX_TEXT = 160;

  const safeText = (v, fallback) => {
    const s = typeof v === "string" || typeof v === "number" ? String(v) : "";
    const t = s.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_TEXT);
    return t || fallback;
  };
  // ids are integers in FOM's data; anything else is replaced by a safe synthetic id
  const safeId = (v, fallback) => {
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,12}$/.test(v) ? Number(v) : NaN;
    return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
  };
  const safeIso = (v) => (typeof v === "string" && ISO_DATE.test(v) ? v : null);
  const safeCredits = (v) => (isNum(v) && v >= 0 && v <= 60 ? v : 0);
  // a usable grade: on the 1,0–4,0 scale and not a failed attempt
  function usableGrade(note) {
    if (!note || !isNum(note.note)) return { grade: null, failed: false, invalid: false };
    const failed = FAILED.test(String(note.status || "")) || note.note > WORST;
    if (failed) return { grade: null, failed: true, invalid: false };
    if (note.note < BEST) return { grade: null, failed: false, invalid: true };
    return { grade: note.note, failed: false, invalid: false };
  }

  // Open part: the earliest date that is still ahead (a registered attempt or the scheduled
  // termin); if all are past, the latest one. Graded part: when the result was taken.
  function pickDate(p, grade, today) {
    const resultDates = (Array.isArray(p.pruefungsergebnisse) ? p.pruefungsergebnisse : [])
      .map((r) => (r ? parseGermanDate(r.onlydatum) || parseGermanDate(r.datum) : null))
      .filter(Boolean)
      .sort();
    if (grade !== null) return resultDates[resultDates.length - 1] || null;
    const termin = safeIso(p.pruefungstermin && p.pruefungstermin.datum);
    const all = resultDates.concat(termin ? [termin] : []).sort();
    if (all.length === 0) return null;
    return all.find((d) => d >= today) || all[all.length - 1];
  }

  function parsePart(p, today, idx, issues, moduleName) {
    p = p && typeof p === "object" ? p : {};
    const g = usableGrade(p.note);
    if (g.invalid) issues.push(`${moduleName}: grade ${p.note.note} is outside 1,0–4,0 and was ignored`);
    return {
      id: safeId(p.pruefungid, `p${idx}`),
      name: safeText(p.name || p.pruefung, "Assessment"),
      type: safeText(p.pruefungstyp, null),
      weight: (() => {
        const w = parseWeight(p.gewichtung);
        return w !== null && w >= 0 && w <= 1 ? w : null;
      })(),
      grade: g.grade,
      failed: g.failed,
      status: safeText(p.note && p.note.status, null),
      date: pickDate(p, g.grade, today),
      attemptsAllowed: isNum(p.anzahlversuche) ? p.anzahlversuche : null,
    };
  }

  function normaliseWeights(parts) {
    if (parts.length === 0) return { parts, weightsAssumed: false, weightSum: 1 };
    if (parts.length === 1) {
      return { parts: [{ ...parts[0], weight: 1 }], weightsAssumed: false, weightSum: 1 };
    }
    const known = parts.filter((p) => isNum(p.weight));
    if (known.length === parts.length) {
      const sum = known.reduce((a, p) => a + p.weight, 0);
      if (sum <= 0) {
        const eq = 1 / parts.length;
        return { parts: parts.map((p) => ({ ...p, weight: eq })), weightsAssumed: true, weightSum: sum };
      }
      return { parts: parts.map((p) => ({ ...p, weight: p.weight / sum })), weightsAssumed: false, weightSum: sum };
    }
    const eq = 1 / parts.length;
    return { parts: parts.map((p) => ({ ...p, weight: eq })), weightsAssumed: true, weightSum: null };
  }

  // the student's local calendar day (the portal and its exams are in German time)
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  function gradingSystem(sb) {
    const cands = [sb.stn && sb.stn.notensystem].concat((Array.isArray(sb.stnlist) ? sb.stnlist : []).map((x) => x && x.notensystem));
    return cands.find((x) => typeof x === "string" && x) || null;
  }

  function parseStudybook(sb, opts) {
    if (!sb || typeof sb !== "object" || !Array.isArray(sb.modulebereiche4list)) {
      throw new Error("Unexpected studybook shape: modulebereiche4list missing");
    }
    const system = gradingSystem(sb);
    if (system && !SUPPORTED_GRADING.includes(system)) {
      const e = new Error(`Grading system "${safeText(system, "?")}" is not supported yet`);
      e.code = "UNSUPPORTED_GRADING";
      throw e;
    }
    const today = (opts && opts.today) || todayISO();
    const modules = [];
    const issues = [];
    let idx = 0;
    sb.modulebereiche4list.forEach((area, i) => {
      area = area && typeof area === "object" ? area : {};
      const semester = semesterFromAreaName(area.name, i + 1);
      (Array.isArray(area.module) ? area.module : []).forEach((m) => {
        m = m && typeof m === "object" ? m : {};
        const n = idx++;
        const name = safeText(m.name, `Module ${n + 1}`);
        const rawParts = (Array.isArray(m.pruefungen) ? m.pruefungen : []).map((p, j) => parsePart(p, today, `${n}-${j}`, issues, name));
        const { parts, weightsAssumed, weightSum } = normaliseWeights(rawParts);
        if (weightSum !== null && Math.abs(weightSum - 1) > 0.01)
          issues.push(`${name}: assessment weights add up to ${Math.round(weightSum * 100)}%, rescaled to 100%`);
        const mg = usableGrade(m.note);
        if (mg.invalid) issues.push(`${name}: grade ${m.note.note} is outside 1,0–4,0 and was ignored`);
        const status = String((m.note && m.note.status) || "");
        const passed = status === PASSED || !!(m.note && m.note.anerkannt && mg.grade !== null);
        const moduleGrade = passed ? mg.grade : null; // a grade only counts once the module is passed
        const gradedParts = parts.filter((p) => p.grade !== null);
        let state;
        if (moduleGrade !== null) state = "graded";
        else if (passed) state = "passed-ungraded";
        else if (gradedParts.length > 0) state = "partial";
        else state = "open";
        const dates = gradedParts.map((p) => p.date).filter(Boolean).sort();
        modules.push({
          id: safeId(m.modulid, `m${n}`),
          name,
          semester,
          credits: safeCredits(m.credits),
          grade: moduleGrade,
          state,
          retake: mg.failed || parts.some((p) => p.failed),
          recognised: !!(m.note && m.note.anerkannt),
          parts,
          weightsAssumed,
          gradedOn: moduleGrade !== null ? dates[dates.length - 1] || null : null,
          nextDate:
            parts
              .filter((p) => p.grade === null && p.date)
              .map((p) => p.date)
              .sort()[0] || null,
        });
      });
    });
    const plan = sb.studyplan && typeof sb.studyplan === "object" ? sb.studyplan : {};
    const okEcts = (v) => isNum(v) && v >= 0 && v <= 400;
    return {
      modules,
      issues,
      gradingSystem: system,
      ectsEarned: okEcts(plan.istects) ? plan.istects : sumCredits(modules.filter(isDone)),
      ectsTotal: okEcts(plan.planects) && plan.planects > 0 ? plan.planects : sumCredits(modules) || 1,
      thesisAdmissionEcts: okEcts(sb.zurZulassungThesisNotwendigeCredits) ? sb.zurZulassungThesisNotwendigeCredits : null,
    };
  }

  const isDone = (m) => m.state === "graded" || m.state === "passed-ungraded";
  const counts = (m) => m.state !== "passed-ungraded"; // ungraded passes carry no grade
  function sumCredits(ms) {
    return ms.reduce((a, m) => a + m.credits, 0);
  }

  function finalise(x, opts) {
    if (!isNum(x)) return null;
    return opts && opts.truncate === false ? x : Math.floor(x * 10 + 1e-9) / 10;
  }

  function weightedAverage(modules, opts) {
    const g = modules.filter((m) => m.state === "graded" && m.credits > 0);
    const c = sumCredits(g);
    if (c === 0) return { raw: null, final: null, credits: 0 };
    const raw = g.reduce((a, m) => a + m.grade * m.credits, 0) / c;
    return { raw, final: finalise(raw, opts), credits: c };
  }

  // Splits every gradable module into what is fixed and how much ECTS-weight is still open.
  function decompose(modules) {
    let fixed = 0; // sum of grade * credits already locked in
    let openWeight = 0; // credits * open share that a future grade x will fill
    let gradableCredits = 0;
    const open = [];
    modules.filter(counts).forEach((m) => {
      if (m.credits <= 0) return;
      gradableCredits += m.credits;
      if (m.state === "graded") {
        fixed += m.grade * m.credits;
        return;
      }
      const known = m.parts.filter((p) => p.grade !== null);
      const knownSum = known.reduce((a, p) => a + p.weight * p.grade, 0);
      const knownW = known.reduce((a, p) => a + p.weight, 0);
      const restW = Math.max(0, 1 - knownW);
      fixed += m.credits * knownSum;
      openWeight += m.credits * restW;
      open.push({ module: m, knownSum, knownWeight: knownW, openShare: restW });
    });
    return { fixed, openWeight, gradableCredits, open };
  }

  function finalRange(modules, opts) {
    const d = decompose(modules);
    if (d.gradableCredits === 0) return null;
    const at = (x) => (d.fixed + d.openWeight * x) / d.gradableCredits;
    const current = weightedAverage(modules, opts).raw;
    return {
      best: finalise(at(BEST), opts),
      worst: finalise(at(WORST), opts),
      ifYouKeepPace: current === null ? null : finalise(at(current), opts),
      openEcts: d.openWeight,
      lockedShare: 1 - d.openWeight / d.gradableCredits,
    };
  }

  // Largest official step that is <= x, i.e. the grade you must at least hit.
  function stepAtLeast(x) {
    let best = null;
    for (const s of GRADE_STEPS) if (s <= x + 1e-9) best = s;
    return best;
  }

  /*
   * What uniform grade x across every open assessment gets the final grade to `target`?
   * With truncation, any raw average below target + 0.1 truncates to <= target,
   * so the raw goal is target + 0.0999.
   */
  function requiredForTarget(modules, target, opts) {
    const d = decompose(modules);
    if (d.gradableCredits === 0) return { status: "no-data" };
    const rawGoal = opts && opts.truncate === false ? target : target + 0.0999;
    if (d.openWeight === 0) {
      const now = d.fixed / d.gradableCredits;
      return { status: now <= rawGoal ? "already-secured" : "unreachable", x: null };
    }
    const x = (rawGoal * d.gradableCredits - d.fixed) / d.openWeight;
    let status;
    if (x < BEST) status = "unreachable";
    else if (x >= WORST) status = "secured-with-any-pass";
    else status = "reachable";
    const step = status === "reachable" ? stepAtLeast(x) : null;
    const perModule = d.open
      .map(({ module: m, knownSum, openShare }) => {
        const nextParts = m.parts.filter((p) => p.grade === null);
        return {
          id: m.id,
          name: m.name,
          credits: m.credits,
          openShare,
          // module grade if you hit exactly `step` on the open parts (FOM truncates module grades too)
          projectedModuleGrade: step === null ? null : finalise(knownSum + openShare * step, opts),
          openParts: nextParts.map((p) => ({ name: p.name, weight: p.weight, date: p.date })),
          nextDate: m.nextDate,
          leverage: (m.credits * openShare) / d.openWeight, // share of the remaining swing
        };
      })
      .sort((a, b) => (a.nextDate || "9999").localeCompare(b.nextDate || "9999"));
    return { status, x, step, openEcts: d.openWeight, perModule };
  }

  function nearestStep(x) {
    if (!isNum(x)) return null;
    return GRADE_STEPS.reduce((b, s) => (Math.abs(s - x) < Math.abs(b - x) - 1e-9 ? s : b), GRADE_STEPS[0]);
  }

  /*
   * Per-module what-if.
   * overrides: { [moduleId]: expected grade for that module's open assessments }.
   * Modules without an override assume your current pace (nearest official step to your average).
   * Also answers: given your overrides, what do the modules you left unset need for `target`?
   */
  function whatIf(modules, overrides, target, opts) {
    overrides = overrides || {};
    const d = decompose(modules);
    if (d.gradableCredits === 0) return null;
    const avg = weightedAverage(modules, opts).raw;
    const pace = nearestStep(avg === null ? 2.0 : avg);
    let fixed = d.fixed;
    let unsetWeight = 0;
    const perModule = d.open.map(({ module: m, knownSum, openShare }) => {
      const ov = overrides[m.id];
      const hasOv = isNum(ov);
      if (hasOv) fixed += m.credits * openShare * ov;
      else unsetWeight += m.credits * openShare;
      return {
        id: m.id,
        name: m.name,
        credits: m.credits,
        semester: m.semester,
        retake: !!m.retake,
        openShare,
        knownSum,
        knownWeight: 1 - openShare,
        openParts: m.parts.filter((p) => p.grade === null).map((p) => ({ name: p.name, weight: p.weight, date: p.date })),
        nextDate: m.nextDate,
        expected: hasOv ? ov : pace,
        source: hasOv ? "you" : "pace",
        projectedModuleGrade: finalise(knownSum + openShare * (hasOv ? ov : pace), opts),
        leverage: d.openWeight ? (m.credits * openShare) / d.openWeight : 0,
        // best/worst this module can still end at
        moduleBest: finalise(knownSum + openShare * BEST, opts),
        moduleWorst: finalise(knownSum + openShare * WORST, opts),
      };
    });
    perModule.sort((a, b) => (a.nextDate || "9999").localeCompare(b.nextDate || "9999"));
    const projectedRaw = (fixed + unsetWeight * pace) / d.gradableCredits;
    let need = null;
    if (isNum(target)) {
      const rawGoal = opts && opts.truncate === false ? target : target + 0.0999;
      if (unsetWeight === 0) {
        need = { status: fixed / d.gradableCredits <= rawGoal ? "met" : "missed", x: null, step: null };
      } else {
        const x = (rawGoal * d.gradableCredits - fixed) / unsetWeight;
        const status = x < BEST ? "unreachable" : x >= WORST ? "secured-with-any-pass" : "reachable";
        need = { status, x, step: status === "reachable" ? stepAtLeast(x) : null, unsetEcts: unsetWeight };
      }
    }
    return { pace, projectedRaw, projected: finalise(projectedRaw, opts), need, perModule };
  }

  function trajectory(modules, opts) {
    const g = modules
      .filter((m) => m.state === "graded" && m.credits > 0)
      .map((m) => ({ ...m, when: m.gradedOn || `sem-${m.semester}` }))
      .sort((a, b) => String(a.when).localeCompare(String(b.when)));
    let gc = 0;
    let c = 0;
    return g.map((m) => {
      gc += m.grade * m.credits;
      c += m.credits;
      return {
        date: m.gradedOn,
        semester: m.semester,
        module: m.name,
        grade: m.grade,
        credits: m.credits,
        runningAverage: finalise(gc / c, opts),
        runningAverageRaw: gc / c,
      };
    });
  }

  function gradeLabel(g) {
    if (!isNum(g)) return "";
    if (g <= 1.5) return "sehr gut";
    if (g <= 2.5) return "gut";
    if (g <= 3.5) return "befriedigend";
    if (g <= 4.0) return "ausreichend";
    return "nicht bestanden";
  }

  function analyse(sb, opts) {
    const parsed = parseStudybook(sb, opts);
    const { modules } = parsed;
    return {
      ...parsed,
      average: weightedAverage(modules, opts),
      range: finalRange(modules, opts),
      trajectory: trajectory(modules, opts),
      warnings: modules
        .filter((m) => m.weightsAssumed)
        .map((m) => `${m.name}: assessment weights missing, assumed equal`)
        .concat(parsed.issues),
    };
  }

  const api = {
    GRADE_STEPS,
    parseWeight,
    parseGermanDate,
    parseStudybook,
    weightedAverage,
    finalRange,
    requiredForTarget,
    whatIf,
    nearestStep,
    trajectory,
    stepAtLeast,
    gradeLabel,
    analyse,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GradeLensModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
