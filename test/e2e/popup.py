import os
from playwright.sync_api import sync_playwright
STUB = """
window.__sent=[]; const S={view:'dashboard',hasData:true,now:'1,8',plan:'1,9',range:'1,3–3,0',target:'1,8',next:{name:'Deutsch',date:'13.11.26',days:4}};
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
        pg.screenshot(path=f"test/e2e/out/{name}.png", full_page=True); print(name, "errors:", errs)
    b.close()
