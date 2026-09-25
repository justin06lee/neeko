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
import struct
import subprocess
import sys
import tempfile
import threading
import time
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from builds import ROOT, LeaveNoTrace, dev_app, program  # noqa: E402
from marionette import Marionette  # noqa: E402

# A UI with nothing but a content slot, away from the window's corner so the
# checks can tell the page's corner from the window's, a field to take
# keyboard focus, and a "menu" to draw over the page.
TEST_UI = (
    "<!doctype html><html><body style='margin: 0'>"
    "<input id='field' style='position: fixed; top: 0; left: 0; width: 150px'>"
    "<div id='menu' data-neeko-overlay hidden style='position: fixed; left: 400px;"
    " top: 100px; width: 200px; height: 100px; background: rgb(0, 200, 0);"
    " box-shadow: 0 0 20px black'></div>"
    "<main data-neeko-content style='position: fixed; inset: 40px 0 0 160px'>"
    "</main></body></html>"
)


def png(width, height):
    """A red PNG image of this size."""
    rows = b"".join(b"\x00" + b"\xff\x00\x00\xff" * width for _ in range(height))

    def chunk(kind, data):
        crc = zlib.crc32(kind + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


FAVICON = "/favicon.png"
FAVICON_PNG = png(2, 2)

PAGES = {
    "/one": "<title>Page one</title>",
    "/two": "<title>Page two</title>",
    # Titles itself with what a web page can see of the Neeko API.
    "/probe": "<title>probe</title><script>document.title = "
    "[typeof neeko, typeof parent.neeko, typeof top.neeko].join()</script>",
    # Asks for the location, which opens a permission prompt, and titles
    # itself with the outcome: "error 1" means the permission was refused.
    "/geo": "<title>geo</title><script>"
    "navigator.geolocation.getCurrentPosition("
    "() => document.title = 'allowed', e => document.title = 'error ' + e.code)"
    "</script>",
    # Goes fullscreen as soon as it loads (the test allows it without a click).
    "/fullscreen": "<title>fullscreen</title><script>"
    "onload = () => document.documentElement.requestFullscreen()</script>",
    # A page to scroll, which titles itself with how far it's scrolled.
    "/tall": "<title>0</title><body style='height: 5000px'><script>"
    "onscroll = () => document.title = Math.round(scrollY)</script>",
    # A page with an icon.
    "/icon": f"<title>icon</title><link rel='icon' href='{FAVICON}'>",
    # Plays a tone, too quietly to hear but not silent, which makes its tab
    # audible. The test allows playing without a click.
    "/audio": "<title>audio</title><script>"
    "let rate = 8000, v = new DataView(new ArrayBuffer(44 + rate));"
    "let text = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));"
    "text(0, 'RIFF'); v.setUint32(4, 36 + rate, true); text(8, 'WAVEfmt ');"
    "v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);"
    "v.setUint32(24, rate, true); v.setUint32(28, rate, true);"
    "v.setUint16(32, 1, true); v.setUint16(34, 8, true);"
    "text(36, 'data'); v.setUint32(40, rate, true);"
    "for (let i = 0; i < rate; i++) v.setUint8(44 + i, 128 + 100 * Math.sin(i / 3));"
    "let audio = new Audio(URL.createObjectURL(new Blob([v.buffer], { type: 'audio/wav' })));"
    "audio.loop = true; audio.volume = 0.001;"
    "audio.play().then(() => document.title = 'playing', e => document.title = e.name)"
    "</script>",
}

# Served as files to download: one at once, one slowly (3 seconds), and one
# that breaks off.
DOWNLOAD = "/download"
SLOW_DOWNLOAD = "/download-slow"
SLOW_SIZE = 300_000
BROKEN_DOWNLOAD = "/download-broken"


class Pages(http.server.BaseHTTPRequestHandler):
    def handle(self):
        # The browser sometimes drops a connection early (a tab closing or
        # navigating away mid-load), which is fine.
        try:
            super().handle()
        except ConnectionError:
            pass

    def download_headers(self, filename, size):
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(size))
        self.end_headers()

    def do_GET(self):
        if self.path == SLOW_DOWNLOAD:
            self.download_headers("neeko-slow.bin", SLOW_SIZE)
            for _ in range(30):
                self.wfile.write(b"x" * (SLOW_SIZE // 30))
                self.wfile.flush()
                time.sleep(0.1)
            return
        if self.path == BROKEN_DOWNLOAD:
            self.download_headers("neeko-broken.bin", SLOW_SIZE)
            self.wfile.write(b"x" * 1000)
            self.wfile.flush()
            time.sleep(0.3)
            # Reset the connection rather than close it, so it can't look
            # like the end of the file.
            self.connection.setsockopt(
                socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0)
            )
            self.connection.close()
            return
        if self.path == FAVICON:
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(FAVICON_PNG)))
            self.end_headers()
            self.wfile.write(FAVICON_PNG)
            return
        if self.path == DOWNLOAD:
            body = b"A test download from tools/test_api.py\n"
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header(
                "Content-Disposition", 'attachment; filename="neeko-test.txt"'
            )
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
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
let slot = frame?.contentDocument?.querySelector("[data-neeko-content]");
for (let i = 0; i < 100 && !(slot?.getBoundingClientRect().height > 100); i++) {
  await new Promise(r => setTimeout(r, 50));
}
let height = Math.round(slot?.getBoundingClientRect().height ?? 0);
let ok = test => (test ? "ok  " : "FAIL");
return [
  `${ok(frame?.contentWindow?.neeko)} without neeko.ui.path, the bundled UI loads with the API`,
  `${ok(served.includes("/chrome/browser/content/neeko-ui/"))} it comes from inside the app (${served})`,
  `${ok(height > 100)} its content slot has room for the page (${height}px high)`,
];
"""


# Firefox's defaults, back. User prefs win over Marionette's "recommended
# prefs", which stop the downloads panel from opening by itself and turn off
# the delay before a prompt's buttons work.
FIREFOX_PREFS = {
    "browser.download.alwaysOpenPanel": True,
    "browser.download.panel.shown": False,
    "security.notification_enable_delay": 500,
    # Let the test page go fullscreen without a click, and without the fade.
    "full-screen-api.allow-trusted-requests-only": False,
    "full-screen-api.transition-duration.enter": "0 0",
    "full-screen-api.transition-duration.leave": "0 0",
    # And play sound without a click.
    "media.autoplay.default": 0,
}


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
    prefs = {
        "marionette.port": port,
        # Downloads go into the throwaway profile.
        "browser.download.dir": os.path.join(profile, "downloads"),
        "browser.download.folderList": 2,
        **prefs,
    }
    if prefs.get("neeko.ui.path") == "TEST_UI":
        prefs["neeko.ui.path"] = ui
    browser = launch(binary, profile, prefs)
    try:
        m = connect(port, browser)
        m.send("WebDriver:SetTimeouts", {"script": timeout})
        # The whole script is one Marionette command, so its reply can take
        # longer than the socket's usual minute.
        m.sock.settimeout(timeout / 1000 + 30)
        started = time.time()
        results = m.run(script)
        print(f"(the checks took {time.time() - started:.0f} seconds)")
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
            script = script.replace("__SLOW_SIZE__", str(SLOW_SIZE))
            script = script.replace("__CLOSED__", f"http://127.0.0.1:{free_port()}")
        with LeaveNoTrace(app):
            prefs = {"neeko.ui.path": "TEST_UI", **FIREFOX_PREFS}
            results = run_in(binary, prefs, script)
            results += run_in(binary, {}, BUNDLED_CHECK, timeout=30000)
    finally:
        server.shutdown()
    print("\n".join(results))

    failed = [r for r in results if not r.startswith("ok")]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
