/*
 * Runs in the page's own JS world (MAIN) at document_start.
 * Passive: it only copies responses the Online Campus app already requested.
 * It never reads tokens or cookies and never makes its own requests.
 */
(() => {
  "use strict";
  const WANT = /\/campus\/api\/epm\/studybook\/\d+/;
  let last = null; // kept in page memory only, so a late-loading panel can ask for it
  const post = (url, text) => {
    let abs;
    try { abs = new URL(String(url), location.href).href; } catch (_) { return; }
    last = { url: abs, text };
    window.postMessage({ source: "fom-grade-lens", kind: "studybook", ...last }, location.origin);
  };
  window.addEventListener("message", (e) => {
    if (e.source === window && e.data && e.data.source === "fom-grade-lens-panel" && e.data.kind === "request" && last) {
      window.postMessage({ source: "fom-grade-lens", kind: "studybook", ...last }, location.origin);
    }
  });

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = (args[0] && args[0].url) || args[0];
      if (WANT.test(String(url)) && res.ok) res.clone().text().then((t) => post(url, t), () => {});
    } catch (_) {
      /* never break the host page */
    }
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (WANT.test(String(url))) {
      this.addEventListener("load", () => {
        try {
          if (this.status >= 200 && this.status < 300) {
            const t = this.responseType === "" || this.responseType === "text"
              ? this.responseText
              : JSON.stringify(this.response);
            post(url, t);
          }
        } catch (_) {}
      });
    }
    return origOpen.call(this, method, url, ...rest);
  };
})();
