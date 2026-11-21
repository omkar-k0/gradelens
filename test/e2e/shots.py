"""Store and README screenshots from the synthetic fixture (never real grades). 1280x800 as the Chrome Web Store asks."""
import os, pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parents[2]
fx = (root / "test/fixture.studybook.json").read_text()
R = "document.getElementById('grade-lens-root').shadowRoot"
def load(pg, lang):
    pg.goto("http://localhost:8765/test/e2e/harness.html"); pg.wait_for_timeout(300)
    pg.evaluate("t => window.postMessage({source:'fom-grade-lens',kind:'studybook',url:'https://oc-digital.de/campus/api/epm/studybook/1',text:t}, location.origin)", fx)
    pg.wait_for_timeout(200)
    pg.evaluate(f"{R}.querySelector('.launcher').click()"); pg.wait_for_timeout(200)
    if lang == "de": pg.evaluate(f"{R}.querySelector('[data-act=lang]').click()"); pg.wait_for_timeout(200)
    pg.evaluate(f"""() => {{ const s=[...{R}.querySelectorAll('select[data-mod]')].find(x=>x.getAttribute('aria-label').includes('Thesis')); s.value='1.3'; s.dispatchEvent(new Event('change',{{bubbles:true}})); }}"""); pg.wait_for_timeout(200)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
    for lang in ("en", "de"):
        for scheme in ("light", "dark"):
            pg = b.new_page(viewport={"width": 1280, "height": 800}, color_scheme=scheme)
            load(pg, lang)
            pg.screenshot(path=str(root / f"store/screenshots/{lang}-1-advanced-{scheme}.png"))
            if scheme == "light":
                pg.evaluate(f"{R}.querySelector('[data-view=drawer]').click()"); pg.wait_for_timeout(250)
                pg.screenshot(path=str(root / f"store/screenshots/{lang}-2-basic.png"))
                pg.evaluate(f"{R}.querySelector('[data-view=inline]').click()"); pg.wait_for_timeout(500)
                pg.screenshot(path=str(root / f"store/screenshots/{lang}-3-inline.png"))
            pg.close()
    b.close()
print("ok")
