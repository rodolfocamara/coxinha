#!/usr/bin/env python3
"""The audit of spec 0125 in real WebKitGTK, the engine of the Linux app.

Same fixtures and checks as audit-appearance.mjs, in an offscreen WebKit2 view, so
nothing appears on screen. Needs PyGObject with WebKit2 4.1 and a Vite dev server:

  COXINHA_URL=http://localhost:14255 python3 tools/ui-preview/webkitgtk-audit.py \
    [--sizes 12,16,20] [--windows 1200x800,800x600] [--themes dark,light] [--out DIR]
"""
import argparse
import json
import os
import pathlib
import sys

import gi

# An offscreen view has no GL context of its own.
os.environ.setdefault("WEBKIT_DISABLE_COMPOSITING_MODE", "1")
os.environ.setdefault("WEBKIT_DISABLE_DMABUF_RENDERER", "1")

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

HERE = pathlib.Path(__file__).parent
SCREENS = {
    "today": "/",
    "week": "/meetings?view=week",
    "month": "/meetings?view=month",
    "meeting": "/meetings/s-rita",
    "people": "/people",
    "settings-appearance": "/settings/appearance",
    "settings-shortcuts": "/settings/shortcuts",
    "settings-recording": "/settings/recording",
    "settings-transcription": "/settings/transcription",
    "settings-calendar": "/settings/calendar",
    "settings-integrations": "/settings/integrations",
    "settings-titles": "/settings/titles",
    "settings-storage": "/settings/storage",
    "settings-diagnostics": "/settings/diagnostics",
    "workspace": "/workspace",
}

# What the appearance feature relies on from the engine.
FEATURES = """(() => {
  const css = (p, v) => CSS.supports(p, v);
  const color = document.createElement('input');
  color.type = 'color';
  return JSON.stringify({
    rootFontSize: getComputedStyle(document.documentElement).fontSize,
    oklch: css('color', 'oklch(0.7 0.14 55)'),
    colorMix: css('color', 'color-mix(in oklab, red, blue)'),
    containerQueries: css('container-type', 'inline-size'),
    individualScale: css('scale', '1.25'),
    has: CSS.supports('selector(:has(a))'),
    inputColor: color.type === 'color',
    sliderThumb: CSS.supports('selector(::-webkit-slider-thumb)'),
    fontSmoothing: css('-webkit-font-smoothing', 'antialiased'),
  });
})()"""


def fixtures():
    files = sorted(
        (HERE / "fixtures").glob("*.js"), key=lambda f: (f.name != "base.js", f.name)
    )
    return [f.read_text() for f in files] + [(HERE / "mock-ipc.js").read_text()]


class Page:
    def __init__(self):
        self.manager = WebKit2.UserContentManager()
        self.view = WebKit2.WebView.new_with_user_content_manager(self.manager)
        self.window = Gtk.OffscreenWindow()
        self.window.add(self.view)
        self.finished = False
        self.view.connect("load-changed", self._loaded)
        self.window.show_all()

    def _loaded(self, _view, event):
        if event == WebKit2.LoadEvent.FINISHED:
            self.finished = True

    @staticmethod
    def pump(done, seconds=40):
        """Runs the main loop until done() or the deadline; a late event cannot end it early."""
        context = GLib.MainContext.default()
        deadline = GLib.get_monotonic_time() + seconds * 1_000_000
        while not done() and GLib.get_monotonic_time() < deadline:
            context.iteration(False)
            GLib.usleep(2000)
        return done()

    def prepare(self, width, height, theme, size):
        self.window.set_default_size(width, height)
        self.window.resize(width, height)
        self.view.set_size_request(width, height)
        self.manager.remove_all_scripts()
        seed = "localStorage.setItem('coxinha.themePref', %s);" % json.dumps(theme)
        seed += "localStorage.setItem('coxinha.appearance', %s);" % json.dumps(
            json.dumps({"fontSize": size, "language": "pt-BR"})
        )
        seed += "window.__cxState = {};"
        audit = (HERE / "audit-text.js").read_text()
        for source in [seed, *fixtures(), audit]:
            self.manager.add_script(
                WebKit2.UserScript(
                    source,
                    WebKit2.UserContentInjectedFrames.TOP_FRAME,
                    WebKit2.UserScriptInjectionTime.START,
                )
            )

    def load(self, url):
        self.finished = False
        self.view.load_uri(url)
        if not self.pump(lambda: self.finished):
            raise RuntimeError(f"timeout loading {url}")

    def wait(self, ms):
        end = GLib.get_monotonic_time() + ms * 1000
        self.pump(lambda: GLib.get_monotonic_time() >= end)

    def eval(self, source):
        box = {}

        def done(view, result):
            try:
                box["value"] = view.evaluate_javascript_finish(result).to_string()
            except GLib.Error as error:
                box["error"] = error.message

        self.view.evaluate_javascript(source, -1, None, None, None, done)
        if not self.pump(lambda: box):
            raise RuntimeError("timeout evaluating script")
        if "error" in box:
            raise RuntimeError(box["error"])
        return box["value"]

    def snapshot(self, path):
        box = {}

        def done(view, result):
            view.get_snapshot_finish(result).write_to_png(path)
            box["ok"] = True

        self.view.get_snapshot(
            WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE, None, done
        )
        self.pump(lambda: box)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sizes", default="12,16,20")
    parser.add_argument("--themes", default="dark,light")
    parser.add_argument("--windows", default="1200x800,800x600")
    parser.add_argument("--screens", default=",".join(SCREENS))
    parser.add_argument("--out", default="/tmp/cx-appearance-webkitgtk")
    args = parser.parse_args()
    base = os.environ.get("COXINHA_URL", "http://localhost:14255")
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    page = Page()
    print(f"WebKitGTK {WebKit2.get_major_version()}.{WebKit2.get_minor_version()}.{WebKit2.get_micro_version()}")
    report, failures, features = [], 0, None
    for size in map(int, args.sizes.split(",")):
        for theme in args.themes.split(","):
            for win in args.windows.split(","):
                width, height = map(int, win.split("x"))
                for screen in args.screens.split(","):
                    page.prepare(width, height, theme, size)
                    page.load(base)
                    for _ in range(60):
                        if page.eval("String(!!window.__coxinha?.router)") == "true":
                            break
                        page.wait(250)
                    page.eval(
                        "window.__coxinha.router.navigate({href: %s}); 'ok'"
                        % json.dumps(SCREENS[screen])
                    )
                    page.wait(900)
                    result = json.loads(page.eval("JSON.stringify(window.__cxAuditText())"))
                    actual = page.eval("getComputedStyle(document.documentElement).fontSize")
                    if actual != f"{size}px":
                        result["issues"].append({"kind": "size-not-applied", "text": actual, "where": "html"})
                    features = features or json.loads(page.eval(FEATURES))
                    name = f"{screen}-{size}-{theme}-{width}"
                    page.snapshot(str(out / f"{name}.png"))
                    failures += len(result["issues"])
                    report.append({"name": name, "screen": screen, "size": size, "theme": theme, "width": width, **result})
                    print(f"{'FAIL' if result['issues'] else 'ok  '} {name} ({result['textCount']} text boxes, {len(result['issues'])} issues)", flush=True)
    (out / "report.json").write_text(json.dumps(report, indent=2))
    print("features:", json.dumps(features))
    print(f"{len(report)} screens, {failures} issues. Report: {out / 'report.json'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
