"""Loads the built zip as a real unpacked extension and serves a fake oc-digital.de page,
so the real content scripts, i18n, fonts and storage run as they would for a student.
Usage: sh scripts/build.sh && python3 test/e2e/extension.py /path/to/unzipped"""
import os, sys, pathlib, tempfile
from playwright.sync_api import sync_playwright
ext = sys.argv[1]
root = pathlib.Path(__file__).resolve().parents[2]
page_html = (root / "test/e2e/harness.html").read_text()
# the real extension injects its own scripts: strip the harness copies and the test-only shim
page_html = "\n".join(l for l in page_html.splitlines() if "<script" not in l and "chrome.runtime =" not in l)
fx = (root / "test/fixture.studybook.json").read_text()
ok = True
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), executable_path=os.environ.get("CHROME_PATH") or None,
        headless=True, args=[f"--disable-extensions-except={ext}", f"--load-extension={ext}", "--headless=new"], viewport={"width": 1440, "height": 900})
    ctx.route("https://oc-digital.de/**", lambda r: r.fulfill(status=200, content_type="text/html", body=page_html + """
<script>fetch('/campus/api/epm/studybook/1').then(r=>r.text())</script>""") if "studybook" not in r.request.url else r.fulfill(status=200, content_type="application/json", body=fx))
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("https://oc-digital.de/node/6148"); pg.wait_for_timeout(1500)
    has = pg.evaluate("!!document.getElementById('grade-lens-root')")
    print("content script attached:", "PASS" if has else "FAIL"); ok &= has
    pg.evaluate("document.getElementById('grade-lens-root').shadowRoot.querySelector('.launcher').click()"); pg.wait_for_timeout(600)
    big = pg.evaluate("document.getElementById('grade-lens-root').shadowRoot.querySelector('.big')?.textContent")
    print("study book read through the real hook:", big, "PASS" if big == "1,8" else "FAIL"); ok &= big == "1,8"
    font = pg.evaluate("document.fonts.check('16px \"GL Plex Sans\"') && [...document.fonts].some(f => f.family.includes('GL Plex') && f.status === 'loaded')")
    print("bundled font loaded:", "PASS" if font else "FAIL"); ok &= bool(font)
    sw = [w.url for w in ctx.service_workers]
    print("page errors:", errs); ok &= not errs
    pg.screenshot(path=str(root / "test/e2e/out/ext_dashboard.png"))
    ctx.close()
sys.exit(0 if ok else 1)
