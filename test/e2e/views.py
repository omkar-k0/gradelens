import os
import pathlib
from playwright.sync_api import sync_playwright
fx = pathlib.Path("test/fixture.studybook.json").read_text()
R = "document.getElementById('grade-lens-root').shadowRoot"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
    pg = b.new_page(viewport={"width":1440,"height":900})
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:8765/test/e2e/harness.html"); pg.wait_for_timeout(300)
    pg.evaluate("t => window.postMessage({source:'fom-grade-lens',kind:'studybook',url:'https://oc-digital.de/campus/api/epm/studybook/1',text:t}, location.origin)", fx)
    pg.wait_for_timeout(200)
    pg.evaluate(f"{R}.querySelector('.launcher').click()"); pg.wait_for_timeout(200)
    # pick 1,3 for the thesis
    pg.evaluate(f"""() => {{ const s=[...{R}.querySelectorAll('select[data-mod]')].find(x=>x.getAttribute('aria-label').includes('Thesis')); s.value='1.3'; s.dispatchEvent(new Event('change',{{bubbles:true}})); }}""")
    pg.wait_for_timeout(200); pg.screenshot(path="test/e2e/out/v_dashboard.png")
    pg.evaluate(f"{R}.querySelector('[data-view=drawer]').click()"); pg.wait_for_timeout(200); pg.screenshot(path="test/e2e/out/v_drawer.png")
    pg.evaluate(f"{R}.querySelector('[data-view=inline]').click()"); pg.wait_for_timeout(500); pg.screenshot(path="test/e2e/out/v_inline.png")
    print("badges:", pg.evaluate("document.querySelectorAll('.gl-badge-host').length"), "bar:", pg.evaluate("!!document.querySelector('.gl-bar-host')"))
    # target stepper inside inline bar
    pg.evaluate("document.querySelector('.gl-bar-host').shadowRoot.querySelector('[data-act=target][data-delta=\"-0.1\"]').click()"); pg.wait_for_timeout(200)
    print("target now:", pg.evaluate("document.querySelector('.gl-bar-host').shadowRoot.querySelector('.target b').textContent"))
    print("errors:", errs)
    b.close()
