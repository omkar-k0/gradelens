import os
import json
from playwright.sync_api import sync_playwright
GOOD = "https://oc-digital.de/campus/api/epm/studybook/1791188"
evil = {"studyplan":{"istects":0,"planects":10},"modulebereiche4list":[{"name":"1","module":[
  {"modulid":"1\" onmouseover=\"window.__pwned=1\" x=\"","name":"<img src=x onerror=window.__pwned=2>","credits":5,
   "pruefungen":[{"pruefungid":1,"name":"E","note":{},"pruefungstermin":{"datum":"\"><svg onload=window.__pwned=3>"}}]},
  {"modulid":2,"name":"Ok","credits":5,"note":{"note":1.3,"status":"bestanden"},"pruefungen":[{"pruefungid":2,"name":"E","note":{"note":1.3,"status":"bestanden"},"pruefungsergebnisse":[{"onlydatum":"01.01.2026, 10:00"}]}]}]}]}
R = "document.getElementById('grade-lens-root').shadowRoot"
post = "([u,t]) => window.postMessage({source:'fom-grade-lens',kind:'studybook',url:u,text:t}, location.origin)"
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
    pg=b.new_page(viewport={"width":1440,"height":900}); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:8765/test/e2e/harness.html"); pg.wait_for_timeout(300)
    for u in ("anything", "https://evil.example/campus/api/epm/studybook/1", "https://oc-digital.de/campus/api/epm/studybook/1/../../x"):
        pg.evaluate(post, [u, json.dumps(evil)])
    pg.wait_for_timeout(150); pg.evaluate(f"{R}.querySelector('.launcher').click()"); pg.wait_for_timeout(200)
    print("T1 spoofed URLs rejected:", pg.evaluate(f"!{R}.querySelector('select[data-mod]')"))
    pg.evaluate(post, [GOOD, json.dumps(evil)]); pg.wait_for_timeout(300)
    for view in ("dashboard","drawer","inline"):
        pg.evaluate(f"{R}.querySelector('[data-view={view}]') ? {R}.querySelector('[data-view={view}]').click() : document.querySelector('.gl-bar-host').shadowRoot.querySelector('[data-view={view}]').click()")
        pg.wait_for_timeout(300)
        pg.evaluate("""() => { const all=[document, ...[...document.querySelectorAll('*')].filter(e=>e.shadowRoot).map(e=>e.shadowRoot)];
          all.forEach(r => r.querySelectorAll('*').forEach(el => el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})))); }""")
        pg.wait_for_timeout(100)
    print("T2 injected code executed in any view:", pg.evaluate("window.__pwned || false"))
    sel = pg.evaluate("""() => { const h=[...document.querySelectorAll('*')].filter(e=>e.shadowRoot).map(e=>e.shadowRoot.querySelector('select[data-mod]')).find(Boolean); return h && h.getAttribute('data-mod'); }""")
    print("T3 hostile id rendered as:", sel)
    big = "x" * (6*1024*1024)
    pg.evaluate(post, [GOOD, big]); pg.wait_for_timeout(200)
    print("T4a launcher visible after error in inline mode:", pg.evaluate(f"!{R}.querySelector('.launcher').hidden"))
    pg.evaluate(f"{R}.querySelector('.launcher').click()"); pg.wait_for_timeout(200)
    print("T4 6 MB payload -> safe error shown:", pg.evaluate(f"({R}.querySelector('.empty.warn')||{{}}).textContent || null"))
    pg.evaluate(post, [GOOD, json.dumps({"stn":{"notensystem":"Punkte15"},"modulebereiche4list":[]})]); pg.wait_for_timeout(200)
    print("T5 unsupported grading ->", pg.evaluate(f"({R}.querySelector('.empty.warn')||{{}}).textContent || null"))
    print("page errors:", errs)
    b.close()
