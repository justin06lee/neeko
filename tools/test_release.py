"""Check a packaged release (make release) is its own browser, not Firefox.

    make release
    python3 tools/test_release.py                       # dist/<Name>.app here
    python3 tools/test_release.py ../dist/MyBrowser.app # a browser's release
    python3 tools/test_release.py some/Other.app ../   # app folder given

Reads the expected identity from the app folder's browser.json (by default
the folder holding the app's dist/) and Neeko's Firefox pin, launches the
app with a throwaway profile, and checks:

- its program name, and so its profile folder, are the browser's own, not
  Firefox's (~/Library/Application Support/<name>);
- its bundle id, name and versions;
- telemetry upload, the crash reporter and the updater are compiled out;
- Neeko's prefs made it into the package, and the bundled UI loads with the
  API.

Then run tools/test_api.py and tools/test_privacy.py with --app on it too.
"""

import json
import os
import plistlib
import shutil
import socket
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from builds import ROOT, LeaveNoTrace, program  # noqa: E402
from marionette import Marionette  # noqa: E402

CHECK = """
let frame = null;
for (let i = 0; i < 200 && !frame?.contentWindow?.neeko; i++) {
  await new Promise(r => setTimeout(r, 50));
  frame = document.getElementById("neeko-ui");
}
let { AppConstants } = ChromeUtils.importESModule(
  "resource://gre/modules/AppConstants.sys.mjs"
);
let defaults = Services.prefs.getDefaultBranch("");
return {
  name: Services.appinfo.name,
  vendor: Services.appinfo.vendor,
  version: Services.appinfo.version,
  displayVersion: AppConstants.MOZ_APP_VERSION_DISPLAY,
  appData: Services.dirsvc.get("UAppData", Ci.nsIFile).path,
  profile: Services.dirsvc.get("ProfD", Ci.nsIFile).path,
  // Compiled into the core (Telemetry.cpp), unlike AppConstants, which is
  // built locally even in artifact builds.
  telemetry: Services.telemetry.isOfficialTelemetry,
  crashReporter: AppConstants.MOZ_CRASHREPORTER,
  updater: AppConstants.MOZ_UPDATER,
  uploadDefault: defaults.getBoolPref("datareporting.healthreport.uploadEnabled", true),
  uiPathDefault: defaults.getStringPref("neeko.ui.path", "missing"),
  ui: !!frame?.contentWindow?.neeko,
};
"""


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def find_app(argv):
    if len(argv) > 1:
        return os.path.abspath(argv[1])
    dist = os.path.join(ROOT, "dist")
    apps = [a for a in os.listdir(dist) if a.endswith(".app")] if os.path.isdir(dist) else []
    if len(apps) != 1:
        sys.exit("No release in dist/. Run `make release`, or pass the .app to check.")
    return os.path.join(dist, apps[0])


def main():
    app = find_app(sys.argv)
    app_folder = (
        os.path.abspath(sys.argv[2]) if len(sys.argv) > 2
        else os.path.dirname(os.path.dirname(app))
    )
    with open(os.path.join(app_folder, "browser.json")) as f:
        expected = json.load(f)
    with open(os.path.join(ROOT, "neeko.json")) as f:
        firefox = json.load(f)["firefox"]
    with open(os.path.join(app, "Contents/Info.plist"), "rb") as f:
        plist = plistlib.load(f)

    tidy = LeaveNoTrace(app)
    port = free_port()
    profile = tempfile.mkdtemp(prefix="neeko-release-test-")
    with open(os.path.join(profile, "user.js"), "w") as f:
        f.write(f'user_pref("marionette.port", {port});\n')
    browser = subprocess.Popen(
        [program(app), "-no-remote", "-marionette", "-remote-allow-system-access",
         "-profile", profile],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.time() + 60
        while True:
            try:
                m = Marionette(port)
                break
            except OSError:
                if browser.poll() is not None or time.time() > deadline:
                    raise
                time.sleep(0.5)
        m.send("WebDriver:SetTimeouts", {"script": 30000})
        got = m.run(CHECK)
        try:
            m.send("Marionette:Quit", {"flags": ["eForceQuit"]})
        except (OSError, RuntimeError):
            pass
        browser.wait(timeout=30)
    finally:
        if browser.poll() is None:
            browser.kill()
        shutil.rmtree(profile, ignore_errors=True)
        tidy.__exit__()
    if not isinstance(got, dict):
        sys.exit(f"The check itself failed: {got}")

    name = expected["name"]
    display = expected.get("displayName", name)
    home_data = os.path.expanduser("~/Library/Application Support")
    checks = [
        (got["name"] == name, f"program name is {name!r} ({got['name']!r})"),
        (got["appData"] == os.path.join(home_data, name),
         f"profile folder is its own ({got['appData']})"),
        (not got["appData"].endswith("/Firefox"), "profile folder isn't Firefox's"),
        (plist.get("CFBundleIdentifier") == expected["appId"],
         f"bundle id ({plist.get('CFBundleIdentifier')})"),
        (plist.get("CFBundleName") == display, f"bundle name ({plist.get('CFBundleName')})"),
        (got["displayVersion"] == expected["version"],
         f"its own version shows in About ({got['displayVersion']})"),
        (got["version"] == firefox, f"engine version stays Firefox's ({got['version']})"),
        (not got["telemetry"], "telemetry upload compiled out"),
        (not got["crashReporter"], "crash reporter compiled out"),
        (not got["updater"], "updater compiled out"),
        (got["uploadDefault"] is False, "Neeko's privacy prefs are in the package"),
        (got["uiPathDefault"] == "", "Neeko's own prefs are in the package"),
        (got["ui"], "the bundled UI loads with the API"),
    ]
    for ok, what in checks:
        print(f"{'ok  ' if ok else 'FAIL'} {what}")
    print(f"     (vendor {got['vendor']!r}, Firefox's build fixes it)")
    failed = [what for ok, what in checks if not ok]
    print(f"\n{len(checks) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
