/*
 * Grade Lens panel. Isolated content-script world, Shadow DOM, no dependencies.
 * Data arrives from hook.js via window.postMessage and is held in memory only.
 */
(() => {
  "use strict";
  const M = globalThis.GradeLensModel;
  if (!M || window.__gradeLensLoaded) return;
  window.__gradeLensLoaded = true;

  const STUDY_PROGRESS_PATH = "/node/6148";
  const state = { sb: null, data: null, target: 1.5, open: false, error: null };

  // ---------- helpers ----------
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (g) => (typeof g === "number" ? g.toFixed(1).replace(".", ",") : "–");
  const fmt2 = (g) => (typeof g === "number" ? g.toFixed(2).replace(".", ",") : "–");
  // a requirement must never look easier than it is: round down
  const fmtReq = (g) => (typeof g === "number" ? (Math.floor(g * 100 + 1e-9) / 100).toFixed(2).replace(".", ",") : "–");
  const fmtDate = (iso) => {
    if (!iso) return "date tbd";
    const [y, m, d] = iso.split("-");
    return `${d}.${m}.${y}`;
  };
  const daysUntil = (iso) => (iso ? Math.ceil((new Date(iso) - new Date()) / 86400000) : null);

  // ---------- shell ----------
  const host = document.createElement("div");
  host.id = "grade-lens-root";
  host.style.cssText = "all:initial;position:fixed;z-index:2147483646;inset:auto;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${CSS()}</style>
    <button class="launcher" part="launcher" aria-label="Open Grade Lens" title="Grade Lens">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 17l5-5 4 4 8-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>Grade Lens</span><i class="dot" hidden></i>
    </button>
    <aside class="drawer" role="dialog" aria-label="Grade Lens" hidden>
      <header>
        <div><strong>Grade Lens</strong><span class="sub">computed in your browser · nothing is sent anywhere</span></div>
        <button class="close" aria-label="Close">✕</button>
      </header>
      <main class="body"></main>
    </aside>
    <div class="tip" role="tooltip" hidden></div>`;
  document.documentElement.appendChild(host);

  const $ = (sel) => root.querySelector(sel);
  const launcher = $(".launcher");
  const drawer = $(".drawer");
  const body = $(".body");
  const tip = $(".tip");

  launcher.addEventListener("click", () => toggle(true));
  $(".close").addEventListener("click", () => toggle(false));
  document.addEventListener("keydown", (e) => e.key === "Escape" && state.open && toggle(false));

  function toggle(open) {
    state.open = open;
    drawer.hidden = !open;
    launcher.hidden = open;
    if (open) render();
  }

  // ---------- data in ----------
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.source !== "fom-grade-lens" || d.kind !== "studybook") return;
    try {
      state.sb = JSON.parse(d.text);
      state.data = M.analyse(state.sb);
      state.error = null;
      $(".dot").hidden = false;
    } catch (err) {
      state.error = `Could not read the study book: ${err.message}. FOM may have changed its data format.`;
    }
    if (state.open) render();
  });
  window.postMessage({ source: "fom-grade-lens-panel", kind: "request" }, location.origin);

  // ---------- render ----------
  function render() {
    if (state.error) {
      body.innerHTML = `<div class="empty warn">${esc(state.error)}</div>`;
      return;
    }
    if (!state.data) {
      body.innerHTML = `<div class="empty">
        <p>No grade data on this page yet.</p>
        <a class="btn" href="${STUDY_PROGRESS_PATH}">Open Study progress</a>
        <p class="muted small">Grade Lens reads the study book that page already loads. Then come back here.</p></div>`;
      return;
    }
    const d = state.data;
    const req = M.requiredForTarget(d.modules, state.target);
    body.innerHTML = `
      ${kpis(d)}
      <section><h3>Where your final grade can still land</h3><div class="js-range">${rangeFigure(d, req)}</div></section>
      <section><h3>Grade trajectory</h3>${trajectoryChart(d.trajectory)}</section>
      <section><h3>Target setter</h3>
        <label class="slider"><span>Target final grade <output>${fmt(state.target)}</output></span>
          <input type="range" min="1" max="3.5" step="0.1" value="${state.target}" aria-label="Target final grade"></label>
        <div class="js-req">${targetSetter(req)}</div></section>
      <section><h3>Modules</h3>${moduleTable(d.modules)}</section>
      <footer class="muted small">
        Final grade assumed to be the ECTS-weighted mean of all graded modules (thesis module included),
        truncated after the first decimal, as the portal does for module grades. Not yet checked against
        the Prüfungsordnung. Ungraded passes count for ECTS only.
        ${d.warnings.map((w) => `<br>⚠ ${esc(w)}`).join("")}
      </footer>`;
    wire();
  }

  function kpis(d) {
    const pct = Math.round((d.ectsEarned / d.ectsTotal) * 100);
    const r = d.range || {};
    return `<div class="kpis">
      <div class="kpi"><span class="label">Current average</span><span class="value">${fmt(d.average.final)}</span>
        <span class="muted small">${fmt2(d.average.raw)} raw · ${esc(M.gradeLabel(d.average.final))}</span></div>
      <div class="kpi"><span class="label">ECTS</span><span class="value">${d.ectsEarned}<small>/${d.ectsTotal}</small></span>
        <span class="bar" role="img" aria-label="${pct}% of ECTS earned"><i style="width:${pct}%"></i></span></div>
      <div class="kpi"><span class="label">Final range</span><span class="value">${fmt(r.best)}<small>–${fmt(r.worst)}</small></span>
        <span class="muted small">${Math.round((r.lockedShare || 0) * 100)}% of the grade is locked in</span></div>
    </div>`;
  }

  // 1.0 (best) on the left, 4.0 on the right
  function rangeFigure(d, req) {
    const r = d.range;
    if (!r) return `<p class="muted">Nothing graded yet.</p>`;
    const W = 400, x = (g) => 16 + ((g - 1) / 3) * (W - 32);
    const ticks = [1, 1.5, 2, 2.5, 3, 3.5, 4]
      .map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="34" y2="40" class="axis"/><text x="${x(t)}" y="54" class="tick">${fmt(t)}</text>`)
      .join("");
    return `<svg viewBox="0 0 ${W} 64" class="range" role="img"
        aria-label="Final grade between ${fmt(r.best)} and ${fmt(r.worst)}; ${fmt(r.ifYouKeepPace)} if you keep your current pace">
      <line x1="16" x2="${W - 16}" y1="34" y2="34" class="axis"/>
      ${ticks}
      <rect x="${x(r.best)}" y="20" width="${Math.max(2, x(r.worst) - x(r.best))}" height="10" rx="4" class="band"
        data-tip="Possible final grade: ${fmt(r.best)} (1,0 in everything open) to ${fmt(r.worst)} (4,0 in everything open)"/>
      <circle cx="${x(r.ifYouKeepPace)}" cy="25" r="6" class="pace"
        data-tip="If you keep your current average: ${fmt(r.ifYouKeepPace)}"/>
      <path d="M${x(state.target)} 10 l-5 -7 h10 z" class="target" data-tip="Your target: ${fmt(state.target)}"/>
    </svg>
    <div class="legend small"><span><i class="sw band"></i>possible range</span><span><i class="sw pace"></i>at current pace ${fmt(r.ifYouKeepPace)}</span><span><i class="sw target"></i>target ${fmt(state.target)}</span></div>`;
  }

  function trajectoryChart(t) {
    if (t.length < 2) return `<p class="muted">Needs at least two graded modules.</p>`;
    const W = 400, H = 180, L = 30, R = 12, T = 12, B = 26;
    const lo = 1, hi = Math.min(4, Math.max(3, Math.ceil(Math.max(...t.map((p) => p.grade)) * 2) / 2));
    const xs = (i) => L + (i / (t.length - 1)) * (W - L - R);
    const ys = (g) => T + ((g - lo) / (hi - lo)) * (H - T - B); // 1,0 at the top: better is up
    const grid = [];
    for (let g = lo; g <= hi + 1e-9; g += 0.5)
      grid.push(`<line x1="${L}" x2="${W - R}" y1="${ys(g)}" y2="${ys(g)}" class="grid"/><text x="${L - 6}" y="${ys(g) + 3}" class="tick end">${fmt(g)}</text>`);
    const line = t.map((p, i) => `${i ? "L" : "M"}${xs(i)} ${ys(p.runningAverageRaw)}`).join(" ");
    const sems = [];
    t.forEach((p, i) => {
      if (i === 0 || t[i - 1].semester !== p.semester)
        sems.push(`<text x="${xs(i)}" y="${H - 8}" class="tick start">Sem ${p.semester}</text>`);
    });
    const dots = t
      .map((p, i) => {
        const tipText = `${p.module} · ${fmt(p.grade)} · ${p.credits} ECTS · ${fmtDate(p.date)} — running average ${fmt(p.runningAverage)}`;
        return `<g class="pt" data-tip="${esc(tipText)}"><circle cx="${xs(i)}" cy="${ys(p.grade)}" r="12" class="hit"/>
          <circle cx="${xs(i)}" cy="${ys(p.grade)}" r="4.5" class="grade"/></g>`;
      })
      .join("");
    const last = t[t.length - 1];
    return `<svg viewBox="0 0 ${W} ${H}" class="traj" role="img"
        aria-label="Module grades over time with running ECTS-weighted average, ending at ${fmt(last.runningAverage)}">
      ${grid.join("")}${sems.join("")}
      <path d="${line}" class="avg"/>
      <text x="${xs(t.length - 1) - 4}" y="${ys(last.runningAverageRaw) - 8}" class="label end">avg ${fmt(last.runningAverage)}</text>
      ${dots}
    </svg>
    <div class="legend small"><span><i class="sw grade"></i>module grade</span><span><i class="sw avgl"></i>running average (ECTS-weighted)</span><span class="muted">higher = better</span></div>`;
  }

  function targetSetter(req) {
    let verdict;
    if (req.status === "unreachable")
      verdict = `<p class="verdict bad"><b>Not reachable.</b> Even 1,0 in every open assessment does not get you to ${fmt(state.target)}.</p>`;
    else if (req.status === "secured-with-any-pass" || req.status === "already-secured")
      verdict = `<p class="verdict good"><b>Already safe.</b> Passing everything open is enough for ${fmt(state.target)}.</p>`;
    else
      verdict = `<p class="verdict">Average <b>${fmtReq(req.x)}</b> or better across the ${Math.round(req.openEcts * 10) / 10} open weighted ECTS,
        in official steps: <b class="step">${fmt(req.step)}</b> or better in each.</p>`;
    const rows = (req.perModule || [])
      .map((m) => {
        const dd = daysUntil(m.nextDate);
        const when = m.nextDate ? `${fmtDate(m.nextDate)}${dd !== null && dd >= 0 ? ` · in ${dd} d` : ""}` : "date tbd";
        return `<tr><td>${esc(m.name)}<div class="muted small">${m.openParts.map((p) => `${esc(p.name)} ${Math.round(p.weight * 100)}%`).join(" · ")}</div></td>
          <td class="num">${when}</td>
          <td class="num"><span class="lev" style="--w:${Math.round(m.leverage * 100)}%"></span>${Math.round(m.leverage * 100)}%</td>
          <td class="num">${m.projectedModuleGrade == null ? "–" : fmt(m.projectedModuleGrade)}</td></tr>`;
      })
      .join("");
    return `${verdict}
      <table><thead><tr><th>Open module</th><th class="num">Next date</th><th class="num" title="Share of the remaining swing this module controls">Weight left</th><th class="num">Module at step</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  function moduleTable(mods) {
    const pill = (m) => {
      const map = { graded: ["ok", "graded"], "passed-ungraded": ["ok", "passed"], partial: ["mid", "in progress"], open: ["idle", "open"] };
      const [cls, txt] = map[m.state];
      return `<span class="pill ${cls}">${txt}</span>`;
    };
    return `<table class="mods"><thead><tr><th>Sem</th><th>Module</th><th class="num">ECTS</th><th class="num">Grade</th><th>Status</th></tr></thead><tbody>
      ${mods
        .map(
          (m) => `<tr><td>${m.semester}</td><td>${esc(m.name)}${
            m.parts.length > 1
              ? `<div class="muted small">${m.parts.map((p) => `${esc(p.name)} ${Math.round(p.weight * 100)}%: ${p.grade == null ? "–" : fmt(p.grade)}`).join(" · ")}</div>`
              : ""
          }</td><td class="num">${m.credits}</td><td class="num">${m.grade == null ? "–" : fmt(m.grade)}</td><td>${pill(m)}</td></tr>`
        )
        .join("")}</tbody></table>`;
  }

  function wire() {
    const input = root.querySelector('input[type="range"]');
    if (input)
      input.addEventListener("input", (e) => {
        state.target = Math.round(parseFloat(e.target.value) * 10) / 10;
        const req = M.requiredForTarget(state.data.modules, state.target);
        root.querySelector(".slider output").textContent = fmt(state.target);
        root.querySelector(".js-req").innerHTML = targetSetter(req);
        root.querySelector(".js-range").innerHTML = rangeFigure(state.data, req);
        wireTips(root.querySelector(".js-range"));
      });
    wireTips(root);
  }

  function wireTips(scope) {
    scope.querySelectorAll("[data-tip]").forEach((el) => {
      el.addEventListener("mouseenter", () => {
        tip.textContent = el.getAttribute("data-tip");
        tip.hidden = false;
      });
      el.addEventListener("mousemove", (e) => {
        const w = tip.offsetWidth;
        tip.style.left = Math.min(window.innerWidth - w - 8, e.clientX + 12) + "px";
        tip.style.top = e.clientY + 14 + "px";
      });
      el.addEventListener("mouseleave", () => (tip.hidden = true));
    });
  }

  function CSS() {
    return `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .launcher, .drawer, .tip { font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #f0efec; }
    .launcher { position: fixed; left: 72px; bottom: 18px; display: flex; gap: 8px; align-items: center; padding: 9px 14px;
      background: #1a1a19; border: 1px solid #3a3a37; border-radius: 999px; cursor: pointer; box-shadow: 0 6px 24px rgba(0,0,0,.25); }
    .launcher:hover { border-color: #3987e5; }
    .launcher .dot { width: 7px; height: 7px; border-radius: 50%; background: #3987e5; }
    .drawer { position: fixed; top: 0; right: 0; height: 100vh; width: min(460px, 100vw); background: #1a1a19;
      border-left: 1px solid #2e2e2b; display: flex; flex-direction: column; box-shadow: -12px 0 40px rgba(0,0,0,.3); }
    header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid #2e2e2b; }
    header strong { font-size: 14px; margin-right: 10px; }
    .sub { color: #8f8e86; font-size: 11px; }
    .close { background: none; border: 0; color: #c3c2b7; font-size: 15px; cursor: pointer; padding: 4px 8px; border-radius: 6px; }
    .close:hover { background: #262624; }
    .body { overflow-y: auto; padding: 16px 18px 28px; }
    section { margin-top: 22px; }
    h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #8f8e86; font-weight: 600; margin: 0 0 10px; }
    .muted { color: #8f8e86; } .small { font-size: 11px; }
    .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .kpi { border: 1px solid #2e2e2b; border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; background: #1f1f1e; }
    .kpi .label { font-size: 11px; color: #c3c2b7; }
    .kpi .value { font-size: 24px; font-weight: 600; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
    .kpi .value small { font-size: 13px; color: #8f8e86; font-weight: 500; }
    .bar { display: block; height: 4px; background: #2e2e2b; border-radius: 4px; margin-top: 6px; overflow: hidden; }
    .bar i { display: block; height: 100%; background: #3987e5; border-radius: 4px; }
    svg { width: 100%; height: auto; display: block; overflow: visible; }
    .axis { stroke: #4a4a46; stroke-width: 1; } .grid { stroke: #2e2e2b; stroke-width: 1; }
    .tick { fill: #8f8e86; font-size: 10px; text-anchor: middle; } .tick.end { text-anchor: end; } .tick.start { text-anchor: start; }
    .label { fill: #c3c2b7; font-size: 10px; } .label.end { text-anchor: end; }
    .range .band { fill: #3987e5; opacity: .35; }
    .range .pace { fill: #3987e5; stroke: #1a1a19; stroke-width: 2; }
    .range .target { fill: #f0efec; }
    .traj .avg { fill: none; stroke: #3987e5; stroke-width: 2; stroke-linejoin: round; }
    .traj .grade { fill: #d95926; stroke: #1a1a19; stroke-width: 2; }
    .traj .hit { fill: transparent; cursor: default; }
    .traj .pt:hover .grade { r: 6; }
    .legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 6px; color: #c3c2b7; }
    .legend .sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
    .sw.band { background: rgba(57,135,229,.35); } .sw.pace, .sw.avgl { background: #3987e5; }
    .sw.target { background: #f0efec; } .sw.grade { background: #d95926; border-radius: 50%; }
    .slider { display: flex; flex-direction: column; gap: 6px; color: #c3c2b7; }
    .slider output { font-weight: 600; color: #f0efec; margin-left: 6px; }
    input[type=range] { width: 100%; accent-color: #3987e5; }
    .verdict { margin: 12px 0; padding: 10px 12px; border-radius: 8px; background: #1f1f1e; border: 1px solid #2e2e2b; }
    .verdict.bad { border-color: #8a3a2a; } .verdict.good { border-color: #2f6b45; }
    .verdict .step { font-size: 15px; }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    th { text-align: left; font-weight: 500; font-size: 11px; color: #8f8e86; padding: 6px 6px 6px 0; border-bottom: 1px solid #2e2e2b; }
    td { padding: 8px 6px 8px 0; border-bottom: 1px solid #262624; vertical-align: top; }
    .num { text-align: right; white-space: nowrap; }
    .lev { display: inline-block; width: 36px; height: 4px; background: #2e2e2b; border-radius: 4px; margin-right: 6px; vertical-align: middle; position: relative; overflow: hidden; }
    .lev::after { content: ""; position: absolute; inset: 0 auto 0 0; width: var(--w); background: #3987e5; }
    .pill { font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid #3a3a37; white-space: nowrap; }
    .pill.ok::before { content: "✓ "; } .pill.mid::before { content: "◐ "; } .pill.idle::before { content: "○ "; }
    .pill.ok { color: #9fd8b1; border-color: #2f6b45; } .pill.mid { color: #e9c47a; border-color: #6b5626; } .pill.idle { color: #c3c2b7; }
    .empty { padding: 40px 10px; text-align: center; color: #c3c2b7; } .empty.warn { color: #e9c47a; }
    .btn { display: inline-block; margin: 8px 0; padding: 8px 14px; border-radius: 8px; background: #3987e5; color: #fff; text-decoration: none; font-weight: 500; }
    footer { margin-top: 26px; line-height: 1.5; }
    .tip { position: fixed; max-width: 280px; padding: 6px 9px; background: #f0efec; color: #1a1a19; border-radius: 6px; font-size: 11px; pointer-events: none; z-index: 2147483647; }
    [hidden] { display: none !important; }`;
  }
})();
