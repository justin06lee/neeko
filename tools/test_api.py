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
from builds import ROOT, LeaveNoTrace, command, dev_app, launch_env, sandbox_reads  # noqa: E402
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
# An SVG icon, which Firefox has the page's own process draw.
SVG_FAVICON = "/favicon.svg"
SVG_FAVICON_BODY = (
    b"<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'>"
    b"<rect width='16' height='16' fill='green'/></svg>"
)

# The app's own pages (NeekoPages), in the throwaway profile's pages/ folder.
# The start page does what its query says, with neekoPage, and titles itself
# with the outcome, which the checks read from its tab.
TEST_PAGES = {
    "start.html": "<title>start</title><script>"
    "let q = new URLSearchParams(location.search);"
    "let show = t => document.title = t;"
    "let fail = e => show('refused ' + e.message);"
    "switch (q.get('test')) {"
    "case null: show([typeof neekoPage, typeof ChromeUtils, typeof neeko, neekoPage.private].join()); break;"
    "case 'go': neekoPage.go(q.get('to')).catch(fail); break;"
    "case 'js': neekoPage.go('javascript:document.title=1').catch(fail); break;"
    "case 'open': neekoPage.open(q.get('to'), { background: true })"
    ".then(() => show('opened'), fail); break;"
    "case 'settings': neekoPage.settings.get('shared')"
    ".then(v => neekoPage.settings.set('fromPage', 'yes').then(() => show('read ' + v)))"
    ".catch(fail); break;"
    "case 'listen': neekoPage.settings.on('change',"
    " ({ key, value }) => show(`change ${key}=${value}`)); show('listening'); break;"
    "case 'engines': neekoPage.search.engines().then(list => show("
    "`engines ${list.length} ${list.filter(e => e.isDefault).length}`), fail); break;"
    "case 'default': neekoPage.search.setDefault(q.get('id'))"
    ".then(() => show('default set'), fail); break;"
    "case 'isdefault': neekoPage.defaultBrowser.isDefault()"
    ".then(v => show('isdefault ' + v), fail); break;"
    "case 'setdefault-now': neekoPage.defaultBrowser.setDefault()"
    ".then(v => show('set ' + v), fail); break;"
    "case 'setdefault': onclick = () => neekoPage.defaultBrowser.setDefault()"
    ".then(v => show('set ' + v), fail); show('ready'); break;"
    "case 'browsers': neekoPage.import.browsers().then(list => show('browsers ' + list.length + ' '"
    " + JSON.stringify(list.filter(b => b.available).map(b => [b.id, b.needsPermission,"
    " b.profiles.map(p => [p.id, p.name, p.types.join('+')])]))), fail); break;"
    "case 'import-now': neekoPage.import.fromBrowser('chrome')"
    ".then(r => show('imported ' + JSON.stringify(r)), fail); break;"
    "case 'import': onclick = () => neekoPage.import.fromBrowser('chrome', { profile: 'Default' })"
    ".then(r => show('imported ' + JSON.stringify(r)), fail); show('ready'); break;"
    "case 'import-all': onclick = () => neekoPage.import.fromBrowser('chrome',"
    " { profiles: ['Default', 'Profile 1'] })"
    ".then(r => show('imported ' + JSON.stringify(r)), fail); show('ready'); break;"
    "case 'container': show('container ' + neekoPage.container); break;"
    "case 'ephemeral-now': neekoPage.containers.update(q.get('id'), { ephemeral: true })"
    ".then(() => show('updated'), fail); break;"
    "case 'helper': neekoPage.helper.fetch('echo', '/echo', { method: 'POST', body: 'from a page',"
    " headers: { 'X-Test': 'page' } }).then(r => r.json()).then(j => show('helper ' + JSON.stringify("
    "[j.body, j.headers['x-test'], j.headers['x-neeko-caller'], j.headers['x-neeko-private']])), fail); break;"
    "case 'helper-stream': neekoPage.helper.fetch('echo', '/stream?n=3').then(async r => {"
    " let reader = r.body.getReader(), parts = 0, text = '';"
    " for (;;) { let { done, value } = await reader.read(); if (done) break; parts++;"
    " text += new TextDecoder().decode(value); }"
    " show('streamed ' + parts + ' ' + JSON.stringify(text)) }).catch(fail); break;"
    "case 'helper-reserved': neekoPage.helper.fetch('echo', '/echo', { headers: { 'X-Neeko-Caller': 'ui' } })"
    ".then(() => show('sent'), fail); break;"
    "case 'helper-cancel': { let c = new AbortController();"
    " neekoPage.helper.fetch('echo', '/forever', { signal: c.signal }).then(async r => {"
    " let reader = r.body.getReader(); await reader.read(); c.abort();"
    " await reader.read().then(() => show('not cancelled'), e => show('cancelled ' + e.name)) }).catch(fail); break; }"
    "case 'secret-has': neekoPage.secrets.has(q.get('name'))"
    ".then(v => show('has ' + v + ' ' + typeof neekoPage.secrets.get), fail); break;"
    "case 'secret-now': neekoPage.secrets.set(q.get('name'), 'from a page')"
    ".then(() => show('set'), fail); break;"
    "case 'secret-set': onclick = () => neekoPage.secrets.set(q.get('name'), 'from a page')"
    ".then(() => show('set'), fail); show('ready'); break;"
    "case 'secret-delete': onclick = () => neekoPage.secrets.delete(q.get('name'))"
    ".then(() => show('deleted'), fail); show('ready'); break;"
    "case 'secret-listen': neekoPage.secrets.on('change',"
    " ({ name, present }) => show(`change ${name} ${present}`)); show('listening'); break;"
    "case 'secret-waiting': { let seen = []; neekoPage.secrets.on('waiting',"
    " ({ waiting }) => { seen.push(waiting); show('waiting ' + seen.join()) }); show('listening'); break; }"
    "case 'secret-helper': neekoPage.helper.fetch('echo', '/echo', { secrets: [q.get('name')] })"
    ".then(r => r.json()).then(j => show('helper ' + (j.headers['x-neeko-secret-' + q.get('name')] ?? 'none')), fail); break;"
    "case 'file': onclick = () => neekoPage.import.fromFile(q.get('kind'))"
    ".then(r => show('file ' + JSON.stringify(r)), fail); show('ready'); break;"
    "}</script>",
    # Named like Firefox's own about:preferences, so it isn't served.
    "preferences.html": "<title>not Firefox's</title>",
}

