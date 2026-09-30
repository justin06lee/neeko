"""The privacy test: proves a build contacts no telemetry or tracking
endpoint, from its very first launch.

    make build
    python3 tools/test_privacy.py                    # about 6 minutes
    python3 tools/test_privacy.py --idle 60 --browse 20
    python3 tools/test_privacy.py --pref network.captive-portal-service.enabled=true
    python3 tools/test_privacy.py --app dist/Neeko.app   # a packaged release

1. Starts mitmproxy (through uvx, nothing to install) with a fresh
   certificate, and trusts it in a brand-new profile, so every request's
   full URL is visible.
2. First launch: the dev build (or --app) with the UI its build bundled,
   left idle, then quit normally (quitting is when shutdown pings would go
   out).
3. Second launch: the same profile opens a few ordinary websites.
4. With the proxy gone, a last launch checks that about:telemetry and
   about:glean say upload is disabled, and that no ping is waiting to be
   sent.

It lists every host contacted and FAILS if:
- any request goes to an endpoint Neeko turns off (docs/privacy/decisions.md);
- anything but the expected security traffic shows up while the browser
  idles (new Firefox versions add new services; this catches them);
- any of the browser's processes connects somewhere without the proxy;
- upload isn't disabled, or pings are waiting to be sent.

Marionette is only used to quit and for the last check, with
remote.prefs.recommended=false so it changes no prefs. Otherwise it would
turn off exactly what's being tested.
"""

import argparse
import glob
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from builds import LINUX, ROOT, LeaveNoTrace, command, dev_app, launch_env, program, sandbox_reads  # noqa: E402
from marionette import Marionette  # noqa: E402

MITMPROXY = "mitmproxy==12.2.3"

# Endpoints Neeko turns off, by host (or host and path), with their rows in
# docs/privacy/inventory.md. Any request to one of these fails the test.
BLOCKED = {
    "incoming.telemetry.mozilla.org": "#1-4 telemetry",
    "crash-reports.mozilla.com": "#5 crash reports",
    "normandy.cdn.mozilla.net": "#6 studies",
    "classify-client.services.mozilla.com": "#6 studies",
    "dap-09-3.api.divviup.org": "#7 DAP",
    "dap.services.mozilla.com": "#7 DAP",
    "mozilla-ohttp-dap.mozilla.fastly-edge.com": "#7 DAP relay",
    "services.addons.mozilla.org": "#9, #35 add-on recommendations and metadata",
    "transcend-cdn.com": "#11 first-run consent script",
    "ads.mozilla.org": "#12 sponsored shortcuts",
    "ads-img.mozilla.org": "#12 sponsored shortcuts",
    "contile.services.mozilla.com": "#12 sponsored shortcuts",
    "topsites.services.mozilla.com": "#12 sponsored shortcuts",
    "merino.services.mozilla.com": "#13-16 stories, weather, Suggest",
    "ohttp-gateway-merino.services.mozilla.com": "#13-16 relay",
    "ohttp-merino.mozilla.fastly-edge.com": "#13-16 relay",
    "mozilla-ohttp.fastly-edge.com": "#13-16 relay",
    "prod.ohttp-gateway.prod.webservices.mozgcp.net": "#13-16 relay",
    "prod-images.merino.prod.webservices.mozgcp.net": "#13 story images",
    "img-getpocket.cdn.mozilla.net": "#13 story images",
    "getpocket.cdn.mozilla.net": "#13 stories",
    "firefox-api-proxy.cdn.mozilla.net": "#13 stories",
    "spocs.getpocket.com": "#13 sponsored stories",
    "location.services.mozilla.com": "#17 region detection",
    "firefox-portal-detection.com": "#19-20 captive portal and connectivity",
    "mozilla.cloudflare-dns.com": "#21 DNS-over-HTTPS rollout",
    "push.services.mozilla.com": "#22 push",
    "safebrowsing.googleapis.com": "#28 Safe Browsing",
    "safebrowsing.google.com": "#28 Safe Browsing",
    "sb-ssl.google.com": "#29 download protection",
    "aus5.mozilla.org": "#33, #36, #37 update and plugin checks",
    "update.googleapis.com": "#37 Widevine download",
    "ciscobinary.openh264.org": "#37 OpenH264 download",
    "model-hub.mozilla.org": "#41 AI models",
    "accounts.firefox.com": "#42 accounts",
    "api.accounts.firefox.com": "#42 accounts",
    "token.services.mozilla.com": "#42 Sync",
    "relay.firefox.com": "#42 Relay",
}

