"""Where the browser builds are, for the test tools.

- The dev build: `make build` puts it in engine/obj-<platform>/dist/, named
  after the app (Neeko.app for Neeko's demo app).
- A release: `make release` builds in engine/obj-release and copies the
  packaged app into the app's dist/ folder. Test it by passing its path.
"""

import glob
import os
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