PAGES = {
    "/one": "<title>Page one</title>",
    "/two": "<title>Page two</title>",
    # Titles itself with what a web page can see of the Neeko API.
    "/probe": "<title>probe</title><script>document.title = "
    "[typeof neeko, typeof parent.neeko, typeof top.neeko, typeof neekoPage].join()</script>",
    # Tries to go to one of the browser's own pages, which web pages can't.
    "/reach-start": "<title>reach</title><script>"
    "try { location.href = 'about:start' } catch (e) { document.title = 'blocked' }"
    "</script>",
    # Asks for the location, which opens a permission prompt, and titles
    # itself with the outcome: "error 1" means the permission was refused.
    "/geo": "<title>geo</title><script>"
    "navigator.geolocation.getCurrentPosition("
    "() => document.title = 'allowed', e => document.title = 'error ' + e.code)"
    "</script>",
    # Text to find: "fox" three times, once as "Fox".
    "/find": "<title>find</title><p>The quick brown fox jumps. A fox again."
    " And a third Fox.</p>",
    # The same, at another address.
    "/find-again": "<title>find again</title><p>The quick brown fox jumps."
    " A fox again. And a third Fox.</p>",
    # A link, for the context menu.
    "/link": "<title>link</title><a href='/one' style='font-size: 40px'>A link</a>",
    # A page's dialog, which the app's theme styles.
    "/alert": "<title>alert</title><script>setTimeout(() => alert('A test'), 100)</script>",
    # Goes fullscreen as soon as it loads (the test allows it without a click).
    "/fullscreen": "<title>fullscreen</title><script>"
    "onload = () => document.documentElement.requestFullscreen()</script>",
    # A page to scroll, which titles itself with how far it's scrolled.
    "/tall": "<title>0</title><body style='height: 5000px'><script>"
    "onscroll = () => document.title = Math.round(scrollY)</script>",
    # Titles itself with the color scheme it's asked to use, and follows it.
    "/scheme": "<title>scheme</title><script>"
    "let dark = matchMedia('(prefers-color-scheme: dark)');"
    "let show = () => document.title = dark.matches ? 'dark' : 'light';"
    "show(); dark.onchange = show</script>",
    # A page with an icon.
    "/icon": f"<title>icon</title><link rel='icon' href='{FAVICON}'>",
    "/svg-icon": f"<title>svg icon</title><link rel='icon' href='{SVG_FAVICON}'>",
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
# A page that takes a moment to answer.
SLOW_PAGE = "/slow-page"


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
        if self.path == SLOW_PAGE:
            # Long enough for Firefox to say it's waiting for the site.
            time.sleep(1.5)
            body = b"<title>slow</title>A slow page"
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == SVG_FAVICON:
            self.send_response(200)
            self.send_header("Content-Type", "image/svg+xml")
            self.send_header("Content-Length", str(len(SVG_FAVICON_BODY)))
            self.end_headers()
            self.wfile.write(SVG_FAVICON_BODY)
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
let results = [
  `${ok(frame?.contentWindow?.neeko)} without neeko.ui.path, the bundled UI loads with the API`,
  `${ok(served.includes("/chrome/browser/content/neeko-ui/"))} it comes from inside the app (${served})`,
  `${ok(height > 100)} its content slot has room for the page (${height}px high)`,
];
// And the app's own pages bundled inside it, if it has a start page (the
// demo app does); without one, the New Tab page stays Firefox's.
let { NeekoPages } = ChromeUtils.importESModule("moz-src:///browser/neeko/NeekoPages.sys.mjs");
if (NeekoPages.names.includes("start")) {
  let tab = gBrowser.addTrustedTab("about:start");
  gBrowser.selectedTab = tab;
  for (let i = 0; i < 100 && tab.linkedBrowser.currentURI.spec != "about:start"; i++) {
    await new Promise(r => setTimeout(r, 50));
  }
  let remote = tab.linkedBrowser.remoteType;
  results.push(
    `${ok(tab.linkedBrowser.currentURI.spec == "about:start" && remote == "privilegedabout")} without neeko.pages.path, the bundled start page loads (${remote})`
  );
} else {
  results.push(
    `${ok(BROWSER_NEW_TAB_URL == "about:newtab")} without a start page, the New Tab page stays Firefox's (${BROWSER_NEW_TAB_URL})`
  );
  let win = OpenBrowserWindow({ private: true });
  for (let i = 0; i < 200 && !win.gBrowserInit?.delayedStartupFinished; i++) {
    await new Promise(r => setTimeout(r, 50));
  }
  let first = win.gBrowser?.selectedBrowser.currentURI.spec;
  win.close();
  results.push(
    `${ok(first == "about:privatebrowsing")} and so is a private window's first page (${first})`
  );
}
// And the app's own helpers inside it: the demo app's answers.
let { NeekoHelpers } = ChromeUtils.importESModule("moz-src:///browser/neeko/NeekoHelpers.sys.mjs");
let helpers = await NeekoHelpers.list();
if (helpers.some(h => h.name == "hello")) {
  let neeko = frame.contentWindow.neeko;
  let text = await (await neeko.helper.fetch("hello", "/hello")).text().catch(e => e.message);
  results.push(`${ok(text.includes("event: caller"))} the build's own helper answers (${text.slice(0, 40)}...)`);
  await neeko.helper.stop("hello");
} else {
  results.push(`ok   the build's helpers: ${JSON.stringify(helpers)}`);
}
return results;
"""


# The containers of the containers check's launch (browser.json's
# "containers", as tools/app.ts writes them into a pref). The others run
# without any.
TEST_CONTAINERS = [
    {"id": "personal", "name": "Personal", "color": "#0ea5e9", "default": True},
    {"id": "work", "name": "Work", "color": "#10b981"},
    {"id": "private", "name": "Private", "color": "#8b5cf6", "ephemeral": True},
]
NO_CONTAINERS = {"neeko.containers.builtin": "[]"}


# The menus the test app keeps (browser.json's "menus", as tools/app.ts
# writes them into the neeko.menus pref).
TEST_MENUS = {
    "menubar": {"file": ["newTab", "closeTab"], "edit": True, "window": True},
    "context": ["back", "forward", "reload", "stop", "openLinkInTab", "copyLink", "copy"],
}


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
    # Find in page paints every match it highlights in this color, which the
    # checks look for.
    "ui.textHighlightBackground": "#ff0000",
}


# In the browser's environment, where helpers must never see it: they get
# only what Neeko gives them.
LEAK = "NEEKO_TEST_LEAK"


def launch(binary, profile, prefs, env=None):
    with open(os.path.join(profile, "user.js"), "w") as f:
        for name, value in prefs.items():
            f.write(f"user_pref({json.dumps(name)}, {json.dumps(value)});\n")
    return subprocess.Popen(
        [*binary, "-no-remote", "-marionette", "-remote-allow-system-access",
         "-profile", profile],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env={**(launch_env() or os.environ), LEAK: "1", **(env or {})},
    )


def test_keychain():
    """A keychain of the test's own, so secrets never touch the user's: on
    macOS a keychain file, left out of the user's keychain list; on Linux
    libsecret's file backend, with no Secret Service (no D-Bus, no keyring
    prompt). Outside the profile, whose files the checks look through.
    Returns (prefs, env, cleanup)."""
    folder = tempfile.mkdtemp(prefix="neeko-keychain-")
    if sys.platform == "darwin":
        path = os.path.join(folder, "test.keychain-db")
        listed = subprocess.run(
            ["security", "list-keychains", "-d", "user"], capture_output=True, text=True
        ).stdout.split()
        subprocess.run(["security", "create-keychain", "-p", "neeko-test", path], check=True)
        # create-keychain lists it with the user's: put their list back.
        subprocess.run(
            ["security", "list-keychains", "-d", "user", "-s", *[k.strip('"') for k in listed]],
            check=True,
        )
        # No locking after a while, which would ask for its password.
        subprocess.run(["security", "set-keychain-settings", path], check=True)
        def cleanup():
            subprocess.run(["security", "delete-keychain", path], capture_output=True)
            shutil.rmtree(folder, ignore_errors=True)

        return {"neeko.secrets.keychain": path}, {}, cleanup
    env = {
        "SECRET_BACKEND": "file",
        "SECRET_FILE_TEST_PATH": os.path.join(folder, "test-keyring"),
        "SECRET_FILE_TEST_PASSWORD": "neeko-test",
    }
    return {}, env, lambda: shutil.rmtree(folder, ignore_errors=True)


def run_in(binary, prefs, script, timeout=120000):
    """Launches with a fresh profile, runs a script in the browser window,
    quits, and returns the script's lines of results. Given a list of
    scripts, runs each in a launch of its own, of the same profile, quitting
    normally in between, as a user would."""
    profile = tempfile.mkdtemp(prefix="neeko-api-test-")
    ui = os.path.join(profile, "test-ui")
    os.mkdir(ui)
    with open(os.path.join(ui, "index.html"), "w") as f:
        f.write(TEST_UI)
    prefs = {
        # Downloads go into the throwaway profile.
        "browser.download.dir": os.path.join(profile, "downloads"),
        "browser.download.folderList": 2,
        **prefs,
    }
    if prefs.get("neeko.ui.path") == "TEST_UI":
        prefs["neeko.ui.path"] = ui
    env = {}
    cleanup = lambda: None
    if prefs.pop("neeko.secrets.keychain", None) == "TEST_KEYCHAIN":
        keychain_prefs, env, cleanup = test_keychain()
        prefs.update(keychain_prefs)
    if prefs.get("neeko.pages.path") == "TEST_PAGES":
        pages = os.path.realpath(os.path.join(profile, "pages"))
        os.mkdir(pages)
        for name, body in TEST_PAGES.items():
            with open(os.path.join(pages, name), "w") as f:
                f.write(body)
        prefs["neeko.pages.path"] = pages
        # The pages run in a content process: let its sandbox read them, and
        # Neeko's own files, which dev builds link to in src/ (see make run).
        prefs.update(sandbox_reads(os.path.join(ROOT, "src"), pages))
    if prefs.get("neeko.helpers.path") == "TEST_HELPERS":
        # The test's helper as "echo", run by this Python (helpers get a
        # PATH of the system's programs only).
        helpers = os.path.join(profile, "helpers")
        os.mkdir(helpers)
        with open(os.path.join(ROOT, "tools/test_helper.py")) as f:
            source = f.read().split("\n", 1)[1]
        echo = os.path.join(helpers, "echo")
        with open(echo, "w") as f:
            f.write(f"#!{sys.executable}\n{source}")
        os.chmod(echo, 0o755)
        prefs["neeko.helpers.path"] = helpers
    scripts = script if isinstance(script, list) else [script]
    results = []
    browser = None
    try:
        for i, one in enumerate(scripts):
            last = i == len(scripts) - 1
            port = free_port()
            browser = launch(binary, profile, {"marionette.port": port, **prefs}, env)
            m = connect(port, browser)
            m.send("WebDriver:SetTimeouts", {"script": timeout})
            # The whole script is one Marionette command, so its reply can take
            # longer than the socket's usual minute.
            m.sock.settimeout(timeout / 1000 + 30)
            started = time.time()
            ran = m.run(one)
            print(f"(the checks took {time.time() - started:.0f} seconds)")
            results += [f"FAIL {ran}"] if isinstance(ran, str) else ran  # str: it threw
            try:
                m.send("Marionette:Quit", {"flags": ["eForceQuit" if last else "eAttemptQuit"]})
            except (OSError, RuntimeError, ValueError):
                pass
            browser.wait(timeout=60)
            if prefs.get("neeko.helpers.path"):
                # Helpers go with the browser.
                time.sleep(0.5)
                left = subprocess.run(
                    ["pgrep", "-f", os.path.join(prefs["neeko.helpers.path"], "")],
                    capture_output=True, text=True,
                ).stdout.split()
                results.append(
                    f"{'FAIL' if left else 'ok  '} no helper runs once the browser has quit ({left})"
                )
    finally:
        if browser and browser.poll() is None:
            browser.kill()
        cleanup()
        shutil.rmtree(profile, ignore_errors=True)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--app", help="a .app (on Linux, the program's folder) to test (default: the dev build)"
    )
    args = parser.parse_args()
    app = os.path.abspath(args.app) if args.app else dev_app()
    binary = command(app)

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Pages)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with open(os.path.join(ROOT, "tools/test_api.js")) as f:
            script = f.read().replace("__BASE__", base)
            script = script.replace("__SLOW_SIZE__", str(SLOW_SIZE))
            script = script.replace("__CLOSED__", f"http://127.0.0.1:{free_port()}")
        with LeaveNoTrace(app):
            prefs = {
                "neeko.ui.path": "TEST_UI",
                "neeko.pages.path": "TEST_PAGES",
                "neeko.helpers.path": "TEST_HELPERS",
                "neeko.secrets.keychain": "TEST_KEYCHAIN",
                "neeko.menus": json.dumps(TEST_MENUS),
                **NO_CONTAINERS,
                **FIREFOX_PREFS,
            }
            results = run_in(binary, prefs, script, timeout=300000)
            # Containers change how every window starts, so they get a
            # launch of their own.
            with open(os.path.join(ROOT, "tools/test_containers.js")) as f:
                containers_script = f.read().replace("__BASE__", base)
            containers_prefs = {
                "neeko.ui.path": "TEST_UI",
                "neeko.pages.path": "TEST_PAGES",
                "neeko.helpers.path": "TEST_HELPERS",
                "neeko.containers.builtin": json.dumps(TEST_CONTAINERS),
                **FIREFOX_PREFS,
            }
            results += run_in(binary, containers_prefs, containers_script, timeout=180000)
            # And across launches of one profile, quitting normally between,
            # with Neeko's own defaults: none of Marionette's recommended prefs
            # (they turn off some of Firefox's startup bars), just the ones
            # that would get in the way: the default browser check's dialog,
            # and the app's first-run and What's New pages (an app's
            # branding/prefs.js may have them), which open when a container
            # is picked, instead of the New Tab page.
            with open(os.path.join(ROOT, "tools/test_relaunch.js")) as f:
                relaunch_script = f.read().replace("__BASE__", base)
            relaunch_prefs = {
                **containers_prefs,
                "remote.prefs.recommended": False,
                "browser.shell.checkDefaultBrowser": False,
                "startup.homepage_welcome_url": "",
                "startup.homepage_welcome_url.additional": "",
                "browser.startup.homepage_override.mstone": "ignore",
            }
            results += run_in(
                binary,
                relaunch_prefs,
                [relaunch_script.replace("__LAUNCH__", str(n)) for n in (1, 2, 3)],
                timeout=60000,
            )
            # A dev build's content processes need to read Neeko's own files,
            # which it links to in src/ (see make run); packaged ones don't.
            bundled_prefs = {**NO_CONTAINERS}
            if not args.app:
                bundled_prefs.update(sandbox_reads(os.path.join(ROOT, "src")))
            results += run_in(binary, bundled_prefs, BUNDLED_CHECK, timeout=30000)
    finally:
        server.shutdown()
    print("\n".join(results))

    failed = [r for r in results if not r.startswith("ok")]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
