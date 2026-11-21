import os
from playwright.sync_api import sync_playwright
STUB = """
window.__sent=[]; const S={view:'dashboard',hasData:true,now:'1,8',plan:'1,5',range:'1,2–3,2',target:'1,5',next:{name:'Module C',date:'09.02.27',days:9}};
window.chrome={ runtime:{lastError:null}, storage:{local:{get:async()=>({gl_view:'dashboard'}), set:()=>{}}},
  tabs:{ query:async()=>[{id:1,url:URLX}], sendMessage:(id,m,cb)=>{ window.__sent.push(m); if(m.view) S.view=m.view; cb(S); }, update(){}, create(){} } };
window.close=()=>{};"""
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
    for name,url in (("popup_fom","https://oc-digital.de/node/6148"),("popup_other","https://example.com/")):
        pg=b.new_page(viewport={"width":340,"height":420}, device_scale_factor=2)
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.add_init_script(STUB.replace("URLX", repr(url)))
        pg.goto("http://localhost:8765/popup/popup.html"); pg.wait_for_timeout(300)
        if name=="popup_fom":
            pg.click("[data-view=inline]"); pg.wait_for_timeout(150)
            print("sent:", pg.evaluate("window.__sent"), "checked:", pg.evaluate("document.querySelector('[aria-checked=true]').dataset.view"))
            pg.screenshot(path="test/e2e/out/popup_fom_en.png", full_page=True)
            pg.click("[data-lang]"); pg.wait_for_timeout(150)
            de = pg.evaluate("document.querySelector('footer [data-i]').textContent")
            print("german footer:", de, "->", "PASS" if de.startswith("Im Browser") else "FAIL")
            print("lang message sent:", "PASS" if any(m.get('type')=='gl-set-lang' for m in pg.evaluate("window.__sent")) else "FAIL")
        pg.screenshot(path=f"test/e2e/out/{name}.png", full_page=True); print(name, "errors:", errs)
    b.close()
