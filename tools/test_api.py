"""Check the Neeko API end to end in the real dev build.

    make build
    python3 tools/test_api.py
    python3 tools/test_api.py --app dist/Neeko.app    # a packaged release

Launches the dev build with a fresh profile, Marionette and a bare test UI
(no scripts, so only the checks themselves use the API), serves a few test
pages from localhost, runs tools/test_api.js in the browser window, and
quits. Then launches it once more without a UI folder, to check the UI the
build bundles inside the app loads and gets the API. Needs no internet.
Exits non-zero if any check fails.
"""

import argparse
import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from builds import ROOT, LeaveNoTrace, dev_app, program  # noqa: E402
from marionette import Marionette  # noqa: E402

# A UI with nothing but a content slot.
TEST_UI = (
    "<!doctype html><html><body style='margin: 0'>"
    "<main data-neeko-content style='position: fixed; inset: 0'></main>"
    "</body></html>"
)

PAGES = {
    "/one": "<title>Page one</title>",
    "/two": "<title>Page two</title>",
    # Titles itself with what a web page can see of the Neeko API.
    "/probe": "<title>probe</title><script>document.title = "
    "[typeof neeko, typeof parent.neeko, typeof top.neeko].join()</script>",
}


class Pages(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = PAGES.get(self.path)
        self.send_response(200 if body else 404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write((body or "").encode())

    def log_message(self, *args):
        pass


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def connect(port, browser, timeout=60):
    deadline = time.time() + timeout
    while True:
        try:
            return Marionette(port)
        except OSError:
            if browser.poll() is not None or time.time() > deadline:
                raise
            time.sleep(0.5)


# With no neeko.ui.path, the UI bundled inside the app loads, with the API.
BUNDLED_CHECK = """
let frame = null;
for (let i = 0; i < 200 && !frame?.contentWindow?.neeko; i++) {
  await new Promise(r => setTimeout(r, 50));
  frame = document.getElementById("neeko-ui");
}
let served = Cc["@mozilla.org/chrome/chrome-registry;1"]
  .getService(Ci.nsIChromeRegistry)
  .convertChromeURL(Services.io.newURI("chrome://neeko-ui/content/index.html")).spec;
let ok = test => (test ? "ok  " : "FAIL");
return [
  `${ok(frame?.contentWindow?.neeko)} without neeko.ui.path, the bundled UI loads with the API`,
  `${ok(served.includes("/chrome/browser/content/neeko-ui/"))} it comes from inside the app (${served})`,
];
"""


def launch(binary, profile, prefs):
    with open(os.path.join(profile, "user.js"), "w") as f:
        for name, value in prefs.items():
            f.write(f"user_pref({json.dumps(name)}, {json.dumps(value)});\n")
    return subprocess.Popen(
        [binary, "-no-remote", "-marionette", "-remote-allow-system-access",
         "-profile", profile],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def run_in(binary, prefs, script, timeout=120000):
    """Launches with a fresh profile, runs a script in the browser window,
    quits, and returns the script's lines of results."""
    port = free_port()
    profile = tempfile.mkdtemp(prefix="neeko-api-test-")
    ui = os.path.join(profile, "test-ui")
    os.mkdir(ui)
    with open(os.path.join(ui, "index.html"), "w") as f:
        f.write(TEST_UI)
    prefs = {"marionette.port": port, **prefs}
    if prefs.get("neeko.ui.path") == "TEST_UI":
        prefs["neeko.ui.path"] = ui
    browser = launch(binary, profile, prefs)
    try:
        m = connect(port, browser)
        m.send("WebDriver:SetTimeouts", {"script": timeout})
        results = m.run(script)
        if isinstance(results, str):  # the script itself threw
            results = [f"FAIL {results}"]
        try:
            m.send("Marionette:Quit", {"flags": ["eForceQuit"]})
        except (OSError, RuntimeError):
            pass
        browser.wait(timeout=30)
    finally:
        if browser.poll() is None:
            browser.kill()
        shutil.rmtree(profile, ignore_errors=True)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--app", help="a .app to test (default: the dev build)")
    args = parser.parse_args()
    app = os.path.abspath(args.app) if args.app else dev_app()
    binary = program(app)

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Pages)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with open(os.path.join(ROOT, "tools/test_api.js")) as f:
            script = f.read().replace("__BASE__", base)
        with LeaveNoTrace(app):
            results = run_in(binary, {"neeko.ui.path": "TEST_UI"}, script)
            results += run_in(binary, {}, BUNDLED_CHECK, timeout=30000)
    finally:
        server.shutdown()
    print("\n".join(results))

    failed = [r for r in results if not r.startswith("ok")]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
