"""Check `make wipe`: that it deletes all of an app's data, and only its own,
never Firefox's, never while the app runs, and only after asking.

    python3 tools/test_wipe.py

Needs no build. It wipes a made-up app (WipeTest) in a throwaway home: HOME
and the XDG folders point into a temporary folder holding the app's data
and Firefox's, as on macOS or Linux, whichever this is. The dev build's
profile is the one in engine/obj-*/, so the test adds two made-up builds
there for the time it runs: one of the app's, one of another's.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from builds import ROOT  # noqa: E402

MACOS = sys.platform == "darwin"
NAME, APP_ID = "WipeTest", "dev.neeko.wipetest"

results = []


def check(ok, what):
    results.append(f"{'ok  ' if ok else 'FAIL'} {what}")


def touch(path, contents="x"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(contents)


def main():
    # In /tmp: macOS's preferences daemon writes nothing in the per-user
    # temporary folder.
    work = tempfile.mkdtemp(prefix="neeko-wipe-test-", dir="/tmp")
    home = os.path.join(work, "home")
    env = {
        **os.environ,
        "HOME": home,
        "XDG_CONFIG_HOME": os.path.join(home, ".config"),
        "XDG_CACHE_HOME": os.path.join(home, ".cache"),
    }

    def app_folder(name, app_id):
        folder = os.path.join(work, f"app-{name}-{app_id}")
        touch(
            os.path.join(folder, "browser.json"),
            json.dumps({"name": name, "vendor": "Neeko", "appId": app_id, "version": "1.0.0"}),
        )
        return folder

    def wipe(folder, *args, make=False):
        command = (
            ["make", "-s", "-C", ROOT, "wipe", f"APP={folder}", *args]
            if make
            else ["bun", os.path.join(ROOT, "tools/app.ts"), "wipe", folder, *args]
        )
        return subprocess.run(
            command, env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True
        )

    app = app_folder(NAME, APP_ID)
    if MACOS:
        library = os.path.join(home, "Library")
        prefs = os.path.join(library, "Preferences", f"{APP_ID}.plist")
        # What wipe deletes, and a file in each.
        tops = [
            os.path.join(library, "Application Support", NAME),
            os.path.join(library, "Caches", NAME),
            prefs,
            os.path.join(library, "Saved Application State", f"{APP_ID}.savedState"),
        ]
        ours = [
            os.path.join(tops[0], "profiles.ini"),
            os.path.join(tops[1], "Profiles/x/cache2/entry"),
            prefs,
            os.path.join(tops[3], "data.data"),
        ]
        firefox = [
            os.path.join(library, "Application Support/Firefox/profiles.ini"),
            os.path.join(library, "Application Support/Mozilla/NativeMessagingHosts/x.json"),
            os.path.join(library, "Caches/Firefox/Profiles/x/cache2/entry"),
            os.path.join(library, "Preferences/org.mozilla.firefox.plist"),
        ]
    else:
        prefs = None
        name = NAME.lower()
        tops = [
            os.path.join(home, ".config/mozilla", name),
            os.path.join(home, ".cache/mozilla", name),
            os.path.join(home, ".mozilla", name),
        ]
        ours = [
            os.path.join(tops[0], "profiles.ini"),
            os.path.join(tops[1], "x/cache2/entry"),
            os.path.join(tops[2], "profiles.ini"),
        ]
        firefox = [
            os.path.join(home, ".config/mozilla/firefox/profiles.ini"),
            os.path.join(home, ".cache/mozilla/firefox/x/cache2/entry"),
            os.path.join(home, ".mozilla/firefox/profiles.ini"),
        ]
    # Made-up dev builds, the app's and another app's, with mach run's profile.
    builds = [os.path.join(ROOT, "engine", f"obj-neeko-wipe-test-{n}") for n in (1, 2)]
    for build, built in zip(builds, (NAME, "Other")):
        touch(os.path.join(build, "dist/bin/application.ini"), f"[App]\nName={built}\n")
        touch(os.path.join(build, "tmp/profile-default/prefs.js"))
    dev_profile, other_profile = (os.path.join(b, "tmp/profile-default") for b in builds)
    tops.append(dev_profile)
    ours.append(os.path.join(dev_profile, "prefs.js"))

    sleeper = None
    try:
        for path in ours + firefox:
            if path == prefs:
                # Through cfprefsd, as the app would, so it has them cached.
                os.makedirs(os.path.dirname(path), exist_ok=True)
                subprocess.run(["defaults", "write", path[: -len(".plist")], "Key", "value"], check=True)
            else:
                touch(path)
        everything = lambda paths: all(os.path.exists(p) for p in paths)  # noqa: E731
        firefox_untouched = lambda: everything(firefox)  # noqa: E731

        # Firefox's names and ids are refused, whatever is there.
        for name, app_id in (("Firefox", APP_ID), ("mozilla", APP_ID), (NAME, "org.mozilla.firefox")):
            refused = wipe(app_folder(name, app_id), "--yes")
            check(
                refused.returncode != 0 and "can't be Firefox's" in refused.stderr
                and firefox_untouched() and everything(ours),
                f"refuses an app named {name} ({app_id}), and deletes nothing",
            )

        # Not while the app runs: its dev build (a program in its
        # engine/obj-*/dist/, as far as the process list says), or on Linux
        # the installed app.
        programs = [os.path.join(builds[0], "dist/sleep")]
        if not MACOS:
            programs.append(os.path.join(home, ".local/share", NAME.lower(), "app/firefox"))
        for program in programs:
            sleeper = subprocess.Popen([program, "60"], executable="/bin/sleep")
            running = wipe(app, "--yes")
            check(
                running.returncode != 0 and "is running" in running.stderr and everything(ours),
                f"refuses while {os.path.relpath(program, work if program.startswith(work) else ROOT)} runs",
            )
            sleeper.kill()
            sleeper.wait()
            sleeper = None

        # It asks first; with nobody to answer, nothing goes.
        asked = wipe(app, make=True)
        check(
            asked.returncode == 0 and "Delete it?" in asked.stdout and "nothing deleted" in asked.stdout
            and everything(ours),
            "make wipe asks first, and deletes nothing unanswered",
        )
        unlisted = [p for p in tops if f"  {p}\n" not in asked.stdout]
        check(not unlisted, f"it lists what it would delete{unlisted and f' (not: {unlisted})' or ''}")

        wiped = wipe(app, "YES=1", make=True)
        left = [p for p in ours if os.path.exists(p)]
        check(wiped.returncode == 0 and not left, f"make wipe YES=1 deletes all of the app's data{left and f' (left: {left})' or ''}")
        check(not any(os.path.exists(p) for p in tops), "its folders too, the dev build's profile included")
        if MACOS:
            cached = subprocess.run(
                ["defaults", "read", prefs[: -len(".plist")]], capture_output=True, text=True
            )
            check(cached.returncode != 0, "and macOS's preferences cache forgets it")
        check(firefox_untouched(), "Firefox's data stays")
        check(os.path.exists(other_profile), "and so does another app's dev build profile")

        again = wipe(app, "--yes")
        check(again.returncode == 0 and "no data" in again.stdout, "with nothing left, it says so")
    finally:
        if sleeper:
            sleeper.kill()
        for build in builds:
            shutil.rmtree(build, ignore_errors=True)
        shutil.rmtree(work, ignore_errors=True)

    print("\n".join(results))
    failed = [r for r in results if not r.startswith("ok")]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
