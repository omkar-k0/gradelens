import os
import pathlib
from playwright.sync_api import sync_playwright
fx = pathlib.Path("test/fixture.studybook.json").read_text()
R = "document.getElementById('grade-lens-root').shadowRoot"
GOOD = "https://oc-digital.de/campus/api/epm/studybook/1"
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None); pg=b.new_page(viewport={"width":1440,"height":900})
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:8765/test/e2e/harness.html"); pg.wait_for_timeout(300)
    pg.evaluate("([u,t]) => window.postMessage({source:'fom-grade-lens',kind:'studybook',url:u,text:t}, location.origin)", [GOOD, fx])
    pg.wait_for_timeout(200); pg.evaluate(f"{R}.querySelector('.launcher').click()"); pg.wait_for_timeout(200)
    pg.evaluate(f"{R}.querySelector('[data-view=inline]').click()"); pg.wait_for_timeout(500)
    pg.evaluate("""() => { window.__sel = document.querySelector('.gl-badge-host').shadowRoot.querySelector('select'); window.__sel.focus();
      const n=document.createElement('span'); document.body.appendChild(n); window.__tick=setInterval(()=>{ n.textContent=Date.now(); }, 100);
      window.__renders=0; document.querySelectorAll('.gl-badge-host').forEach(h => new MutationObserver(()=>window.__renders++).observe(h.shadowRoot, {childList:true, subtree:true})); }""")
    pg.wait_for_timeout(3000)
    r1 = pg.evaluate("window.__renders"); s1 = pg.evaluate("window.__sel.isConnected")
    print(f"5a re-renders during 3 s of page churn: {r1}  (was 7)  -> {'PASS' if r1==0 else 'FAIL'}")
    print(f"5b focused picker survives churn: {s1}  -> {'PASS' if s1 else 'FAIL'}")
    # a user pick must still re-render (state change)
    pg.evaluate("""() => { const s=document.querySelector('.gl-badge-host').shadowRoot.querySelector('select'); s.value='1.0'; s.dispatchEvent(new Event('change',{bubbles:true})); }""")
    pg.wait_for_timeout(200)
    plan = pg.evaluate("document.querySelector('.gl-bar-host').shadowRoot.querySelector('.kv .accent').textContent")
    print(f"5c a pick still updates the bar (plan now {plan}) -> {'PASS' if plan else 'FAIL'}")
    # SPA: FOM removes the grid (navigate away)
    pg.evaluate("clearInterval(window.__tick); window.__grid = document.querySelector('.cols'); window.__grid.remove()"); pg.wait_for_timeout(600)
    bars = pg.evaluate("document.querySelectorAll('.gl-bar-host').length")
    print(f"8  bar removed when grid disappears: {bars==0} -> {'PASS' if bars==0 else 'FAIL'}")
    # SPA: FOM renders the grid again (navigate back) with fresh card nodes
    pg.evaluate("document.querySelector('main').appendChild(window.__grid.cloneNode(true))"); pg.wait_for_timeout(700)
    bars = pg.evaluate("document.querySelectorAll('.gl-bar-host').length"); badges = pg.evaluate("document.querySelectorAll('.gl-badge-host').length")
    print(f"5d re-attached after SPA navigation back: bar={bars} badges={badges} -> {'PASS' if bars==1 and badges==2 else 'FAIL'}")
    # layout drift: FOM adds a card we don't know -> badges off + explained
    pg.evaluate("""() => { const c=document.querySelector('.course-element').cloneNode(true); c.querySelector('.gl-badge-host') && c.querySelector('.gl-badge-host').remove(); document.querySelector('.cols > div').appendChild(c); }"""); pg.wait_for_timeout(700)
    badges = pg.evaluate("document.querySelectorAll('.gl-badge-host').length")
    note = pg.evaluate("document.querySelector('.gl-bar-host').shadowRoot.querySelector('.ib-need').textContent")
    print(f"5e layout mismatch -> badges off ({badges}) and explained: {'doesn' in note} -> {'PASS' if badges==0 and 'doesn' in note else 'FAIL'}")
    print("page errors:", errs)
    b.close()
