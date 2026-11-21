"""Browser tests. Run from the repo root: python3 test/e2e/run_all.py  (needs: pip install playwright; a Chrome binary)."""
import subprocess, sys, time, os, pathlib
root = pathlib.Path(__file__).resolve().parents[2]; os.chdir(root); (root / "test/e2e/out").mkdir(exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8765"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); failed = False
try:
    for t in ["security.py", "inline_observer.py", "views.py", "popup.py"]:
        print(f"== {t} =="); out = subprocess.run([sys.executable, f"test/e2e/{t}"], capture_output=True, text=True)
        print(out.stdout.strip()); 
        if out.returncode or "FAIL" in out.stdout or "Error" in out.stderr: failed = True; print(out.stderr[-2000:])
    # the built extension, loaded for real in Chrome against a fake oc-digital.de page
    import tempfile, zipfile
    z = subprocess.run(["sh", "scripts/build.sh"], capture_output=True, text=True).stdout.split()[0]
    d = tempfile.mkdtemp(); zipfile.ZipFile(z).extractall(d)
    print("== extension.py =="); out = subprocess.run([sys.executable, "test/e2e/extension.py", d], capture_output=True, text=True)
    print(out.stdout.strip())
    if out.returncode: failed = True; print(out.stderr[-2000:])
finally:
    srv.terminate()
sys.exit(1 if failed else 0)
