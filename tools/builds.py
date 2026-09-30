"""Where the browser builds are, for the test tools.

- The dev build: `make build` puts it in engine/obj-<platform>/dist/: on
  macOS a .app named after the app (Neeko.app for Neeko's demo app), on Linux
  the dist/bin folder.
- A release: `make release` builds in engine/obj-release and copies the
  packaged app into the app's dist/ folder. Test it by passing its path: a
  .app on macOS, on Linux the folder with the program in it (an installed
  app's, say: ~/.local/share/<name>/app).
"""

import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LINUX = sys.platform.startswith("linux")


def dev_app():
    """The dev build (its .app, or on Linux its folder), or exit with a hint
    if there isn't one."""
    pattern = "engine/obj-*/dist/bin" if LINUX else "engine/obj-*/dist/*.app"
    apps = [
        app
        for app in glob.glob(os.path.join(ROOT, pattern))
        if "/obj-release/" not in app
    ]
    if not apps:
        sys.exit("No dev build found. Run `make build` first.")
    # After a rename (a new app name) the old bundle can linger; use the newest.
    return max(apps, key=os.path.getmtime)


def program(app):
    """The program in a build: inside a .app bundle, or on Linux in the
    folder."""
    inside = "firefox" if LINUX else "Contents/MacOS/firefox"
    path = os.path.join(app, inside)
    if not os.path.exists(path):
        sys.exit(f"{app} doesn't look like a Neeko build (no {inside}).")
    return path


def command(app):
    """How to start a build: its program, and for an app installed on Linux
    (make install), the app's application.ini, as its launcher does."""
    ini = os.path.join(app, "browser/application.ini")
    return [program(app), *(["-app", ini] if LINUX and os.path.exists(ini) else [])]


def launch_env():
    """The environment to launch a build in. On Linux, without the crash
    reporter, as `mach run` does (an installed app has none)."""
    return {**os.environ, "MOZ_CRASHREPORTER_DISABLE": "1"} if LINUX else None


def sandbox_reads(*folders):
    """The prefs that let content processes read these folders too (a dev
    build's src/, which it links to, and pages outside the app). Each system's
    sandbox has its own: on Linux one list, folders ending in a slash."""
    folders = [os.path.realpath(folder) for folder in folders]
    if LINUX:
        return {
            "security.sandbox.content.read_path_whitelist":
                ",".join(folder + "/" for folder in folders),
        }
    return {
        f"security.sandbox.content.mac.testing_read_path{i}": folder
        for i, folder in enumerate(folders, 1)
    }


class LeaveNoTrace:
    """Removes the empty folders a release build creates in the user's
    Library when it starts (~/Library/Application Support/<name> and
    ~/Library/Caches/<name>), even with a throwaway -profile. Only folders
    that didn't exist before, and only while empty: a real profile in them is
    never touched. Dev builds use Firefox's own folders, which are left alone.
    """

    def __init__(self, app):
        ini = os.path.join(app, "Contents/Resources/application.ini")
        name = None
        if os.path.exists(ini):
            with open(ini) as f:
                match = re.search(r"^Name=(.+)$", f.read(), re.M)
                name = match and match.group(1).strip()
        library = os.path.expanduser("~/Library")
        self.folders = [] if not name or name == "Firefox" else [
            os.path.join(library, "Application Support", name),
            os.path.join(library, "Caches", name),
        ]
        self.new = [f for f in self.folders if not os.path.exists(f)]

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        for folder in self.new:
            for dirpath, dirnames, filenames in os.walk(folder, topdown=False):
                if not filenames and not os.listdir(dirpath):
                    os.rmdir(dirpath)
