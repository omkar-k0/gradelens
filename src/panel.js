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
  const I = globalThis.GradeLensI18n;
  if (!M || !I || window.__gradeLensLoaded) return;
  const t = (k, v) => I.t(k, v);
  window.__gradeLensLoaded = true;

  const STUDY_PROGRESS_PATH = "/node/6148";
  const STUDYBOOK_URL = /^https:\/\/oc-digital\.de\/campus\/api\/epm\/studybook\/\d{1,12}(\?[^#]*)?$/;
  const MAX_PAYLOAD = 5 * 1024 * 1024; // the real response is ~110 KB
  // internal id -> label shown to the user
  const VIEWS = [
    ["drawer", "viewBasic"],
    ["inline", "viewInline"],
    ["dashboard", "viewAdvanced"],
  ];
  const state = { data: null, error: null, view: "dashboard", target: 1.5, overrides: {}, open: false, lang: "auto" };

  // ---------- storage (device-local; falls back to memory outside the extension) ----------
  const store = {
    async load() {
      try {
        if (!chrome?.storage?.local) return;
        const s = await chrome.storage.local.get(["gl_view", "gl_target", "gl_overrides", "gl_lang"]);
        if (s.gl_lang === "en" || s.gl_lang === "de") state.lang = s.gl_lang;
        if (VIEWS.some(([v]) => v === s.gl_view)) state.view = s.gl_view;
        if (typeof s.gl_target === "number") state.target = s.gl_target;
        if (s.gl_overrides && typeof s.gl_overrides === "object") state.overrides = s.gl_overrides;
      } catch (_) {}
    },
    save() {
      try {
        chrome?.storage?.local?.set({ gl_view: state.view, gl_target: state.target, gl_overrides: state.overrides, gl_lang: state.lang });
      } catch (_) {}
    },
  };

  // ---------- formatting ----------
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (g) => (typeof g === "number" ? g.toFixed(1).replace(".", ",") : "–");
  const fmt2 = (g) => (typeof g === "number" ? g.toFixed(2).replace(".", ",") : "–");
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const fmtDate = (iso) => (typeof iso === "string" && ISO.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}` : t("dateTbd"));
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
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

  // ---------- fonts: IBM Plex, bundled with the extension (no requests to any font server) ----------
  try {
    if (chrome?.runtime?.getURL) {
      const u = (f) => chrome.runtime.getURL(`fonts/${f}`);
      const face = (fam, file, w) =>
        `@font-face{font-family:"${fam}";src:url("${u(file)}") format("woff2");font-weight:${w};font-style:normal;font-display:swap}`;
      const st = document.createElement("style");
      st.textContent = [
        face("GL Plex Sans", "ibm-plex-sans-latin-400-normal.woff2", 400),
        face("GL Plex Sans", "ibm-plex-sans-latin-500-normal.woff2", 500),
        face("GL Plex Sans", "ibm-plex-sans-latin-600-normal.woff2", 600),
        face("GL Plex Mono", "ibm-plex-mono-latin-400-normal.woff2", 400),
      ].join("");
      (document.head || document.documentElement).appendChild(st);
    }
  } catch (_) {
    /* outside the extension: system fonts */
  }

  // ---------- shared tooltip (its own shadow root so every view can use it) ----------
  const tipHost = document.createElement("div");
  noTranslate(tipHost);
  tipHost.style.cssText = "all:initial;position:fixed;z-index:2147483647;left:0;top:0;pointer-events:none;";
  const tipRoot = tipHost.attachShadow({ mode: "open" });
  tipRoot.innerHTML = `<style>.t{position:fixed;max-width:300px;padding:6px 9px;background:#111111;color:#f2f2f0;border-radius:2px;
    font:11px/1.45 "GL Plex Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}.t[hidden]{display:none}</style><div class="t" hidden></div>`;
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
    <button class="launcher" aria-label="Grade Lens">
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
      else if (act === "lang") I.setLang((state.lang = I.lang === "de" ? "en" : "de"));
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
    // Untrusted channel: any script on the page can post here. Check what we can, and
    // rely on the model's validation boundary plus escaping for the rest.
    if (typeof d.url !== "string" || !STUDYBOOK_URL.test(d.url)) return;
    if (typeof d.text !== "string" || d.text.length > MAX_PAYLOAD) {
      state.error = { key: "errTooLarge" };
      renderAll();
      return;
    }
    try {
      state.data = M.analyse(JSON.parse(d.text));
      state.error = null;
    } catch (err) {
      state.error = { key: err && err.code === "UNSUPPORTED_GRADING" ? "errGrading" : "errRead", msg: String((err && err.message) || "") };
      state.data = null;
    }
    renderAll();
  });

  // ---------- toolbar popup ----------
  function summary() {
    if (!state.data) return { view: state.view, lang: I.lang, hasData: false, error: errText() };
    const { d, wi } = compute();
    return {
      view: state.view,
      lang: I.lang,
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
      } else if (msg.type === "gl-set-lang" && ["en", "de", "auto"].includes(msg.lang)) {
        state.lang = msg.lang;
        I.setLang(state.lang);
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
    const inlineWorking = state.view === "inline" && !!state.data && !state.error;
    launcher.hidden = state.open || inlineWorking;
    launcher.classList.toggle("warn", !!state.error);
    renderOverlay();
    renderInline();
  }

  function renderOverlay() {
    // inline has no panel of its own, so errors / empty states fall back to the drawer frame
    const inlineFallback = state.view === "inline" && (!state.data || !!state.error);
    const show = state.open && (state.view !== "inline" || inlineFallback);
    overlay.hidden = !show;
    if (!show) return;
    overlay.className = `overlay ${inlineFallback ? "drawer" : state.view}`;
    let inner;
    if (state.error) inner = shellFrame(`<div class="empty warn" role="alert">${esc(errText())}</div>`);
    else if (!state.data) inner = shellFrame(emptyState());
    else inner = state.view === "dashboard" ? dashboardView() : drawerView();
    overlay.innerHTML = state.view === "dashboard" ? `<div class="backdrop" data-act="backdrop">${inner}</div>` : inner;
    wireTips(overlay);
  }

  function shellFrame(body) {
    return `<section class="frame drawer"><header class="bar">${brand()}${viewSwitch()}${langBtn()}${closeBtn()}</header><div class="scroll">${body}</div></section>`;
  }
  function errText() {
    return state.error ? t(state.error.key, { msg: state.error.msg }) : null;
  }
  const brand = () => `<div class="brand"><strong>Grade Lens</strong><span class="muted small">${t("brandSub")}</span></div>`;
  const closeBtn = () => `<button class="icon" data-act="close" aria-label="${t("close")}">✕</button>`;
  const langBtn = () => `<button class="link lang" data-act="lang" aria-label="${t("langSwitchAria")}" lang="${I.lang === "de" ? "en" : "de"}">${t("langSwitch")}</button>`;
  const emptyState = () => `<div class="empty"><p>${t("emptyNone")}</p>
      <a class="btn" href="${STUDY_PROGRESS_PATH}">${t("emptyOpen")}</a>
      <p class="muted small">${t("emptyHow")}</p></div>`;

  function viewSwitch() {
    return `<div class="seg" role="tablist" aria-label="${t("viewAria")}">${VIEWS.map(
      ([v, key]) => `<button role="tab" aria-selected="${state.view === v}" class="${state.view === v ? "on" : ""}" data-act="view" data-view="${v}">${t(key)}</button>`
    ).join("")}</div>`;
  }

  function targetControl() {
    return `<div class="target" aria-label="${t("targetAria")}"><span class="muted small">${t("target")}</span>
      <button class="step" data-act="target" data-delta="-0.1" aria-label="${t("targetLower")}">−</button>
      <b>${fmt(state.target)}</b>
      <button class="step" data-act="target" data-delta="0.1" aria-label="${t("targetHigher")}">+</button></div>`;
  }

  // ---------- views ----------
  function dashboardView() {
    const { d, wi } = compute();
    const r = d.range;
    const thesis = d.thesisAdmissionEcts;
    return `<section class="frame dash">
      <header class="bar">${brand()}<div class="spacer"></div>${targetControl()}${viewSwitch()}${langBtn()}${closeBtn()}</header>
      <div class="scroll"><div class="dgrid">
        <article class="card hero">
          <div class="heroNums">
            <div><span class="label">${t("currentAverage")}</span><span class="big">${fmt(d.average.final)}</span><span class="muted small">${t("raw", { raw: fmt2(d.average.raw), label: esc(M.gradeLabel(d.average.final)) })}</span></div>
            <div><span class="label">${t("planLands")}</span><span class="big accent">${fmt(wi.projected)}</span><span class="muted small">${planNote(wi)}</span></div>
            <div><span class="label">${t("stillPossible")}</span><span class="big">${fmt(r.best)}<small> – ${fmt(r.worst)}</small></span><span class="muted small">${t("locked", { pct: Math.round(r.lockedShare * 100) })}</span></div>
          </div>
          ${rangeFigure(d, wi, 1100)}
          ${needBanner(wi)}
        </article>
        <article class="card plan"><div class="cardHead"><h3>${t("planRemaining")}</h3>${resetBtn()}</div>${whatIfTable(wi, false)}</article>
        <div class="side">
          <article class="card"><h3>${t("trajectory")}</h3>${trajectoryChart(d.trajectory, 520, 220)}</article>
          <article class="card"><h3>${t("progress")}</h3>
            ${meter(t("ectsEarned"), d.ectsEarned, d.ectsTotal)}
            ${thesis ? meter(t("ectsThesis"), Math.min(d.ectsEarned, thesis), thesis) : ""}
          </article>
        </div>
      </div>${assumptions(d)}</div></section>`;
  }

  function drawerView() {
    const { d, wi } = compute();
    return `<section class="frame drawer">
      <header class="bar">${brand()}<div class="spacer"></div>${langBtn()}${closeBtn()}</header>
      <div class="sub">${viewSwitch()}${targetControl()}</div>
      <div class="scroll">
        ${needBanner(wi)}
        <div class="cardHead"><h3>${t("nextUp")}</h3>${resetBtn()}</div>
        ${whatIfTable(wi, true)}
        <h3 class="mt">${t("whereLand")}</h3>${rangeFigure(d, wi, 400)}
        <h3 class="mt">${t("trajectoryShort")}</h3>${trajectoryChart(d.trajectory, 400, 170)}
        ${assumptions(d)}
      </div></section>`;
  }

  // ---------- building blocks ----------
  function planNote(wi) {
    const mine = wi.perModule.filter((m) => m.source === "you").length;
    return mine ? t("planNoteSome", { mine, total: wi.perModule.length, pace: fmt(wi.pace) }) : t("planNoteAll", { pace: fmt(wi.pace) });
  }

  function needBanner(wi) {
    const n = wi.need;
    if (!n) return "";
    const leftOnPace = wi.perModule.filter((m) => m.source === "pace").length;
    let cls = "", msg;
    const v = { t: fmt(state.target), p: fmt(wi.projected), n: leftOnPace, s: fmt(n.step) };
    if (n.status === "met") (cls = "good"), (msg = t("needMet", v));
    else if (n.status === "missed") (cls = "bad"), (msg = t("needMissed", v));
    else if (n.status === "unreachable") (cls = "bad"), (msg = t("needUnreachable", v));
    else if (n.status === "secured-with-any-pass") (cls = "good"), (msg = t("needSafe", v));
    else msg = t("needStep", v);
    return `<p class="need ${cls}">${msg}</p>`;
  }

  const resetBtn = () => (Object.keys(state.overrides).length ? `<button class="link" data-act="reset">${t("resetPicks")}</button>` : "");

  function gradeSelect(m) {
    const opts = [`<option value="pace"${m.source === "pace" ? " selected" : ""}>${t("pace", { g: fmt(m.expected) })}</option>`]
      .concat(M.GRADE_STEPS.map((s) => `<option value="${s}"${m.source === "you" && m.expected === s ? " selected" : ""}>${fmt(s)}</option>`))
      .join("");
    return `<select data-mod="${esc(m.id)}" class="${m.source}" aria-label="${t("expectedFor", { name: esc(m.name) })}">${opts}</select>`;
  }

  function whenChip(iso) {
    const dd = daysUntil(iso);
    if (!iso) return `<span class="chip">${t("dateTbd")}</span>`;
    const urgent = dd !== null && dd >= 0 && dd <= 14;
    const rel = dd === null || dd < 0 ? "" : dd === 0 ? t("today") : t("inDays", { d: dd });
    return `<span class="chip${urgent ? " urgent" : ""}">${fmtDate(iso)}${rel}</span>`;
  }

  // mini bar: where this module can still end (best–worst), with the current pick marked
  function moduleSpan(m, w = 90) {
    const x = (g) => 2 + ((g - 1) / 3) * (w - 4);
    return `<svg viewBox="0 0 ${w} 14" width="${w}" height="14" class="span" role="img"
      aria-label="${t("spanAria", { b: fmt(m.moduleBest), w: fmt(m.moduleWorst), p: fmt(m.projectedModuleGrade) })}"
      data-tip="${t("spanTip", { b: fmt(m.moduleBest), w: fmt(m.moduleWorst), p: fmt(m.projectedModuleGrade) })}">
      <line x1="2" x2="${w - 2}" y1="7" y2="7" class="rail"/>
      <rect x="${x(m.moduleBest)}" y="4" width="${Math.max(2, x(m.moduleWorst) - x(m.moduleBest))}" height="6" rx="3" class="spanBand"/>
      <circle cx="${x(m.projectedModuleGrade)}" cy="7" r="4" class="spanPick"/></svg>`;
  }

  function whatIfTable(wi, compact) {
    if (!wi.perModule.length) return `<p class="muted">${t("nothingOpen")}</p>`;
    const rows = wi.perModule
      .map((m) => {
        const parts = m.openParts.map((p) => `${esc(p.name)} ${Math.round(p.weight * 100)}%`).join(" · ");
        const done = m.knownWeight > 0 ? t("alreadyGraded", { pct: Math.round(m.knownWeight * 100) }) : "";
        return `<div class="row">
          <div class="who"><b>${esc(m.name)}</b><span class="muted small">${num(m.credits)} ECTS · ${parts}${done}</span>${m.retake ? `<span class="retake" data-tip="${t("retakeTip")}">${t("retake")}</span>` : ""}</div>
          <div class="when">${whenChip(m.nextDate)}</div>
          ${compact ? "" : `<div class="lev" data-tip="${t("shareTip", { pct: Math.round(m.leverage * 100) })}"><i style="width:${Math.max(3, Math.round(m.leverage * 100))}%"></i><span class="small">${Math.round(m.leverage * 100)}%</span></div>`}
          ${compact ? "" : moduleSpan(m)}
          <div class="pick">${gradeSelect(m)}</div>
          <div class="res" data-tip="${t("moduleWithPick")}">${fmt(m.projectedModuleGrade)}</div>
        </div>`;
      })
      .join("");
    const head = compact
      ? `<div class="row head"><span>${t("thModule")}</span><span>${t("thNext")}</span><span>${t("thPick")}</span><span>${t("thModuleGrade")}</span></div>`
      : `<div class="row head"><span>${t("thModule")}</span><span>${t("thNext")}</span><span>${t("thShare")}</span><span>${t("thCanEnd")}</span><span>${t("thPick")}</span><span>${t("thModuleGrade")}</span></div>`;
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
    const rv = { b: fmt(r.best), w: fmt(r.worst), p: fmt(wi.projected), t: fmt(state.target), c: fmt(cur) };
    return `<svg viewBox="0 0 ${W} 66" class="range" role="img" aria-label="${t("rangeAria", rv)}">
      <line x1="${pad}" x2="${W - pad}" y1="40" y2="40" class="axis"/>${ticks}
      <rect x="${x(r.best)}" y="24" width="${Math.max(2, x(r.worst) - x(r.best))}" height="12" rx="4" class="band"
        data-tip="${t("rangeTip", rv)}"/>
      ${cur != null ? `<line x1="${x(cur)}" x2="${x(cur)}" y1="20" y2="40" class="nowLine" data-tip="${t("currentTip", rv)}"/>` : ""}
      <circle cx="${x(wi.projected)}" cy="30" r="7" class="plan" data-tip="${t("planTip", rv)}"/>
      <path d="M${x(state.target)} 17 l-6 -9 h12 z" class="tgt" data-tip="${t("targetTip", rv)}"/>
    </svg>
    <div class="legend small"><span><i class="sw band"></i>${t("lgPossible")}</span><span><i class="sw plan"></i>${t("lgPlan", rv)}</span><span><i class="sw now"></i>${t("lgCurrent", rv)}</span><span><i class="sw tgt"></i>${t("lgTarget", rv)}</span></div>`;
  }

  // time axis by exam date; 1,0 at the top
  function trajectoryChart(traj, W, H) {
    const pts = traj.filter((p) => p.date);
    if (pts.length < 2) return `<p class="muted">${t("trajNeedTwo")}</p>`;
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
      .map((p) => `<text x="${xs(p.date)}" y="${H - 6}" class="tick start">${t("trajSem", { n: p.semester, d: fmtDate(p.date).slice(3) })}</text>`)
      .join("");
    const line = pts.map((p, i) => `${i ? "L" : "M"}${xs(p.date).toFixed(1)} ${ys(p.runningAverageRaw).toFixed(1)}`).join(" ");
    const last = pts[pts.length - 1];
    const dots = pts
      .map(
        (p) => `<g data-tip="${esc(t("trajTip", { m: p.module, g: fmt(p.grade), c: num(p.credits), d: fmtDate(p.date), a: fmt(p.runningAverage) }))}">
        <circle cx="${xs(p.date)}" cy="${ys(p.grade)}" r="11" class="hit"/><circle cx="${xs(p.date)}" cy="${ys(p.grade)}" r="4.5" class="g"/></g>`
      )
      .join("");
    return `<svg viewBox="0 0 ${W} ${H}" class="traj" role="img" aria-label="${t("trajAria", { a: fmt(last.runningAverage) })}">
      <text x="${L}" y="${T - 2}" class="tick start">${t("trajBetter")}</text>
      ${grid.join("")}${sem}<path d="${line}" class="avg"/>${dots}
      <text x="${W - R + 4}" y="${ys(last.runningAverageRaw) + 3}" class="lbl">${fmt(last.runningAverage)}</text></svg>
      <div class="legend small"><span><i class="sw g"></i>${t("lgModuleGrade")}</span><span><i class="sw avg"></i>${t("lgRunning")}</span></div>`;
  }

  function meter(label, v, of) {
    const pct = Math.round((v / of) * 100);
    return `<div class="meter"><div class="meterTop"><span>${esc(label)}</span><b>${num(v)}<span class="muted"> / ${num(of)}</span></b></div>
      <span class="mbar" role="img" aria-label="${pct}%"><i style="width:${pct}%"></i></span></div>`;
  }

  function assumptions(d) {
    return `<footer class="muted small">${t("assumptions")}
      ${d.warnings.map((w) => `<br>⚠ ${esc(w)}`).join("")}</footer>`;
  }

  // ---------- inline view: summary bar + badges on FOM's own cards ----------
  // Two separate jobs:
  //   attach  keep our hosts in FOM's DOM (FOM is a Vue SPA and re-renders on its own)
  //   render  fill the hosts; only when OUR state changes, never because FOM's DOM moved
  // The MutationObserver only ever attaches, so an open grade picker is never torn down.
  let inlineBar = null;
  let observer = null;
  let expectedBadges = 0;
  let lastCardCount = -1;

  function renderInline() {
    const on = state.view === "inline" && !!state.data && !state.error;
    if (!on) {
      removeInline();
      return;
    }
    attachInline(true);
    if (!observer) {
      let pending = null;
      observer = new MutationObserver(() => {
        if (pending) return;
        pending = setTimeout(() => {
          pending = null;
          if (state.view !== "inline") return;
          // cheap guard: nothing of ours went missing -> no DOM reads at all
          if (
            inlineBar &&
            inlineBar.isConnected &&
            document.querySelectorAll(".course-element").length === lastCardCount &&
            document.querySelectorAll(".gl-badge-host").length === expectedBadges
          )
            return;
          attachInline(false);
        }, 250);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function attachInline(rerender) {
    const ctx = compute();
    placeBar(ctx, rerender);
    placeBadges(ctx, rerender);
  }

  function removeInline() {
    if (observer) observer.disconnect(), (observer = null);
    if (inlineBar) inlineBar.remove(), (inlineBar = null);
    document.querySelectorAll(".gl-badge-host").forEach((n) => n.remove());
    expectedBadges = 0;
    lastCardCount = -1;
  }

  // smallest element that contains every semester column
  function findGrid() {
    const heads = document.querySelectorAll(".semester-header");
    if (!heads.length) return null;
    const last = heads[heads.length - 1];
    let node = heads[0].parentElement;
    while (node && !node.contains(last)) node = node.parentElement;
    return node && node.parentElement ? node : null;
  }

  function placeBar({ d, wi }, rerender) {
    const grid = findGrid();
    if (!grid) {
      // FOM navigated away or swapped the layout: don't leave an orphaned bar behind
      if (inlineBar) inlineBar.remove(), (inlineBar = null);
      return;
    }
    let fresh = false;
    if (!inlineBar || !inlineBar.isConnected) {
      inlineBar = document.createElement("div");
      inlineBar.className = "gl-bar-host";
      noTranslate(inlineBar);
      inlineBar.style.cssText = "all:initial;display:block;margin:0 8px 12px;";
      const sr = inlineBar.attachShadow({ mode: "open" });
      sr.innerHTML = `<style>${BASE_CSS()}${INLINE_CSS()}</style><div class="ibar"></div>`;
      wireActions(sr);
      fresh = true;
    }
    if (inlineBar.nextElementSibling !== grid) grid.parentElement.insertBefore(inlineBar, grid);
    if (!fresh && !rerender) return;
    const sr = inlineBar.shadowRoot;
    sr.querySelector(".ibar").innerHTML = `
      <div class="ib-left"><strong>Grade Lens</strong>
        <span class="kv"><span class="muted small">${t("now")}</span><b>${fmt(d.average.final)}</b></span>
        <span class="kv"><span class="muted small">${t("yourPlan")}</span><b class="accent">${fmt(wi.projected)}</b></span>
        <span class="kv"><span class="muted small">${t("possible")}</span><b>${fmt(d.range.best)}–${fmt(d.range.worst)}</b></span>
        ${targetControl()}</div>
      <div class="ib-right">${viewSwitch()}${langBtn()}</div>
      <div class="ib-need">${needBanner(wi)}<span class="muted small">${badgeNote()} ${resetBtn()}</span></div>`;
    wireTips(sr);
  }

  let badgesMatched = true;
  const badgeNote = () =>
    badgesMatched ? t("badgeNote") : t("badgeOff");

  function placeBadges({ d, wi }, rerender) {
    const cards = document.querySelectorAll(".course-element");
    lastCardCount = cards.length;
    // fail safe: only attach when the cards line up 1:1 with the data (count and ECTS order).
    // textContent, not innerText: no forced layout on every check.
    const matched =
      cards.length === d.modules.length &&
      [...cards].every((c, i) => new RegExp(`^\\s*${num(d.modules[i].credits)}\\s*ECTS`).test(c.textContent));
    if (matched !== badgesMatched) {
      badgesMatched = matched;
      if (inlineBar && inlineBar.isConnected) placeBar({ d, wi }, true); // update the note
    }
    if (!matched) {
      document.querySelectorAll(".gl-badge-host").forEach((n) => n.remove());
      expectedBadges = 0;
      return;
    }
    const byId = new Map(wi.perModule.map((m) => [String(m.id), m]));
    let count = 0;
    cards.forEach((card, i) => {
      const m = byId.get(String(d.modules[i].id));
      let hostEl = card.querySelector(":scope .gl-badge-host");
      if (!m) {
        if (hostEl) hostEl.remove();
        return;
      }
      count++;
      let fresh = false;
      if (!hostEl) {
        hostEl = document.createElement("div");
        hostEl.className = "gl-badge-host";
        noTranslate(hostEl);
        hostEl.style.cssText = "all:initial;display:block;padding:0 16px 14px;";
        const sr = hostEl.attachShadow({ mode: "open" });
        sr.innerHTML = `<style>${BASE_CSS()}${BADGE_CSS()}</style><div class="bd"></div>`;
        wireActions(sr);
        (card.firstElementChild || card).appendChild(hostEl);
        fresh = true;
      }
      if (!fresh && !rerender) return;
      const need = wi.need && wi.need.status === "reachable" && m.source === "pace" ? t("needChip", { s: fmt(wi.need.step) }) : "";
      hostEl.shadowRoot.querySelector(".bd").innerHTML = `
        ${whenChip(m.nextDate)}
        ${m.retake ? `<span class="retake">${t("retake")}</span>` : ""}
        <span class="pk"><span class="muted small">${t("pick")}</span>${gradeSelect(m)}</span>
        <span class="res" data-tip="${t("resTip", { b: fmt(m.moduleBest), w: fmt(m.moduleWorst) })}">→ ${fmt(m.projectedModuleGrade)}</span>
        ${need ? `<span class="needchip">${need}</span>` : ""}`;
      wireTips(hostEl.shadowRoot);
    });
    expectedBadges = count;
  }

  // ---------- styles ----------
  function BASE_CSS() {
    return `
    :host { all: initial; }
    /* Same tokens as omkarkhadilkar.dev. Light on FOM's page; panels follow the system theme. */
    :host, .light {
      --bg: #f2f2f0; --surface: #f8f8f6; --card: #ffffff; --ink: #111111; --muted: #5c5c5c;
      --rule: rgba(17,17,17,.12); --rule-strong: rgba(17,17,17,.28);
      --accent: #0c6e70; --accent-ink: #ffffff; --accent-2: #9a4508;
      --tint: color-mix(in srgb, var(--accent) 9%, var(--card)); --tint-2: color-mix(in srgb, var(--accent-2) 10%, var(--card));
      --sans: "GL Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      --mono: "GL Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    @media (prefers-color-scheme: dark) {
      .frame, .launcher, .backdrop {
        --bg: #0f1112; --surface: #16191a; --card: #1b1f20; --ink: #ececea; --muted: #9a9a96;
        --rule: rgba(236,236,234,.12); --rule-strong: rgba(236,236,234,.3);
        --accent: #3fb8b9; --accent-ink: #0f1112; --accent-2: #f0a04b;
        --tint: color-mix(in srgb, var(--accent) 12%, var(--card)); --tint-2: color-mix(in srgb, var(--accent-2) 12%, var(--card));
      }
    }
    * { box-sizing: border-box; }
    .root, .frame, .ibar, .bd, .launcher { font: 13px/1.5 var(--sans); color: var(--ink); }
    .muted { color: var(--muted); } .small { font-size: 11px; } .accent { color: var(--accent); }
    b, strong { font-weight: 500; }
    h3 { font: 400 11px/1.4 var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 0 0 10px; }
    .mt { margin-top: 22px; }
    .seg { display: inline-flex; border: 1px solid var(--rule-strong); border-radius: 999px; padding: 2px; gap: 2px; }
    .seg button { border: 0; background: transparent; padding: 4px 11px; border-radius: 999px; font: 400 11px/1.4 var(--mono); text-transform: uppercase; letter-spacing: .06em; color: var(--muted); cursor: pointer; }
    .seg button.on { background: var(--ink); color: var(--bg); }
    .target { display: inline-flex; align-items: center; gap: 6px; }
    .target b { min-width: 26px; text-align: center; font-size: 14px; font-variant-numeric: tabular-nums; }
    .step { width: 24px; height: 24px; border-radius: 999px; border: 1px solid var(--rule-strong); background: var(--card); color: var(--ink); cursor: pointer; font: inherit; line-height: 1; }
    .step:hover, .icon:hover { border-color: var(--accent); color: var(--accent); }
    .icon { border: 1px solid transparent; background: transparent; width: 30px; height: 30px; border-radius: 999px; cursor: pointer; font-size: 14px; color: var(--muted); }
    .link { border: 0; background: none; color: var(--ink); font: 400 11px/1.4 var(--mono); text-transform: uppercase; letter-spacing: .06em; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; padding: 0; }
    .link:hover { color: var(--accent); }
    .need { margin: 12px 0; padding: 10px 14px; border-radius: 2px; background: var(--tint); border: 1px solid var(--rule); border-left: 2px solid var(--accent); }
    .need.good { background: var(--tint); } .need.bad { background: var(--tint-2); border-left-color: var(--accent-2); }
    .need .stepv { font-size: 15px; }
    .chip { display: inline-block; font: 400 11px/1.5 var(--mono); padding: 1px 8px; border-radius: 999px; border: 1px solid var(--rule-strong); color: var(--ink); white-space: nowrap; }
    .chip.urgent { background: var(--tint-2); color: var(--accent-2); border-color: var(--accent-2); }
    .chip.urgent::before { content: "● "; color: var(--accent-2); }
    select { font: inherit; font-size: 12px; padding: 3px 6px; border-radius: 2px; border: 1px solid var(--rule-strong); background: var(--card); color: var(--ink); cursor: pointer; font-variant-numeric: tabular-nums; }
    select.pace { color: var(--muted); border-style: dashed; }
    select.you { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
    svg { display: block; overflow: visible; }
    .axis { stroke: var(--rule-strong); stroke-width: 1; } .grid { stroke: var(--rule); stroke-width: 1; }
    .tick { fill: var(--muted); font: 400 10px var(--mono); text-anchor: middle; } .tick.end { text-anchor: end; } .tick.start { text-anchor: start; }
    .lbl { fill: var(--ink); font-size: 11px; font-weight: 500; }
    .range { width: 100%; height: auto; }
    .range .band { fill: var(--accent); opacity: .18; }
    .range .plan { fill: var(--accent); stroke: var(--card); stroke-width: 2; }
    .range .nowLine { stroke: var(--ink); stroke-width: 2; }
    .range .tgt { fill: var(--ink); }
    .traj { width: 100%; height: auto; }
    .traj .avg { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; }
    .traj .g { fill: var(--accent-2); stroke: var(--card); stroke-width: 2; }
    .traj .hit { fill: transparent; }
    .legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 6px; color: var(--muted); }
    .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
    .sw.band { background: color-mix(in srgb, var(--accent) 25%, transparent); } .sw.plan, .sw.avg { background: var(--accent); }
    .sw.plan, .sw.g { border-radius: 50%; } .sw.g { background: var(--accent-2); }
    .sw.now { background: var(--ink); width: 3px; } .sw.tgt { background: var(--ink); clip-path: polygon(0 0,100% 0,50% 100%); }
    .span .rail { stroke: var(--rule-strong); stroke-width: 1; } .span .spanBand { fill: var(--accent); opacity: .2; }
    .span .spanPick { fill: var(--accent); stroke: var(--card); stroke-width: 1.5; }
    .empty { padding: 48px 12px; text-align: center; color: var(--ink); } .empty.warn { color: var(--accent-2); }
    .btn { display: inline-block; margin: 8px 0; padding: 8px 16px; border-radius: 999px; background: var(--accent); color: var(--accent-ink); text-decoration: none; font-weight: 500; }
    footer { margin-top: 24px; line-height: 1.5; }
    [hidden] { display: none !important; }`;
  }

  function SHELL_CSS() {
    return `
    .launcher { position: fixed; left: 72px; bottom: 18px; display: flex; gap: 8px; align-items: center; padding: 9px 14px; cursor: pointer;
      background: var(--card); color: var(--ink); border: 1px solid var(--rule-strong); border-radius: 999px; box-shadow: 0 4px 18px rgba(0,0,0,.12); font-weight: 500; }
    .launcher:hover { border-color: var(--accent); }
    .launcher.warn { border-color: var(--accent-2); }
    .launcher.warn .dot { background: var(--accent-2); }
    .launcher .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
    .frame { background: var(--bg); color: var(--ink); display: flex; flex-direction: column; }
    .bar { display: flex; align-items: center; gap: 14px; padding: 12px 18px; border-bottom: 1px solid var(--rule); background: var(--bg); }
    .brand { display: flex; flex-direction: column; } .brand strong { font-size: 15px; font-weight: 500; letter-spacing: -.01em; }
    .spacer { flex: 1; }
    .scroll { overflow-y: auto; }
    /* dashboard */
    .backdrop { position: fixed; inset: 0; background: rgba(20,20,18,.35); display: flex; }
    .dash { position: fixed; inset: 16px; border-radius: 6px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.25); }
    .dash .bar .brand { margin-right: auto; }
    .dash .scroll { padding: 18px; }
    .dgrid { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 14px; max-width: 1400px; margin: 0 auto; }
    .card { background: var(--card); border: 1px solid var(--rule); border-radius: 2px; padding: 16px 18px; }
    .hero { grid-column: 1 / -1; }
    .heroNums { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 8px; }
    .heroNums > div { display: flex; flex-direction: column; gap: 2px; }
    .label { font: 400 11px/1.4 var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
    .big { font-size: 44px; font-weight: 400; letter-spacing: -.035em; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .big small { font-size: 24px; color: var(--muted); font-weight: 400; }
    .side { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
    .cardHead { display: flex; justify-content: space-between; align-items: baseline; }
    .meter { margin: 8px 0 14px; } .meterTop { display: flex; justify-content: space-between; margin-bottom: 6px; }
    .mbar { display: block; height: 6px; background: var(--surface); border: 1px solid var(--rule); overflow: hidden; } .mbar i { display: block; height: 100%; background: var(--accent); }
    /* what-if table */
    .wi .row { display: grid; grid-template-columns: minmax(0, 2.4fr) 1.3fr 0.9fr 96px 92px 40px; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--rule); }
    .wi.compact .row { grid-template-columns: minmax(0, 1fr) auto 84px 30px; gap: 8px; }
    .wi .row.head { font: 400 10px/1.4 var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); padding: 0 0 6px; }
    .wi .who { display: flex; flex-direction: column; min-width: 0; } .wi .who b { font-weight: 500; }
    .retake { display: inline-block; margin-top: 3px; font: 400 10px/1.5 var(--mono); text-transform: uppercase; padding: 0 6px; border-radius: 999px; border: 1px solid var(--accent-2); color: var(--accent-2); width: fit-content; }
    .wi .res { text-align: right; font-size: 15px; font-weight: 500; font-variant-numeric: tabular-nums; }
    .wi .lev { display: flex; align-items: center; gap: 6px; }
    .wi .lev i { display: block; height: 6px; background: var(--accent); max-width: 48px; }
    /* drawer */
    .drawer { position: fixed; top: 0; right: 0; height: 100vh; width: min(440px, 100vw); border-left: 1px solid var(--rule); box-shadow: -10px 0 40px rgba(0,0,0,.12); }
    .drawer .sub { display: flex; justify-content: space-between; align-items: center; padding: 10px 18px; border-bottom: 1px solid var(--rule); background: var(--bg); }
    .drawer .scroll { padding: 4px 18px 28px; flex: 1; }
    .drawer .cardHead { margin-top: 6px; }`;
  }

  function INLINE_CSS() {
    return `
    .ibar { display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; align-items: center; background: var(--card); border: 1px solid var(--rule);
      border-left: 2px solid var(--accent); border-radius: 2px; padding: 12px 16px; }
    .ib-left { display: flex; flex-wrap: wrap; align-items: center; gap: 18px; }
    .ib-left strong { font-size: 15px; font-weight: 500; }
    .ib-right { display: flex; align-items: center; gap: 14px; }
    .kv { display: inline-flex; align-items: baseline; gap: 6px; } .kv b { font-size: 20px; font-weight: 400; font-variant-numeric: tabular-nums; }
    .ib-need { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; }
    .ib-need .need { margin: 0; padding: 6px 10px; }`;
  }

  function BADGE_CSS() {
    return `
    .bd { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding-top: 10px; border-top: 1px dashed var(--rule-strong); }
    .pk { display: inline-flex; align-items: center; gap: 4px; }
    .res { font-weight: 500; font-variant-numeric: tabular-nums; font-size: 13px; }
    .retake { font: 400 10px/1.5 var(--mono); text-transform: uppercase; padding: 0 6px; border-radius: 999px; border: 1px solid var(--accent-2); color: var(--accent-2); }
    .needchip { font: 400 11px/1.5 var(--mono); padding: 1px 8px; border-radius: 999px; background: var(--tint); color: var(--accent); border: 1px solid var(--accent); }`;
  }

  // ---------- boot ----------
  store.load().then(() => {
    I.setLang(state.lang);
    window.postMessage({ source: "fom-grade-lens-panel", kind: "request" }, location.origin);
    renderAll();
  });
})();
