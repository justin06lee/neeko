"""Where the browser builds are, for the test tools.

- The dev build: `make build` puts it in engine/obj-<platform>/dist/, named
  after the app (Neeko.app for Neeko's demo app).
- A release: `make release` builds in engine/obj-release and copies the
  packaged app into the app's dist/ folder. Test it by passing its path.
"""

import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def dev_app():
    """The dev build's .app, or exit with a hint if there isn't one."""
    apps = [
        app
        for app in glob.glob(os.path.join(ROOT, "engine/obj-*/dist/*.app"))
        if "/obj-release/" not in app
    ]
    if not apps:
        sys.exit("No dev build found. Run `make build` first.")
    # After a rename (a new app name) the old bundle can linger; use the newest.
    return max(apps, key=os.path.getmtime)


def program(app):
    """The program inside a .app bundle."""
    path = os.path.join(app, "Contents/MacOS/firefox")
    if not os.path.exists(path):
        sys.exit(f"{app} doesn't look like a Neeko build (no Contents/MacOS/firefox).")
    return path


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
