/* Toolbar popup: pick Basic / Inline / Advanced and see a live summary of the open FOM tab. */
(() => {
  "use strict";
  const FOM = /^https:\/\/oc-digital\.de\//;
  const STUDY_PROGRESS = "https://oc-digital.de/node/6148";
  const I = globalThis.GradeLensI18n;
  const t = (k, v) => I.t(k, v);
  const langBtn = document.querySelector("[data-lang]");
  let last = null;
  function applyText() {
    document.documentElement.lang = I.lang;
    document.querySelectorAll("[data-i]").forEach((el) => (el.textContent = t(el.dataset.i)));
    langBtn.textContent = t("langSwitch");
    langBtn.setAttribute("aria-label", t("langSwitchAria"));
    if (last !== undefined) show(last);
  }
  const buttons = [...document.querySelectorAll(".views button")];
  const status = document.querySelector(".status");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let tab = null;

  function mark(view) {
    buttons.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.view === view)));
  }

  function show(s) {
    last = s;
    if (!tab || !FOM.test(tab.url || "")) {
      status.innerHTML = `<div>${t("popOpenFom")}</div>
        <button class="btn" data-go="${STUDY_PROGRESS}">${t("popOpenProgress")}</button>`;
      return;
    }
    if (!s) {
      status.innerHTML = `<div>${t("popReload")}</div>`;
      return;
    }
    mark(s.view);
    if (s.error) {
      status.innerHTML = `<div>${esc(s.error)}</div>`;
      return;
    }
    if (!s.hasData) {
      status.innerHTML = `<div>${t("popNoGrades")}</div>
        <button class="btn" data-go="${STUDY_PROGRESS}">${t("popGoProgress")}</button>`;
      return;
    }
    const n = s.next;
    const urgent = n && n.days !== null && n.days >= 0 && n.days <= 14;
    const rel = n && n.days !== null && n.days >= 0 ? (n.days === 0 ? t("today") : t("inDays", { d: n.days })) : "";
    status.innerHTML = `<div class="kpis">
        <div><span class="muted small">${t("now")}</span><b>${esc(s.now)}</b></div>
        <div><span class="muted small">${t("yourPlan")}</span><b class="accent">${esc(s.plan)}</b></div>
        <div><span class="muted small">${t("possible")}</span><b>${esc(s.range)}</b></div>
        <div><span class="muted small">${t("popTarget")}</span><b>${esc(s.target)}</b></div></div>
      ${n ? `<div class="next small"><span class="muted">${t("popNext")}</span> ${esc(n.name)} <span class="chip${urgent ? " urgent" : ""}">${esc(n.date)}${rel}</span></div>` : ""}`;
  }

  function send(msg) {
    return new Promise((resolve) => {
      if (!tab) return resolve(null);
      chrome.tabs.sendMessage(tab.id, msg, (res) => {
        void chrome.runtime.lastError; // no content script on this tab
        resolve(res || null);
      });
    });
  }

  buttons.forEach((b) =>
    b.addEventListener("click", async () => {
      const view = b.dataset.view;
      mark(view);
      chrome.storage.local.set({ gl_view: view });
      if (tab && FOM.test(tab.url || "")) {
        const s = await send({ type: "gl-set-view", view });
        show(s);
        if (s && s.hasData) window.close();
      }
    })
  );

  status.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (!go) return;
    if (tab && FOM.test(tab.url || "")) chrome.tabs.update(tab.id, { url: go.dataset.go });
    else chrome.tabs.create({ url: go.dataset.go });
    window.close();
  });

  langBtn.addEventListener("click", async () => {
    const next = I.lang === "de" ? "en" : "de";
    I.setLang(next);
    chrome.storage.local.set({ gl_lang: next });
    last = undefined;
    applyText();
    const s = tab && FOM.test(tab.url || "") ? await send({ type: "gl-set-lang", lang: next }) : null;
    show(s);
  });

  (async () => {
    const stored = await chrome.storage.local.get(["gl_view", "gl_lang"]);
    I.setLang(stored.gl_lang);
    last = undefined;
    applyText();
    mark(stored.gl_view || "dashboard");
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    show(tab && FOM.test(tab.url || "") ? await send({ type: "gl-get" }) : null);
  })();
})();
