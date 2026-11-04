#!/usr/bin/env python3
"""Spec 0117 P1 in real WebKitGTK: the data: URL the app uses loads under its CSP.

Needs PyGObject with WebKit2 4.1 and a Vite dev server:

  COXINHA_URL=http://localhost:14255 python3 tools/ui-preview/person-photos-webkitgtk.py
"""
import importlib.util
import json
import os
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("audit", HERE / "webkitgtk-audit.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

IMAGES = """JSON.stringify([...document.querySelectorAll('img')]
  .filter((img) => img.src.startsWith('data:image/') && img.alt !== 'Coxinha')
  .map((img) => ({ alt: img.alt, width: img.naturalWidth })))"""
PROBE = "JSON.stringify(document.getElementById('probe').naturalWidth)"
failures = 0


def check(name, ok, detail=""):
    global failures
    if not ok:
        failures += 1
    print(f"{'ok  ' if ok else 'FAIL'} {name}{f' ({detail})' if detail else ''}")


def fixture_source():
    text = (HERE / "fixtures/photos.js").read_text()
    return re.search(r"'(data:image/png;base64,[^']+)'", text).group(1)


def csp_of_app():
    config = json.loads((HERE / "../../src-tauri/tauri.conf.json").read_text())
    return config["app"]["security"]["csp"]


def probe(page, policy, source):
    html = (
        f"<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"{policy}\">"
        f"<img id=\"probe\" src=\"{source}\">"
    )
    page.finished = False
    page.view.load_html(html, "http://localhost/")
    page.pump(lambda: page.finished)
    page.wait(400)
    return json.loads(page.eval(PROBE))


def main():
    url = os.environ.get("COXINHA_URL")
    if not url:
        sys.exit("set COXINHA_URL to a running Vite dev server")
    page = audit.Page()
    source = fixture_source()

    csp = csp_of_app()
    check(
        "the app's CSP allows data: images",
        csp is None or "data:" in str(csp),
        f"csp={csp!r}",
    )
    check(
        "a data: image loads under a strict img-src with data:",
        probe(page, "default-src 'self'; img-src 'self' data:", source) == 48,
    )
    check(
        "the probe can fail: the same image without data: is blocked",
        probe(page, "default-src 'self'; img-src 'self'", source) == 0,
    )

    page.prepare(1200, 800, "dark", 16)
    page.manager.add_script(
        audit.WebKit2.UserScript(
            "window.__cxState.photosOn = true;",
            audit.WebKit2.UserContentInjectedFrames.TOP_FRAME,
            audit.WebKit2.UserScriptInjectionTime.START,
        )
    )
    page.load(url)
    for _ in range(60):
        if page.eval("String(!!window.__coxinha?.router)") == "true":
            break
        page.wait(250)
    page.eval("window.__coxinha.router.navigate({href: '/people'}); 'ok'")
    shown = []
    for _ in range(40):
        page.wait(500)
        shown = json.loads(page.eval(IMAGES))
        if len(shown) >= 2 and all(i["width"] for i in shown):
            break
    check(
        "the app's photos decode in WebKitGTK",
        len(shown) == 2 and all(i["width"] == 48 for i in shown),
        json.dumps(shown, ensure_ascii=False),
    )
    check(
        "each photo has useful alt text",
        any(i["alt"] == "Foto de Rita Souza" for i in shown),
    )
    print("all passed" if not failures else f"{failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