# What an idle browser may contact: the security features Neeko keeps.
EXPECTED = {
    "firefox.settings.services.mozilla.com": "#25 Remote Settings",
    "firefox-settings-attachments.cdn.mozilla.net": "#25 Remote Settings files",
    "content-signature-2.cdn.mozilla.net": "#25 Remote Settings signatures",
    "shavar.services.mozilla.com": "#30 tracking-protection lists",
    "mitmdetection.services.mozilla.com": "#32 man-in-the-middle detection",
    "versioncheck.addons.mozilla.org": "#34 add-on updates",
    "versioncheck-bg.addons.mozilla.org": "#34 add-on updates",
}
EXPECTED_SUFFIXES = {".mozilla-backup.org": "#24 backup-domain fallback"}

# Ordinary websites for the second launch. None of them is on either list.
SITES = [
    "https://en.wikipedia.org/wiki/Chameleon",
    "https://example.com/",
    "https://www.rust-lang.org/",
]

# Remote Settings collections, from the sync requests and the file downloads.
REMOTE_SETTINGS_COLLECTION = re.compile(
    r"settings\.services\.mozilla\.com/v\d/buckets/([^/]+)/collections/([^/?]+)"
    r"|settings-attachments\.cdn\.mozilla\.net/([^/]+?)(?:-workspace)?/([^/]+)/"
)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for(test, timeout, what):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if test():
            return
        time.sleep(0.25)
    sys.exit(f"Timed out waiting for {what}.")


def blocked_reason(host, url):
    for key, reason in BLOCKED.items():
        if "/" in key:
            if url.split("://", 1)[-1].startswith(key):
                return reason
        elif host == key:
            return reason
    return None


def expected_reason(host):
    if host in EXPECTED:
        return EXPECTED[host]
    for suffix, reason in EXPECTED_SUFFIXES.items():
        if host.endswith(suffix):
            return reason
    return None


class DirectConnectionWatch(threading.Thread):
    """Polls lsof for connections from the app's processes that don't go
    to the proxy (or anywhere else on this machine)."""

    def __init__(self, app_dir):
        super().__init__(daemon=True)
        self.app_dir = app_dir
        self.found = set()
        self.running = True

    def pids(self):
        out = subprocess.run(
            ["pgrep", "-f", f"^{re.escape(self.app_dir)}/"],
            capture_output=True, text=True,
        ).stdout
        return [p for p in out.split() if p]

    def run(self):
        while self.running:
            pids = self.pids()
            if pids:
                out = subprocess.run(
                    ["lsof", "-nP", "-i", "-a", "-p", ",".join(pids)],
                    capture_output=True, text=True,
                ).stdout
                for line in out.splitlines()[1:]:
                    name = line.split()[-2] if line.endswith(")") else line.split()[-1]
                    if "->" not in name:
                        continue
                    remote = name.split("->", 1)[1]
                    if remote.startswith(("127.0.0.1:", "[::1]:", "localhost:")):
                        continue
                    self.found.add(f"{line.split()[0]} -> {remote}")
            time.sleep(1)


def launch(cmd, profile, urls=()):
    return subprocess.Popen(
        [*cmd, "-no-remote", "-marionette", "-remote-allow-system-access",
         "-profile", profile, *urls],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        env=launch_env(),
    )


def connect(port, browser, timeout=60):
    deadline = time.time() + timeout
    while True:
        try:
            return Marionette(port)
        except OSError:
            if browser.poll() is not None or time.time() > deadline:
                raise
            time.sleep(0.5)


def quit_normally(m, browser):
    try:
        m.send("Marionette:Quit", {"flags": ["eAttemptQuit"]})
    except (OSError, RuntimeError, ValueError):
        pass
    try:
        browser.wait(timeout=60)
    except subprocess.TimeoutExpired:
        browser.kill()
        return False
    return True


