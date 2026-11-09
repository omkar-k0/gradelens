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

  // Open part: the earliest date that is still ahead (a registered attempt or the scheduled
  // termin); if all are past, the latest one. Graded part: when the result was taken.
  function pickDate(p, grade, today) {
    const resultDates = (p.pruefungsergebnisse || [])
      .map((r) => parseGermanDate(r.onlydatum) || parseGermanDate(r.datum))
      .filter(Boolean)
      .sort();
    if (grade !== null) return resultDates[resultDates.length - 1] || null;
    const all = resultDates.concat(p.pruefungstermin && p.pruefungstermin.datum ? [p.pruefungstermin.datum] : []).sort();
    if (all.length === 0) return null;
    return all.find((d) => d >= today) || all[all.length - 1];
  }

  function parsePart(p, today) {
    const grade = isNum(p.note && p.note.note) ? p.note.note : null;
    return {
      id: p.pruefungid,
      name: p.name || p.pruefung || "Assessment",
      type: p.pruefungstyp || null,
      weight: parseWeight(p.gewichtung),
      grade,
      status: (p.note && p.note.status) || null,
      date: pickDate(p, grade, today),
      attemptsAllowed: isNum(p.anzahlversuche) ? p.anzahlversuche : null,
    };
  }

  function normaliseWeights(parts) {
    if (parts.length === 0) return { parts, weightsAssumed: false };
    if (parts.length === 1) {
      return { parts: [{ ...parts[0], weight: 1 }], weightsAssumed: false };
    }
    const known = parts.filter((p) => isNum(p.weight));
    if (known.length === parts.length) {
      const sum = known.reduce((a, p) => a + p.weight, 0) || 1;
      return { parts: parts.map((p) => ({ ...p, weight: p.weight / sum })), weightsAssumed: false };
    }
    const eq = 1 / parts.length;
    return { parts: parts.map((p) => ({ ...p, weight: eq })), weightsAssumed: true };
  }

  const todayISO = () => new Date().toISOString().slice(0, 10);

  function parseStudybook(sb, opts) {
    if (!sb || !Array.isArray(sb.modulebereiche4list)) {
      throw new Error("Unexpected studybook shape: modulebereiche4list missing");
    }
    const today = (opts && opts.today) || todayISO();
    const modules = [];
    sb.modulebereiche4list.forEach((area, i) => {
      const semester = semesterFromAreaName(area.name, i + 1);
      (area.module || []).forEach((m) => {
        const { parts, weightsAssumed } = normaliseWeights((m.pruefungen || []).map((p) => parsePart(p, today)));
        const moduleGrade = isNum(m.note && m.note.note) ? m.note.note : null;
        const passed = (m.note && m.note.status) === "bestanden";
        const gradedParts = parts.filter((p) => p.grade !== null);
        let state;
        if (moduleGrade !== null) state = "graded";
        else if (passed) state = "passed-ungraded";
        else if (gradedParts.length > 0) state = "partial";
        else state = "open";
        const dates = gradedParts.map((p) => p.date).filter(Boolean).sort();
        modules.push({
          id: m.modulid,
          name: m.name,
          semester,
          credits: isNum(m.credits) ? m.credits : 0,
          grade: moduleGrade,
          state,
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
    const plan = sb.studyplan || {};
    return {
      modules,
      ectsEarned: isNum(plan.istects) ? plan.istects : sumCredits(modules.filter(isDone)),
      ectsTotal: isNum(plan.planects) ? plan.planects : sumCredits(modules),
      thesisAdmissionEcts: isNum(sb.zurZulassungThesisNotwendigeCredits)
        ? sb.zurZulassungThesisNotwendigeCredits
        : null,
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
        .map((m) => `${m.name}: assessment weights missing, assumed equal`),
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
