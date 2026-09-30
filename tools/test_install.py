"""Check `make install` on Linux: what it puts in place, that it never makes
the browser the default by itself, and that `make uninstall` removes it all
but the profiles.

    make install                     # or make build, then its stage-package
    python3 tools/test_install.py

Installs Neeko's demo app (tools/app.ts install, then uninstall) into a
throwaway home: HOME and the XDG folders point into a temporary folder, with
another browser installed "system-wide" there that nobody chose as the
default, as on a fresh Ubuntu. Needs GLib's gio, as the installer does.
"""

import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from builds import LINUX, ROOT  # noqa: E402

APP_ID = "dev.neeko.demo"
OURS = f"{APP_ID}.desktop"
OTHER = "other-browser.desktop"
MIME_TYPES = [
    "text/html",
    "text/xml",
    "application/xhtml+xml",
    "x-scheme-handler/http",
    "x-scheme-handler/https",
]

results = []


def check(ok, what):
    results.append(f"{'ok  ' if ok else 'FAIL'} {what}")


def main():
    if not LINUX:
        sys.exit("test_install.py checks make install, which is for Linux.")
    if shutil.which("gio") is None:
        sys.exit("test_install.py needs GLib's gio (apt install libglib2.0-bin).")

    work = tempfile.mkdtemp(prefix="neeko-install-test-")
    home = os.path.join(work, "home")
    system = os.path.join(work, "system")
    env = {
        **os.environ,
        "HOME": home,
        "XDG_DATA_HOME": os.path.join(home, ".local/share"),
        "XDG_CONFIG_HOME": os.path.join(home, ".config"),
        "XDG_CACHE_HOME": os.path.join(home, ".cache"),
        "XDG_DATA_DIRS": os.path.join(system, "share"),
        "XDG_CONFIG_DIRS": os.path.join(system, "etc"),
        "LC_ALL": "C",
    }
    data = env["XDG_DATA_HOME"]
    applications = os.path.join(system, "share/applications")
    os.makedirs(applications)
    os.makedirs(env["XDG_CONFIG_DIRS"])
    os.makedirs(env["XDG_CONFIG_HOME"])
    with open(os.path.join(applications, OTHER), "w") as f:
        f.write(
            "[Desktop Entry]\nType=Application\nName=Other Browser\nExec=/bin/true %u\n"
            f"MimeType={';'.join(MIME_TYPES)};\n"
        )
    subprocess.run(["update-desktop-database", applications], env=env, check=False)

    def gio_mime(mime_type):
        return subprocess.run(
            ["gio", "mime", mime_type], env=env, capture_output=True, text=True
        ).stdout

    def default(mime_type):
        for line in gio_mime(mime_type).splitlines():
            if line.startswith("Default application for"):
                return line.rsplit(": ", 1)[1].strip()
        return None

    def app_step(step):
        return subprocess.run(
            ["bun", os.path.join(ROOT, "tools/app.ts"), step, ROOT],
            env=env, capture_output=True, text=True,
        )

    launcher = os.path.join(home, ".local/bin/neeko")
    program = os.path.join(data, "neeko/app")
    desktop = os.path.join(data, "applications", OURS)
    icons = [os.path.join(data, f"icons/hicolor/{s}x{s}/apps/{APP_ID}.png") for s in (16, 256)]
    profiles = os.path.join(env["XDG_CONFIG_HOME"], "mozilla/neeko")
    try:
        check(
            all(default(t) == OTHER for t in MIME_TYPES),
            "before: another browser opens web links and pages, chosen by nobody",
        )

        installed = app_step("install")
        check(
            installed.returncode == 0,
            "installs" + ("" if installed.returncode == 0 else f" ({installed.stderr.strip()[-300:]})"),
        )
        with open(os.path.join(program, "browser/application.ini")) as f:
            ini = f.read()
        check(
            os.access(os.path.join(program, "firefox"), os.X_OK)
            and f"RemotingName={APP_ID}" in ini
            and "[Crash Reporter]" not in ini,
            "the program, with the app's application.ini",
        )
        with open(launcher) as f:
            script = f.read()
        check(
            os.access(launcher, os.X_OK)
            and f"-app '{program}/browser/application.ini'" in script
            and f"MOZ_APP_LAUNCHER='{launcher}'" in script,
            "a launcher that runs it as the app, and names itself for links",
        )
        if shutil.which("desktop-file-validate"):
            valid = subprocess.run(["desktop-file-validate", desktop], capture_output=True, text=True)
            check(valid.returncode == 0, f"a valid desktop entry{valid.stdout.strip() and ' (' + valid.stdout.strip() + ')'}")
        else:
            check(os.path.exists(desktop), "a desktop entry")
        check(all(os.path.exists(icon) for icon in icons), "icons in the icon theme")
        check(
            OURS in gio_mime("x-scheme-handler/http"),
            "the desktop offers it for web links",
        )
        after = {t: default(t) for t in MIME_TYPES}
        check(
            all(app == OTHER for app in after.values()),
            f"but the other browser still opens them all ({after})",
        )
        mimeapps = os.path.join(env["XDG_CONFIG_HOME"], "mimeapps.list")
        chosen = open(mimeapps).read() if os.path.exists(mimeapps) else ""
        check(f"x-scheme-handler/http={OTHER}" in chosen, "kept as the user's choice, in mimeapps.list")

        # A default the user chose stays, through a reinstall.
        subprocess.run(["gio", "mime", "x-scheme-handler/http", OURS], env=env, capture_output=True)
        os.makedirs(profiles)
        with open(os.path.join(profiles, "profiles.ini"), "w") as f:
            f.write("[General]\n")
        again = app_step("install")
        check(
            again.returncode == 0 and default("x-scheme-handler/http") == OURS,
            "a reinstall updates it and keeps a default the user chose",
        )

        removed = app_step("uninstall")
        check(
            removed.returncode == 0
            and not any(os.path.exists(p) for p in (program, launcher, desktop, *icons)),
            "uninstall removes the program, launcher, desktop entry and icons",
        )
        check(os.path.exists(os.path.join(profiles, "profiles.ini")), "and keeps the profiles")
    finally:
        shutil.rmtree(work, ignore_errors=True)

    print("\n".join(results))
    failed = [r for r in results if not r.startswith("ok")]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