# The last check, in the browser window: what about:telemetry and about:glean
# show, read from the pages themselves.
FINAL_CHECK = """
await new Promise(r => setTimeout(r, 2000));
let pages = {};
// Each page fills in its status some time after loading (about:glean's
// placeholder says "enabled"), so wait for a sign it has: about:telemetry's
// sentence only appears once computed, and about:glean shows the pref's value
// when it sets the status.
let checks = [
  ["about:telemetry", /upload is (enabled|disabled)/i, /upload is/i],
  ["about:glean", /uploadEnabled: (true|false)/, /^Data upload is/],
];
for (let [url, ready, status] of checks) {
  let tab = gBrowser.addTrustedTab(url);
  gBrowser.selectedTab = tab;
  let lines = [];
  for (let i = 0; i < 80 && !lines.some(l => ready.test(l)); i++) {
    await new Promise(r => setTimeout(r, 250));
    let text = tab.linkedBrowser.contentDocument?.body?.innerText ?? "";
    lines = text.split("\\n").map(l => l.trim());
  }
  await new Promise(r => setTimeout(r, 500));
  let text = tab.linkedBrowser.contentDocument?.body?.innerText ?? "";
  pages[url] = text.split("\\n").map(l => l.trim()).find(l => status.test(l)) ?? "";
}
let { TelemetrySend } = ChromeUtils.importESModule(
  "resource://gre/modules/TelemetrySend.sys.mjs"
);
return {
  pages,
  telemetrySending: TelemetrySend.sendingEnabled(),
  telemetryPending: TelemetrySend.pendingPingCount,
};
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--idle", type=int, default=240, help="seconds idle on first launch")
    parser.add_argument("--browse", type=int, default=60, help="seconds on the websites")
    parser.add_argument("--keep", action="store_true", help="keep the temp folder")
    parser.add_argument(
        "--app", help="a .app (on Linux, the program's folder) to test (default: the dev build)"
    )
    parser.add_argument(
        "--pref", action="append", default=[], metavar="NAME=VALUE",
        help="set a pref for the whole run, e.g. to check the test catches a leak",
    )
    args = parser.parse_args()

    bundle = os.path.abspath(args.app) if args.app else dev_app()
    tidy = LeaveNoTrace(bundle)
    app = program(bundle)
    cmd = command(bundle)
    app_dir = os.path.dirname(app)
    # Packaged apps don't ship NSS's certutil; the dev build's is the same
    # version.
    certutil = os.path.join(app_dir, "certutil")
    if not os.path.exists(certutil):
        certutil = os.path.join(os.path.dirname(program(dev_app())), "certutil")

    work = tempfile.mkdtemp(prefix="neeko-privacy-test-")
    profile = os.path.join(work, "profile")
    confdir = os.path.join(work, "mitmproxy")
    log_path = os.path.join(work, "connections.jsonl")
    os.mkdir(profile)
    proxy_port, marionette_port = free_port(), free_port()

    print(f"Working in {work}")
    proxy = subprocess.Popen(
        ["uvx", "--from", MITMPROXY, "mitmdump",
         "--listen-host", "127.0.0.1", "--listen-port", str(proxy_port),
         "--set", f"confdir={confdir}", "--quiet",
         "-s", os.path.join(ROOT, "tools/privacy_proxy.py")],
        env={**os.environ, "NEEKO_PRIVACY_LOG": log_path},
        stdout=subprocess.DEVNULL, stderr=open(os.path.join(work, "mitmdump.log"), "w"),
    )
    browser = None
    watch = DirectConnectionWatch(app_dir)
    phases = {}
    try:
        ca = os.path.join(confdir, "mitmproxy-ca-cert.pem")
        wait_for(lambda: os.path.exists(ca), 120, "mitmproxy's certificate")
        wait_for(lambda: socket.socket().connect_ex(("127.0.0.1", proxy_port)) == 0,
                 60, "mitmproxy to listen")

        # A brand-new profile that trusts the proxy's certificate and sends
        # everything through the proxy. Nothing else is set but what the
        # test needs: the test is of Neeko's defaults.
        # On Linux certutil needs the build's own NSS, next to it, not the
        # system's.
        certutil_env = {**os.environ, "LD_LIBRARY_PATH": os.path.dirname(certutil)} if LINUX else None
        subprocess.run([certutil, "-N", "-d", f"sql:{profile}", "--empty-password"],
                       check=True, env=certutil_env)
        subprocess.run([certutil, "-A", "-n", "neeko privacy test", "-t", "C,,",
                        "-i", ca, "-d", f"sql:{profile}"], check=True, env=certutil_env)
        with open(os.path.join(profile, "user.js"), "w") as f:
            for name, value in [
                ("network.proxy.type", 1),
                ("network.proxy.http", "127.0.0.1"),
                ("network.proxy.http_port", proxy_port),
                ("network.proxy.ssl", "127.0.0.1"),
                ("network.proxy.ssl_port", proxy_port),
                ("network.proxy.share_proxy_settings", True),
                ("network.proxy.no_proxies_on", ""),
                ("network.proxy.failover_direct", False),
                ("marionette.port", marionette_port),
                ("remote.prefs.recommended", False),
                # An app's containers make a new window wait for its UI to
                # pick one, which nobody does here, so the websites the test
                # opens would never load. They make no connections.
                ("neeko.containers.builtin", "[]"),
                # A dev build's content processes need to read Neeko's own
                # files, which it links to in src/, for the app's start page
                # (see make run). Packaged builds carry them inside the app.
                *([] if args.app else sandbox_reads(os.path.join(ROOT, "src")).items()),
                *[(p.split("=", 1)[0], json.loads(p.split("=", 1)[1])) for p in args.pref],
            ]:
                f.write(f"user_pref({json.dumps(name)}, {json.dumps(value)});\n")

        watch.start()

        # First launch, idle, then quit normally.
        print(f"First launch, idle for {args.idle} seconds...")
        start = time.time()
        browser = launch(cmd, profile)
        time.sleep(args.idle)
        clean = quit_normally(connect(marionette_port, browser), browser)
        time.sleep(5)  # anything sent at or after quitting
        phases["idle"] = (start, time.time())
        print("  quit normally" if clean else "  had to be killed")

        # Second launch: a few ordinary websites.
        print(f"Second launch, on {len(SITES)} websites for {args.browse} seconds...")
        start = time.time()
        browser = launch(cmd, profile, SITES)
        time.sleep(args.browse)
        quit_normally(connect(marionette_port, browser), browser)
        time.sleep(5)
        phases["browse"] = (start, time.time())

        # Last launch, with the proxy gone, so nothing can leave: read what
        # about:telemetry and about:glean say.
        proxy.terminate()
        proxy.wait(timeout=30)
        print("Checking about:telemetry and about:glean...")
        browser = launch(cmd, profile)
        m = connect(marionette_port, browser)
        m.send("WebDriver:SetTimeouts", {"script": 60000})
        final = m.run(FINAL_CHECK)
        if not isinstance(final, dict):
            final = {"pages": {"about pages": f"(check failed: {final})"},
                     "telemetrySending": True, "telemetryPending": -1}
        quit_normally(m, browser)
        watch.running = False
        watch.join(timeout=5)
    finally:
        watch.running = False
        if browser and browser.poll() is None:
            browser.kill()
        if proxy.poll() is None:
            proxy.terminate()
        tidy.__exit__()

    # What was contacted, by phase.
    events = []
    if os.path.exists(log_path):
        with open(log_path) as f:
            events = [json.loads(line) for line in f if line.strip()]

    failures = []
    report = []
    collections = set()
    for phase, (start, end) in phases.items():
        hosts = {}
        for e in events:
            if start <= e["t"] <= end and e["host"]:
                hosts.setdefault(e["host"], []).append(e)
        report.append(f"\n{phase.upper()} ({len(hosts)} hosts)")
        for host in sorted(hosts):
            urls = [e["url"] for e in hosts[host] if e["url"]]
            for url in urls:
                match = REMOTE_SETTINGS_COLLECTION.search(url)
                if match:
                    bucket, name = [g for g in match.groups() if g]
                    if (bucket, name) != ("monitor", "changes"):
                        collections.add(f"{bucket}/{name}")
            reason = next(filter(None, (blocked_reason(host, u) for u in urls or [""])), None)
            if reason:
                verdict = f"FAIL  turned off by Neeko ({reason})"
                failures.append(f"{host}: {reason}")
            elif expected_reason(host):
                verdict = f"ok    kept ({expected_reason(host)})"
            elif phase == "browse":
                verdict = "ok    website traffic"
            else:
                verdict = "FAIL  unexpected while idle: find out what this is"
                failures.append(f"{host}: unexpected while idle")
            report.append(f"  {verdict:60} {host}  x{len(hosts[host])}")

    report.append("\nDIRECT CONNECTIONS (not through the proxy)")
    if watch.found:
        for c in sorted(watch.found):
            report.append(f"  FAIL  {c}")
            failures.append(f"direct connection: {c}")
    else:
        report.append("  ok    none")

    report.append("\nUPLOAD STATUS")
    # Exactly these; about:glean also has a "disabled, but we're lying to the
    # SDK" message that means upload is really on.
    upload_off = {
        "about:telemetry": re.compile(r"upload is disabled\.?$"),
        "about:glean": re.compile(r"^Data upload is disabled\.$"),
    }
    for page, line in final["pages"].items():
        ok = bool(upload_off.get(page, re.compile("$^")).search(line))
        report.append(f"  {'ok  ' if ok else 'FAIL'}  {page}: {line or '(not found)'}")
        if not ok:
            failures.append(f"{page} doesn't say upload is disabled")
    if final["telemetrySending"] or final["telemetryPending"]:
        failures.append("legacy telemetry would send, or has pings waiting")
    report.append(
        f"  {'FAIL' if final['telemetryPending'] else 'ok  '}  "
        f"pings waiting to be sent: {final['telemetryPending']}"
    )
    glean_pending = glob.glob(os.path.join(profile, "datareporting/glean/pending_pings/*"))
    report.append(f"  {'FAIL' if glean_pending else 'ok  '}  Glean pings waiting: {len(glean_pending)}")
    if glean_pending:
        failures.append("Glean has pings waiting to be sent")

    if collections:
        report.append("\nREMOTE SETTINGS COLLECTIONS SYNCED (for information)")
        report.extend(f"  {c}" for c in sorted(collections))

    print("\n".join(report))
    if args.keep:
        print(f"\nKept {work}")
    else:
        shutil.rmtree(work, ignore_errors=True)

    if failures:
        print(f"\nFAILED: {len(failures)} problem(s)")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("\nPASSED: nothing went anywhere Neeko turns off.")


if __name__ == "__main__":
    main()
