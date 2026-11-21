const test = require("node:test");
const assert = require("node:assert");
const I = require("../src/i18n.js");

const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("German has every English key, with the same placeholders", () => {
  const { en, de } = I.DICTS;
  for (const k of Object.keys(en)) {
    assert.ok(k in de, `missing German text for "${k}"`);
    assert.equal(typeof de[k], typeof en[k], `"${k}" differs in type`);
    if (typeof en[k] === "string") assert.equal(holes(de[k]), holes(en[k]), `"${k}" placeholders differ`);
  }
  for (const k of Object.keys(de)) assert.ok(k in en, `German-only key "${k}"`);
});

test("plural texts render for one and many in both languages", () => {
  for (const lang of ["en", "de"]) {
    I.setLang(lang);
    for (const k of ["needUnreachable", "needSafe", "needStep"]) {
      for (const n of [1, 3]) {
        const s = I.t(k, { t: "1,5", n, s: "2,3", p: "1,6" });
        assert.ok(s.includes("1,5") && !s.includes("undefined"), `${lang} ${k} n=${n}: ${s}`);
      }
    }
  }
});

test("language choice: explicit choice wins, anything else falls back to the browser", () => {
  assert.equal(I.setLang("de"), "de");
  assert.equal(I.setLang("en"), "en");
  assert.ok(["en", "de"].includes(I.setLang("auto")));
});
