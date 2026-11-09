/* Toolbar popup: pick Basic / Inline / Advanced and see a live summary of the open FOM tab. */
(() => {
  "use strict";
  const FOM = /^https:\/\/oc-digital\.de\//;
  const STUDY_PROGRESS = "https://oc-digital.de/node/6148";
  const buttons = [...document.querySelectorAll(".views button")];
  const status = document.querySelector(".status");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let tab = null;

  function mark(view) {
    buttons.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.view === view)));
  }

  function show(s) {
    if (!tab || !FOM.test(tab.url || "")) {
      status.innerHTML = `<div>Open the FOM Online Campus to use Grade Lens.</div>
        <button class="btn" data-go="${STUDY_PROGRESS}">Open Study progress</button>`;
      return;
    }
    if (!s) {
      status.innerHTML = `<div>Reload the FOM tab once so Grade Lens can attach.</div>`;
      return;
    }
    mark(s.view);
    if (s.error) {
      status.innerHTML = `<div>${esc(s.error)}</div>`;
      return;
    }
    if (!s.hasData) {
      status.innerHTML = `<div>No grades loaded on this page yet.</div>
        <button class="btn" data-go="${STUDY_PROGRESS}">Go to Study progress</button>`;
      return;
    }
    const n = s.next;
    const urgent = n && n.days !== null && n.days >= 0 && n.days <= 14;
    const rel = n && n.days !== null && n.days >= 0 ? (n.days === 0 ? " · today" : ` · in ${n.days} d`) : "";
    status.innerHTML = `<div class="kpis">
        <div><span class="muted small">now</span><b>${esc(s.now)}</b></div>
        <div><span class="muted small">your plan</span><b class="accent">${esc(s.plan)}</b></div>
        <div><span class="muted small">possible</span><b>${esc(s.range)}</b></div>
        <div><span class="muted small">target</span><b>${esc(s.target)}</b></div></div>
      ${n ? `<div class="next small"><span class="muted">Next up:</span> ${esc(n.name)} <span class="chip${urgent ? " urgent" : ""}">${esc(n.date)}${rel}</span></div>` : ""}`;
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

  (async () => {
    const stored = await chrome.storage.local.get("gl_view");
    mark(stored.gl_view || "dashboard");
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    show(tab && FOM.test(tab.url || "") ? await send({ type: "gl-get" }) : null);
  })();
})();
