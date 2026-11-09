/*
 * Grade Lens UI. Isolated content-script world, Shadow DOM everywhere, no dependencies.
 * Three views share one state and one set of render functions:
 *   dashboard  full-screen overlay
 *   drawer     right-side panel
 *   inline     summary bar above FOM's grid + what-if badges on FOM's own module cards
 * Grades live in memory only. View, target and your what-if picks are kept in
 * chrome.storage.local on this device.
 */
(() => {
  "use strict";
  const M = globalThis.GradeLensModel;
  if (!M || window.__gradeLensLoaded) return;
  window.__gradeLensLoaded = true;

  const STUDY_PROGRESS_PATH = "/node/6148";
  // internal id -> label shown to the user
  const VIEWS = [
    ["drawer", "Basic"],
    ["inline", "Inline"],
    ["dashboard", "Advanced"],
  ];
  const state = { data: null, error: null, view: "dashboard", target: 1.5, overrides: {}, open: false };

  // ---------- storage (device-local; falls back to memory outside the extension) ----------
  const store = {
    async load() {
      try {
        if (!chrome?.storage?.local) return;
        const s = await chrome.storage.local.get(["gl_view", "gl_target", "gl_overrides"]);
        if (VIEWS.some(([v]) => v === s.gl_view)) state.view = s.gl_view;
        if (typeof s.gl_target === "number") state.target = s.gl_target;
        if (s.gl_overrides && typeof s.gl_overrides === "object") state.overrides = s.gl_overrides;
      } catch (_) {}
    },
    save() {
      try {
        chrome?.storage?.local?.set({ gl_view: state.view, gl_target: state.target, gl_overrides: state.overrides });
      } catch (_) {}
    },
  };

  // ---------- formatting ----------
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (g) => (typeof g === "number" ? g.toFixed(1).replace(".", ",") : "–");
  const fmt2 = (g) => (typeof g === "number" ? g.toFixed(2).replace(".", ",") : "–");
  const fmtReq = (g) => (typeof g === "number" ? (Math.floor(g * 100 + 1e-9) / 100).toFixed(2).replace(".", ",") : "–");
  const fmtDate = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}` : "date tbd");
  const daysUntil = (iso) => {
    if (!iso) return null;
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const [y, m, d] = iso.split("-").map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - today) / 86400000); // calendar days
  };
  const ects = (x) => (Math.round(x * 10) / 10).toString().replace(".", ",");

  function noTranslate(el) {
    el.setAttribute("translate", "no");
    el.classList.add("notranslate");
  }

  // ---------- shared tooltip (its own shadow root so every view can use it) ----------
  const tipHost = document.createElement("div");
  noTranslate(tipHost);
  tipHost.style.cssText = "all:initial;position:fixed;z-index:2147483647;left:0;top:0;pointer-events:none;";
  const tipRoot = tipHost.attachShadow({ mode: "open" });
  tipRoot.innerHTML = `<style>.t{position:fixed;max-width:300px;padding:6px 9px;background:#0b0b0b;color:#fcfcfb;border-radius:6px;
    font:11px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}.t[hidden]{display:none}</style><div class="t" hidden></div>`;
  const tipEl = tipRoot.querySelector(".t");
  document.documentElement.appendChild(tipHost);
  function wireTips(scope) {
    scope.querySelectorAll("[data-tip]").forEach((el) => {
      if (el.__tip) return;
      el.__tip = true;
      el.addEventListener("mouseenter", () => {
        tipEl.textContent = el.getAttribute("data-tip");
        tipEl.hidden = false;
      });
      el.addEventListener("mousemove", (e) => {
        tipEl.style.left = Math.min(window.innerWidth - tipEl.offsetWidth - 8, e.clientX + 12) + "px";
        tipEl.style.top = Math.min(window.innerHeight - tipEl.offsetHeight - 8, e.clientY + 14) + "px";
      });
      el.addEventListener("mouseleave", () => (tipEl.hidden = true));
    });
  }

  // ---------- main shell: launcher + overlay (dashboard/drawer) ----------
  const host = document.createElement("div");
  host.id = "grade-lens-root";
  noTranslate(host);
  host.style.cssText = "all:initial;position:fixed;z-index:2147483646;left:0;top:0;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${BASE_CSS()}${SHELL_CSS()}</style>
    <button class="launcher" aria-label="Open Grade Lens">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 17l5-5 4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>Grade Lens</span><i class="dot" hidden></i>
    </button>
    <div class="overlay" hidden></div>`;
  document.documentElement.appendChild(host);
  const launcher = root.querySelector(".launcher");
  const overlay = root.querySelector(".overlay");
  launcher.addEventListener("click", () => setOpen(true));
  document.addEventListener("keydown", (e) => e.key === "Escape" && state.open && setOpen(false));
  wireActions(root);

  function setOpen(open) {
    state.open = open;
    renderAll();
  }

  // ---------- one event model for every view ----------
  function wireActions(scope) {
    scope.addEventListener("click", (e) => {
      const t = e.target.closest("[data-act]");
      if (!t) return;
      if (t.dataset.act === "backdrop" && e.target !== t) return; // clicks inside the dashboard
      e.preventDefault();
      e.stopPropagation(); // keep FOM's card click handlers out of it in inline mode
      const act = t.dataset.act;
      if (act === "view") {
        state.view = t.dataset.view;
        state.open = state.view !== "inline";
      } else if (act === "close") state.open = false;
      else if (act === "target") state.target = clampTarget(state.target + Number(t.dataset.delta));
      else if (act === "reset") state.overrides = {};
      else if (act === "backdrop") state.open = false;
      else return;
      store.save();
      renderAll();
    });
    scope.addEventListener("change", (e) => {
      const sel = e.target.closest("select[data-mod]");
      if (!sel) return;
      e.stopPropagation();
      const id = sel.dataset.mod;
      if (sel.value === "pace") delete state.overrides[id];
      else state.overrides[id] = Number(sel.value);
      store.save();
      renderAll();
    });
    // stop clicks on selects from triggering FOM's card navigation
    scope.addEventListener("mousedown", (e) => e.target.closest("select[data-mod], [data-act]") && e.stopPropagation(), true);
  }
  const clampTarget = (t) => Math.min(3.5, Math.max(1.0, Math.round(t * 10) / 10));

  // ---------- data in ----------
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.source !== "fom-grade-lens" || d.kind !== "studybook") return;
    try {
      state.data = M.analyse(JSON.parse(d.text));
      state.error = null;
    } catch (err) {
      state.error = `Could not read the study book: ${err.message}. FOM may have changed its data format.`;
    }
    renderAll();
  });

  // ---------- toolbar popup ----------
  function summary() {
    if (!state.data) return { view: state.view, hasData: false, error: state.error };
    const { d, wi } = compute();
    return {
      view: state.view,
      hasData: true,
      now: fmt(d.average.final),
      plan: fmt(wi.projected),
      range: `${fmt(d.range.best)}–${fmt(d.range.worst)}`,
      target: fmt(state.target),
      next: wi.perModule[0] ? { name: wi.perModule[0].name, date: fmtDate(wi.perModule[0].nextDate), days: daysUntil(wi.perModule[0].nextDate) } : null,
    };
  }
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "gl-get") reply(summary());
      else if (msg.type === "gl-set-view" && VIEWS.some(([v]) => v === msg.view)) {
        state.view = msg.view;
        state.open = msg.view !== "inline";
        store.save();
        renderAll();
        reply(summary());
      } else if (msg.type === "gl-hide") {
        state.open = false;
        renderAll();
        reply(summary());
      }
    });
  } catch (_) {
    /* outside the extension (test harness) */
  }

  // ---------- derived ----------
  function compute() {
    const d = state.data;
    const wi = M.whatIf(d.modules, state.overrides, state.target);
    return { d, wi };
  }

  // ---------- render orchestration ----------
  function renderAll() {
    root.querySelector(".dot").hidden = !state.data;
    launcher.hidden = state.open || (state.view === "inline" && !!state.data);
    renderOverlay();
    renderInline();
  }

  function renderOverlay() {
    const show = state.open && state.view !== "inline";
    overlay.hidden = !show;
    if (!show) return;
    overlay.className = `overlay ${state.view}`;
    let inner;
    if (state.error) inner = shellFrame(`<div class="empty warn">${esc(state.error)}</div>`);
    else if (!state.data) inner = shellFrame(emptyState());
    else inner = state.view === "dashboard" ? dashboardView() : drawerView();
    overlay.innerHTML = state.view === "dashboard" ? `<div class="backdrop" data-act="backdrop">${inner}</div>` : inner;
    wireTips(overlay);
  }

  function shellFrame(body) {
    return `<section class="frame"><header class="bar">${brand()}${viewSwitch()}<button class="icon" data-act="close" aria-label="Close">✕</button></header><div class="scroll">${body}</div></section>`;
  }
  const brand = () => `<div class="brand"><strong>Grade Lens</strong><span class="muted small">computed in your browser · nothing leaves it</span></div>`;
  const emptyState = () => `<div class="empty"><p>No grade data on this page yet.</p>
      <a class="btn" href="${STUDY_PROGRESS_PATH}">Open Study progress</a>
      <p class="muted small">Grade Lens reads the study book that page already loads.</p></div>`;

  function viewSwitch() {
    return `<div class="seg" role="tablist" aria-label="View">${VIEWS.map(
      ([v, label]) => `<button role="tab" aria-selected="${state.view === v}" class="${state.view === v ? "on" : ""}" data-act="view" data-view="${v}">${label}</button>`
    ).join("")}</div>`;
  }

  function targetControl() {
    return `<div class="target" aria-label="Target final grade"><span class="muted small">Target</span>
      <button class="step" data-act="target" data-delta="-0.1" aria-label="Target 0,1 lower (better grade)">−</button>
      <b>${fmt(state.target)}</b>
      <button class="step" data-act="target" data-delta="0.1" aria-label="Target 0,1 higher">+</button></div>`;
  }

  // ---------- views ----------
  function dashboardView() {
    const { d, wi } = compute();
    const r = d.range;
    const thesis = d.thesisAdmissionEcts;
    return `<section class="frame dash">
      <header class="bar">${brand()}<div class="spacer"></div>${targetControl()}${viewSwitch()}<button class="icon" data-act="close" aria-label="Close">✕</button></header>
      <div class="scroll"><div class="dgrid">
        <article class="card hero">
          <div class="heroNums">
            <div><span class="label">Current average</span><span class="big">${fmt(d.average.final)}</span><span class="muted small">${fmt2(d.average.raw)} raw · ${esc(M.gradeLabel(d.average.final))}</span></div>
            <div><span class="label">Your plan lands at</span><span class="big accent">${fmt(wi.projected)}</span><span class="muted small">${planNote(wi)}</span></div>
            <div><span class="label">Still possible</span><span class="big">${fmt(r.best)}<small> – ${fmt(r.worst)}</small></span><span class="muted small">${Math.round(r.lockedShare * 100)}% of the final grade is locked in</span></div>
          </div>
          ${rangeFigure(d, wi, 1100)}
          ${needBanner(wi)}
        </article>
        <article class="card plan"><div class="cardHead"><h3>Plan your remaining exams</h3>${resetBtn()}</div>${whatIfTable(wi, false)}</article>
        <div class="side">
          <article class="card"><h3>Grade trajectory</h3>${trajectoryChart(d.trajectory, 520, 220)}</article>
          <article class="card"><h3>Progress</h3>
            ${meter("ECTS earned", d.ectsEarned, d.ectsTotal)}
            ${thesis ? meter("ECTS for thesis admission", Math.min(d.ectsEarned, thesis), thesis) : ""}
          </article>
        </div>
      </div>${assumptions(d)}</div></section>`;
  }

  function drawerView() {
    const { d, wi } = compute();
    return `<section class="frame drawer">
      <header class="bar">${brand()}<button class="icon" data-act="close" aria-label="Close">✕</button></header>
      <div class="sub">${viewSwitch()}${targetControl()}</div>
      <div class="scroll">
        ${needBanner(wi)}
        <div class="cardHead"><h3>Next up</h3>${resetBtn()}</div>
        ${whatIfTable(wi, true)}
        <h3 class="mt">Where the final can land</h3>${rangeFigure(d, wi, 400)}
        <h3 class="mt">Trajectory</h3>${trajectoryChart(d.trajectory, 400, 170)}
        ${assumptions(d)}
      </div></section>`;
  }

  // ---------- building blocks ----------
  function planNote(wi) {
    const mine = wi.perModule.filter((m) => m.source === "you").length;
    return mine ? `${mine} of ${wi.perModule.length} modules set by you, the rest at your pace (${fmt(wi.pace)})` : `all open modules at your pace (${fmt(wi.pace)})`;
  }

  function needBanner(wi) {
    const n = wi.need;
    if (!n) return "";
    const leftOnPace = wi.perModule.filter((m) => m.source === "pace").length;
    let cls = "", msg;
    if (n.status === "met") (cls = "good"), (msg = `Your plan reaches <b>${fmt(state.target)}</b>.`);
    else if (n.status === "missed") (cls = "bad"), (msg = `Your plan lands at ${fmt(wi.projected)} and misses ${fmt(state.target)}. Raise some of your picks.`);
    else if (n.status === "unreachable")
      (cls = "bad"),
        (msg = `<b>${fmt(state.target)} is out of reach</b> with your current picks, even with 1,0 in the ${leftOnPace} module${leftOnPace === 1 ? "" : "s"} you left open.`);
    else if (n.status === "secured-with-any-pass")
      (cls = "good"), (msg = `<b>${fmt(state.target)} is safe.</b> Passing the ${leftOnPace} module${leftOnPace === 1 ? "" : "s"} you left open is enough.`);
    else
      msg = `For <b>${fmt(state.target)}</b>, the ${leftOnPace} module${leftOnPace === 1 ? "" : "s"} you haven't set need an average of <b>${fmtReq(n.x)}</b>, so <b class="stepv">${fmt(n.step)}</b> or better in each.`;
    return `<p class="need ${cls}">${msg}</p>`;
  }

  const resetBtn = () => (Object.keys(state.overrides).length ? `<button class="link" data-act="reset">Reset picks</button>` : "");

  function gradeSelect(m) {
    const opts = [`<option value="pace"${m.source === "pace" ? " selected" : ""}>pace ${fmt(m.expected)}</option>`]
      .concat(M.GRADE_STEPS.map((s) => `<option value="${s}"${m.source === "you" && m.expected === s ? " selected" : ""}>${fmt(s)}</option>`))
      .join("");
    return `<select data-mod="${m.id}" class="${m.source}" aria-label="Expected grade for ${esc(m.name)}">${opts}</select>`;
  }

  function whenChip(iso) {
    const dd = daysUntil(iso);
    if (!iso) return `<span class="chip">date tbd</span>`;
    const urgent = dd !== null && dd >= 0 && dd <= 14;
    const rel = dd === null || dd < 0 ? "" : dd === 0 ? " · today" : ` · in ${dd} d`;
    return `<span class="chip${urgent ? " urgent" : ""}">${fmtDate(iso)}${rel}</span>`;
  }

  // mini bar: where this module can still end (best–worst), with the current pick marked
  function moduleSpan(m, w = 90) {
    const x = (g) => 2 + ((g - 1) / 3) * (w - 4);
    return `<svg viewBox="0 0 ${w} 14" width="${w}" height="14" class="span" role="img"
      aria-label="Module can end between ${fmt(m.moduleBest)} and ${fmt(m.moduleWorst)}; your pick gives ${fmt(m.projectedModuleGrade)}"
      data-tip="Module can still end between ${fmt(m.moduleBest)} and ${fmt(m.moduleWorst)} · with this pick: ${fmt(m.projectedModuleGrade)}">
      <line x1="2" x2="${w - 2}" y1="7" y2="7" class="rail"/>
      <rect x="${x(m.moduleBest)}" y="4" width="${Math.max(2, x(m.moduleWorst) - x(m.moduleBest))}" height="6" rx="3" class="spanBand"/>
      <circle cx="${x(m.projectedModuleGrade)}" cy="7" r="4" class="spanPick"/></svg>`;
  }

  function whatIfTable(wi, compact) {
    if (!wi.perModule.length) return `<p class="muted">Nothing left open. Congratulations.</p>`;
    const rows = wi.perModule
      .map((m) => {
        const parts = m.openParts.map((p) => `${esc(p.name)} ${Math.round(p.weight * 100)}%`).join(" · ");
        const done = m.knownWeight > 0 ? ` · ${Math.round(m.knownWeight * 100)}% already graded` : "";
        return `<div class="row">
          <div class="who"><b>${esc(m.name)}</b><span class="muted small">${m.credits} ECTS · ${parts}${done}</span></div>
          <div class="when">${whenChip(m.nextDate)}</div>
          ${compact ? "" : `<div class="lev" data-tip="${Math.round(m.leverage * 100)}% of everything still open is in this module"><i style="width:${Math.max(3, Math.round(m.leverage * 100))}%"></i><span class="small">${Math.round(m.leverage * 100)}%</span></div>`}
          ${compact ? "" : moduleSpan(m)}
          <div class="pick">${gradeSelect(m)}</div>
          <div class="res" data-tip="Module grade with this pick">${fmt(m.projectedModuleGrade)}</div>
        </div>`;
      })
      .join("");
    const head = compact
      ? `<div class="row head"><span>Module</span><span>Next date</span><span>Your pick</span><span>Module</span></div>`
      : `<div class="row head"><span>Module</span><span>Next date</span><span>Share of open</span><span>Can still end</span><span>Your pick</span><span>Module</span></div>`;
    return `<div class="wi ${compact ? "compact" : ""}">${head}${rows}</div>`;
  }

  // 1,0 on the left. Band = still possible; dot = your plan; triangle = target.
  function rangeFigure(d, wi, W) {
    const r = d.range;
    const pad = 18, x = (g) => pad + ((g - 1) / 3) * (W - 2 * pad);
    const ticks = [1, 1.5, 2, 2.5, 3, 3.5, 4]
      .map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="40" y2="45" class="axis"/><text x="${x(t)}" y="60" class="tick">${fmt(t)}</text>`)
      .join("");
    const cur = d.average.final;
    return `<svg viewBox="0 0 ${W} 66" class="range" role="img" aria-label="Final grade still possible from ${fmt(r.best)} to ${fmt(r.worst)}; your plan lands at ${fmt(wi.projected)}; target ${fmt(state.target)}">
      <line x1="${pad}" x2="${W - pad}" y1="40" y2="40" class="axis"/>${ticks}
      <rect x="${x(r.best)}" y="24" width="${Math.max(2, x(r.worst) - x(r.best))}" height="12" rx="4" class="band"
        data-tip="Still possible: ${fmt(r.best)} (1,0 in everything open) to ${fmt(r.worst)} (4,0 in everything open)"/>
      ${cur != null ? `<line x1="${x(cur)}" x2="${x(cur)}" y1="20" y2="40" class="nowLine" data-tip="Current average ${fmt(cur)}"/>` : ""}
      <circle cx="${x(wi.projected)}" cy="30" r="7" class="plan" data-tip="Your plan lands at ${fmt(wi.projected)}"/>
      <path d="M${x(state.target)} 17 l-6 -9 h12 z" class="tgt" data-tip="Target ${fmt(state.target)}"/>
    </svg>
    <div class="legend small"><span><i class="sw band"></i>still possible</span><span><i class="sw plan"></i>your plan ${fmt(wi.projected)}</span><span><i class="sw now"></i>current ${fmt(cur)}</span><span><i class="sw tgt"></i>target ${fmt(state.target)}</span></div>`;
  }

  // time axis by exam date; 1,0 at the top
  function trajectoryChart(t, W, H) {
    const pts = t.filter((p) => p.date);
    if (pts.length < 2) return `<p class="muted">Needs at least two graded modules.</p>`;
    const L = 30, R = 34, T = 10, B = 24;
    const ts = pts.map((p) => +new Date(p.date));
    const t0 = Math.min(...ts), t1 = Math.max(...ts);
    const xs = (d) => L + ((+new Date(d) - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    const worst = Math.max(...pts.map((p) => p.grade));
    const hi = Math.min(4, Math.max(2.5, Math.ceil(worst * 2) / 2));
    const ys = (g) => T + ((g - 1) / (hi - 1)) * (H - T - B);
    const grid = [];
    for (let g = 1; g <= hi + 1e-9; g += 0.5)
      grid.push(`<line x1="${L}" x2="${W - R}" y1="${ys(g)}" y2="${ys(g)}" class="grid"/><text x="${L - 6}" y="${ys(g) + 3}" class="tick end">${fmt(g)}</text>`);
    // semester labels at the first exam of each semester
    const sem = pts
      .filter((p, i) => i === 0 || pts[i - 1].semester !== p.semester)
      .map((p) => `<text x="${xs(p.date)}" y="${H - 6}" class="tick start">Sem ${p.semester} · ${fmtDate(p.date).slice(3)}</text>`)
      .join("");
    const line = pts.map((p, i) => `${i ? "L" : "M"}${xs(p.date).toFixed(1)} ${ys(p.runningAverageRaw).toFixed(1)}`).join(" ");
    const last = pts[pts.length - 1];
    const dots = pts
      .map(
        (p) => `<g data-tip="${esc(`${p.module} · ${fmt(p.grade)} · ${p.credits} ECTS · ${fmtDate(p.date)} · running average ${fmt(p.runningAverage)}`)}">
        <circle cx="${xs(p.date)}" cy="${ys(p.grade)}" r="11" class="hit"/><circle cx="${xs(p.date)}" cy="${ys(p.grade)}" r="4.5" class="g"/></g>`
      )
      .join("");
    return `<svg viewBox="0 0 ${W} ${H}" class="traj" role="img" aria-label="Module grades by exam date with running ECTS-weighted average, now ${fmt(last.runningAverage)}">
      <text x="${L}" y="${T - 2}" class="tick start">better ↑</text>
      ${grid.join("")}${sem}<path d="${line}" class="avg"/>${dots}
      <text x="${W - R + 4}" y="${ys(last.runningAverageRaw) + 3}" class="lbl">${fmt(last.runningAverage)}</text></svg>
      <div class="legend small"><span><i class="sw g"></i>module grade</span><span><i class="sw avg"></i>running average</span></div>`;
  }

  function meter(label, v, of) {
    const pct = Math.round((v / of) * 100);
    return `<div class="meter"><div class="meterTop"><span>${esc(label)}</span><b>${v}<span class="muted"> / ${of}</span></b></div>
      <span class="mbar" role="img" aria-label="${pct}%"><i style="width:${pct}%"></i></span></div>`;
  }

  function assumptions(d) {
    return `<footer class="muted small">Final grade assumed to be the ECTS-weighted mean of all graded modules (thesis included),
      truncated after the first decimal as the portal does for module grades. Not yet checked against the Prüfungsordnung.
      Modules you don't set run at your pace (your average, rounded to the nearest official grade).
      ${d.warnings.map((w) => `<br>⚠ ${esc(w)}`).join("")}</footer>`;
  }

  // ---------- inline view: summary bar + badges on FOM's own cards ----------
  let inlineBar = null;
  let observer = null;

  function renderInline() {
    const on = state.view === "inline" && !!state.data && !state.error;
    if (!on) {
      removeInline();
      return;
    }
    placeBar();
    placeBadges();
    if (!observer) {
      let pending = null;
      observer = new MutationObserver(() => {
        if (pending) return;
        pending = setTimeout(() => {
          pending = null;
          if (state.view === "inline") {
            placeBar();
            placeBadges();
          }
        }, 300);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function removeInline() {
    if (observer) observer.disconnect(), (observer = null);
    if (inlineBar) inlineBar.remove(), (inlineBar = null);
    document.querySelectorAll(".gl-badge-host").forEach((n) => n.remove());
  }

  function placeBar() {
    const firstSem = document.querySelector(".semester-header");
    if (!firstSem) return;
    // the grid that holds every semester column
    let grid = firstSem;
    while (grid.parentElement && grid.parentElement.querySelectorAll(".semester-header").length < document.querySelectorAll(".semester-header").length)
      grid = grid.parentElement;
    grid = grid.parentElement || grid;
    if (!inlineBar || !inlineBar.isConnected) {
      inlineBar = document.createElement("div");
      inlineBar.className = "gl-bar-host";
      noTranslate(inlineBar);
      inlineBar.style.cssText = "all:initial;display:block;margin:0 8px 12px;";
      const sr = inlineBar.attachShadow({ mode: "open" });
      sr.innerHTML = `<style>${BASE_CSS()}${INLINE_CSS()}</style><div class="ibar"></div>`;
      wireActions(sr);
      grid.parentElement.insertBefore(inlineBar, grid);
    }
    const { d, wi } = compute();
    const sr = inlineBar.shadowRoot;
    sr.querySelector(".ibar").innerHTML = `
      <div class="ib-left"><strong>Grade Lens</strong>
        <span class="kv"><span class="muted small">now</span><b>${fmt(d.average.final)}</b></span>
        <span class="kv"><span class="muted small">your plan</span><b class="accent">${fmt(wi.projected)}</b></span>
        <span class="kv"><span class="muted small">possible</span><b>${fmt(d.range.best)}–${fmt(d.range.worst)}</b></span>
        ${targetControl()}</div>
      <div class="ib-right">${viewSwitch()}</div>
      <div class="ib-need">${needBanner(wi)}<span class="muted small">Set your expected grade on each open module card below. ${resetBtn()}</span></div>`;
    wireTips(sr);
  }

  function placeBadges() {
    const { d, wi } = compute();
    const cards = [...document.querySelectorAll(".course-element")];
    // fail safe: only attach when the cards line up 1:1 with the data (count and ECTS order)
    const ok =
      cards.length === d.modules.length &&
      cards.every((c, i) => new RegExp(`^\\s*${d.modules[i].credits}\\s*ECTS`).test(c.innerText));
    if (!ok) {
      document.querySelectorAll(".gl-badge-host").forEach((n) => n.remove());
      return;
    }
    const byId = Object.fromEntries(wi.perModule.map((m) => [String(m.id), m]));
    cards.forEach((card, i) => {
      const m = byId[String(d.modules[i].id)];
      let hostEl = card.querySelector(":scope .gl-badge-host");
      if (!m) {
        if (hostEl) hostEl.remove();
        return;
      }
      if (!hostEl) {
        hostEl = document.createElement("div");
        hostEl.className = "gl-badge-host";
        noTranslate(hostEl);
        hostEl.style.cssText = "all:initial;display:block;padding:0 16px 14px;";
        const sr = hostEl.attachShadow({ mode: "open" });
        sr.innerHTML = `<style>${BASE_CSS()}${BADGE_CSS()}</style><div class="bd"></div>`;
        wireActions(sr);
        (card.firstElementChild || card).appendChild(hostEl);
      }
      const need = wi.need && wi.need.status === "reachable" && m.source === "pace" ? `need ≥ ${fmt(wi.need.step)}` : "";
      hostEl.shadowRoot.querySelector(".bd").innerHTML = `
        ${whenChip(m.nextDate)}
        <span class="pk"><span class="muted small">pick</span>${gradeSelect(m)}</span>
        <span class="res" data-tip="Module grade with this pick · can still end ${fmt(m.moduleBest)}–${fmt(m.moduleWorst)}">→ ${fmt(m.projectedModuleGrade)}</span>
        ${need ? `<span class="needchip">${need}</span>` : ""}`;
      wireTips(hostEl.shadowRoot);
    });
  }

  // ---------- styles ----------
  function BASE_CSS() {
    return `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .root, .frame, .ibar, .bd, .launcher { font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0b0b0b; }
    .muted { color: #6b6a65; } .small { font-size: 11px; } .accent { color: #2a78d6; }
    b, strong { font-weight: 600; }
    h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #6b6a65; font-weight: 600; margin: 0 0 10px; }
    .mt { margin-top: 22px; }
    .seg { display: inline-flex; background: #efefec; border-radius: 8px; padding: 2px; gap: 2px; }
    .seg button { border: 0; background: transparent; padding: 5px 10px; border-radius: 6px; font: inherit; font-size: 12px; color: #52514e; cursor: pointer; }
    .seg button.on { background: #fff; color: #0b0b0b; box-shadow: 0 1px 2px rgba(0,0,0,.12); font-weight: 600; }
    .target { display: inline-flex; align-items: center; gap: 6px; }
    .target b { min-width: 26px; text-align: center; font-size: 14px; font-variant-numeric: tabular-nums; }
    .step { width: 24px; height: 24px; border-radius: 6px; border: 1px solid #dcdcd7; background: #fff; cursor: pointer; font: inherit; line-height: 1; }
    .step:hover, .icon:hover { background: #f3f3f0; }
    .icon { border: 0; background: transparent; width: 30px; height: 30px; border-radius: 8px; cursor: pointer; font-size: 14px; color: #52514e; }
    .link { border: 0; background: none; color: #2a78d6; font: inherit; font-size: 12px; cursor: pointer; padding: 0; }
    .need { margin: 12px 0; padding: 10px 12px; border-radius: 8px; background: #f3f6fb; border: 1px solid #d6e3f5; }
    .need.good { background: #f1f8f1; border-color: #c6e3c6; } .need.bad { background: #fdf3f3; border-color: #f0cccc; }
    .need .stepv { font-size: 15px; }
    .chip { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #efefec; color: #3d3c39; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .chip.urgent { background: #fff1e6; color: #9a3a0d; box-shadow: inset 0 0 0 1px #f3c9a8; }
    .chip.urgent::before { content: "● "; color: #eb6834; }
    select { font: inherit; font-size: 12px; padding: 3px 6px; border-radius: 6px; border: 1px solid #dcdcd7; background: #fff; color: #0b0b0b; cursor: pointer; font-variant-numeric: tabular-nums; }
    select.pace { color: #6b6a65; border-style: dashed; }
    select.you { border-color: #2a78d6; box-shadow: 0 0 0 1px #2a78d6 inset; }
    svg { display: block; overflow: visible; }
    .axis { stroke: #b9b8b1; stroke-width: 1; } .grid { stroke: #ecece8; stroke-width: 1; }
    .tick { fill: #6b6a65; font-size: 10px; text-anchor: middle; } .tick.end { text-anchor: end; } .tick.start { text-anchor: start; }
    .lbl { fill: #0b0b0b; font-size: 11px; font-weight: 600; }
    .range { width: 100%; height: auto; }
    .range .band { fill: #2a78d6; opacity: .18; }
    .range .plan { fill: #2a78d6; stroke: #fff; stroke-width: 2; }
    .range .nowLine { stroke: #0b0b0b; stroke-width: 2; }
    .range .tgt { fill: #0b0b0b; }
    .traj { width: 100%; height: auto; }
    .traj .avg { fill: none; stroke: #2a78d6; stroke-width: 2; stroke-linejoin: round; }
    .traj .g { fill: #eb6834; stroke: #fff; stroke-width: 2; }
    .traj .hit { fill: transparent; }
    .legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 6px; color: #52514e; }
    .sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
    .sw.band { background: rgba(42,120,214,.25); } .sw.plan, .sw.avg { background: #2a78d6; }
    .sw.plan, .sw.g { border-radius: 50%; } .sw.g { background: #eb6834; }
    .sw.now { background: #0b0b0b; width: 3px; } .sw.tgt { background: #0b0b0b; clip-path: polygon(0 0,100% 0,50% 100%); }
    .span .rail { stroke: #dcdcd7; stroke-width: 1; } .span .spanBand { fill: #2a78d6; opacity: .2; }
    .span .spanPick { fill: #2a78d6; stroke: #fff; stroke-width: 1.5; }
    .empty { padding: 48px 12px; text-align: center; color: #3d3c39; } .empty.warn { color: #9a3a0d; }
    .btn { display: inline-block; margin: 8px 0; padding: 8px 14px; border-radius: 8px; background: #2a78d6; color: #fff; text-decoration: none; font-weight: 600; }
    footer { margin-top: 24px; line-height: 1.5; }
    [hidden] { display: none !important; }`;
  }

  function SHELL_CSS() {
    return `
    .launcher { position: fixed; left: 72px; bottom: 18px; display: flex; gap: 8px; align-items: center; padding: 9px 14px; cursor: pointer;
      background: #fff; border: 1px solid #dcdcd7; border-radius: 999px; box-shadow: 0 4px 18px rgba(0,0,0,.12); font-weight: 600; }
    .launcher:hover { border-color: #2a78d6; }
    .launcher .dot { width: 7px; height: 7px; border-radius: 50%; background: #2a78d6; }
    .frame { background: #fcfcfb; display: flex; flex-direction: column; }
    .bar { display: flex; align-items: center; gap: 14px; padding: 12px 18px; border-bottom: 1px solid #ecece8; background: #fff; }
    .brand { display: flex; flex-direction: column; } .brand strong { font-size: 14px; }
    .spacer { flex: 1; }
    .scroll { overflow-y: auto; }
    /* dashboard */
    .backdrop { position: fixed; inset: 0; background: rgba(20,20,18,.35); display: flex; }
    .dash { position: fixed; inset: 16px; border-radius: 14px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.25); }
    .dash .bar .brand { margin-right: auto; }
    .dash .scroll { padding: 18px; }
    .dgrid { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 14px; max-width: 1400px; margin: 0 auto; }
    .card { background: #fff; border: 1px solid #ecece8; border-radius: 12px; padding: 16px 18px; }
    .hero { grid-column: 1 / -1; }
    .heroNums { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 8px; }
    .heroNums > div { display: flex; flex-direction: column; gap: 2px; }
    .label { font-size: 12px; color: #52514e; }
    .big { font-size: 40px; font-weight: 650; letter-spacing: -.03em; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .big small { font-size: 22px; color: #6b6a65; font-weight: 500; }
    .side { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
    .cardHead { display: flex; justify-content: space-between; align-items: baseline; }
    .meter { margin: 8px 0 14px; } .meterTop { display: flex; justify-content: space-between; margin-bottom: 6px; }
    .mbar { display: block; height: 6px; background: #efefec; border-radius: 4px; overflow: hidden; } .mbar i { display: block; height: 100%; background: #2a78d6; border-radius: 4px; }
    /* what-if table */
    .wi .row { display: grid; grid-template-columns: minmax(0, 2.4fr) 1.3fr 0.9fr 96px 92px 40px; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f0f0ec; }
    .wi.compact .row { grid-template-columns: minmax(0, 1fr) auto 84px 30px; gap: 8px; }
    .wi .row.head { font-size: 11px; color: #6b6a65; padding: 0 0 6px; }
    .wi .who { display: flex; flex-direction: column; min-width: 0; } .wi .who b { font-weight: 600; }
    .wi .res { text-align: right; font-weight: 650; font-variant-numeric: tabular-nums; }
    .wi .lev { display: flex; align-items: center; gap: 6px; }
    .wi .lev i { display: block; height: 6px; background: #2a78d6; border-radius: 3px; max-width: 48px; }
    /* drawer */
    .drawer { position: fixed; top: 0; right: 0; height: 100vh; width: min(440px, 100vw); border-left: 1px solid #ecece8; box-shadow: -10px 0 40px rgba(0,0,0,.12); }
    .drawer .sub { display: flex; justify-content: space-between; align-items: center; padding: 10px 18px; border-bottom: 1px solid #ecece8; background: #fff; }
    .drawer .scroll { padding: 4px 18px 28px; flex: 1; }
    .drawer .cardHead { margin-top: 6px; }`;
  }

  function INLINE_CSS() {
    return `
    .ibar { display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; align-items: center; background: #fff; border: 1px solid #e4e4df;
      border-left: 3px solid #2a78d6; border-radius: 10px; padding: 12px 16px; }
    .ib-left { display: flex; flex-wrap: wrap; align-items: center; gap: 18px; }
    .ib-left strong { font-size: 14px; }
    .kv { display: inline-flex; align-items: baseline; gap: 6px; } .kv b { font-size: 18px; font-variant-numeric: tabular-nums; }
    .ib-need { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; }
    .ib-need .need { margin: 0; padding: 6px 10px; }`;
  }

  function BADGE_CSS() {
    return `
    .bd { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding-top: 10px; border-top: 1px dashed #e4e4df; }
    .pk { display: inline-flex; align-items: center; gap: 4px; }
    .res { font-weight: 650; font-variant-numeric: tabular-nums; font-size: 12px; }
    .needchip { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #eaf2fc; color: #1d5aa6; }`;
  }

  // ---------- boot ----------
  store.load().then(() => {
    window.postMessage({ source: "fom-grade-lens-panel", kind: "request" }, location.origin);
    renderAll();
  });
})();
