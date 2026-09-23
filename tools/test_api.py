"""Check the Neeko API end to end in the real dev build.

    make build
    python3 tools/test_api.py

Launches the dev build with a fresh profile, the UI from ui/ and Marionette,
serves a few test pages from localhost, runs tools/test_api.js in the browser
window, and quits. Needs no internet. Exits non-zero if any check fails.
"""

import glob
import http.server
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from marionette import Marionette  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

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


def main():
    binaries = glob.glob(
        os.path.join(ROOT, "engine/obj-*/dist/*.app/Contents/MacOS/firefox")
    )
    if not binaries:
        sys.exit("No dev build found. Run `make build` first.")

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Pages)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"

    port = free_port()
    profile = tempfile.mkdtemp(prefix="neeko-api-test-")
    with open(os.path.join(profile, "user.js"), "w") as f:
        f.write(f'user_pref("neeko.ui.path", "{ROOT}/ui");\n')
        f.write(f'user_pref("marionette.port", {port});\n')

    browser = subprocess.Popen(
        [binaries[0], "-no-remote", "-marionette", "-remote-allow-system-access",
         "-profile", profile],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        m = connect(port, browser)
        m.send("WebDriver:SetTimeouts", {"script": 120000})
        with open(os.path.join(ROOT, "tools/test_api.js")) as f:
            script = f.read().replace("__BASE__", base)
        results = m.run(script)
        if isinstance(results, str):  # the script itself threw
            results = [f"FAIL {results}"]
        print("\n".join(results))
        try:
            m.send("Marionette:Quit", {"flags": ["eForceQuit"]})
        except (OSError, RuntimeError):
            pass
        browser.wait(timeout=30)
    finally:
        if browser.poll() is None:
            browser.kill()
        server.shutdown()
        shutil.rmtree(profile, ignore_errors=True)

    failed = [r for r in results if not r.startswith("ok")]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
