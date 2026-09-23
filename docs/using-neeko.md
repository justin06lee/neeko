# How a browser uses Neeko

Setup step 6: how a separate browser project (such as the one the user is
building) uses Neeko, so that Neeko and the browser both stay easy to update.
**Status: implemented** (option D below, chosen 2026-09-23).

## What has to be true

- **Updating Neeko is one small step** and never conflicts with the
  browser's own work. Firefox updates arrive through Neeko.
- **The browser only contains its own things:** its UI, name, icons, its own
  prefs, and later its own privileged backend modules.
- **Adding an API feature is easy from inside the browser project,** because
  the user adds Neeko features one at a time as the browser needs them.
- **Shipped browsers have their own identity.** Mozilla's prebuilt launcher
  (used by the fast artifact builds) has "Firefox" compiled in: its app name,
  and so its profile folder (`~/Library/Application Support/Firefox`). A
  shipped browser needs a launcher compiled with its own name.

## The options that were considered

| | How it works | Updating Neeko | Verdict |
| --- | --- | --- | --- |
| **A. Template (fork)** | The browser starts as a clone of Neeko and pulls Neeko's changes with `git pull`. | A merge. Conflicts wherever both sides touched the same file: the README, the app's name and Firefox version, the demo UI. | Simple to start, messy to keep up. An API feature added in the browser repo is hard to send back to Neeko. |
| **B. Layered patches** | The browser keeps patches against Neeko, like Zen keeps against Firefox. | Rebasing patches, every time. | No. This is exactly what "hide and plug" avoided. |
| **C. Prebuilt runtime** | Neeko ships a built app, Electron-style, and the browser adds its UI and branding. | Download a new runtime. | Not yet. The launcher's name is compiled in, so every browser needs its own compiled launcher anyway, and Neeko would need to host builds for every platform. |
| **D. Neeko as a dependency** | The browser repo has Neeko inside it as a pinned git submodule and owns everything else. | Point the submodule at a newer Neeko tag. Nothing to merge. | **Chosen.** |

## The browser's repo

```
mybrowser/
├── neeko/           Neeko itself, a git submodule pinned to a release tag
├── ui/              The browser's UI (HTML, CSS, JS on the neeko API)
├── branding/        prefs.js, icon.png, and any Firefox branding file to replace
├── browser.json     Name, vendor, app id, version: the browser's identity
├── Makefile         A few lines that hand everything to neeko/
└── README.md
```

**Starting one:** from a Neeko checkout,

```sh
bun tools/new-browser.ts ../mybrowser --name MyBrowser
cd ../mybrowser
make
```

`tools/new-browser.ts` creates the repo (branch `master`), adds Neeko as a
submodule pinned to the newest `vX.Y.Z` tag (or the current commit if there
are no tags yet), copies the demo UI in as a starting point, writes the files
above and makes the first commit. `--neeko URL` picks where the submodule
comes from; by default it's this checkout's `origin` remote, or this folder
itself while Neeko has no remote.

**Day to day.** `make` builds the browser with Neeko's fast artifact build and
launches it with its own UI and a throwaway dev profile, exactly like Neeko's
own `make`. The browser's Makefile just runs `make -C neeko APP=$(CURDIR)`,
and `make build`, `make update`, `make stop` and `make release` pass through
the same way.

**Updating Neeko** (including Firefox updates, which Neeko pins):
`git -C neeko fetch --tags && git -C neeko checkout v0.3.0`, then commit the
new pointer. Nothing merges, so nothing conflicts. Pinning to a tag means the
browser moves to a new Neeko when it chooses to, and can go back.

**Adding an API feature the browser needs.** Work inside `neeko/`, which is a
normal Neeko checkout: branch, build, test, commit, push to Neeko, tag. Then
the browser points at the new tag. The feature lands in Neeko, where every
browser built on Neeko gets it, not in the browser's repo. Running `make`
inside `neeko/` builds Neeko's own demo app, which is where every API
feature is demonstrated; running it in the browser's folder builds the
browser again.

## browser.json

```json
{
  "name": "MyBrowser",
  "displayName": "My Browser",
  "vendor": "Example",
  "appId": "com.example.mybrowser",
  "version": "0.1.0"
}
```

| Field | What it's for |
| --- | --- |
| `name` | Letters and digits. The program's name, so it names the profile folder (`~/Library/Application Support/MyBrowser`). Pick it once: changing it later starts users on a fresh profile. |
| `displayName` | Optional (defaults to `name`). What users see: the app's name in Finder and the Dock, and in Firefox's own strings. |
| `vendor` | Who makes it, as users see it. Firefox's build fixes the internal vendor to "Mozilla" (it's only settable by patching Firefox's configure), which only affects profile paths on Windows and Linux, where the name already keeps them apart from Firefox's. |
| `appId` | A reverse-DNS id, used as the macOS bundle id. |
| `version` | The browser's own version, shown in its About window. Firefox's version (`Services.appinfo.version`) stays the Firefox release, because add-on updates, Remote Settings and website compatibility checks compare against it. |

## branding/

Everything here is optional.

- **`icon.png`**: a square PNG, at least 1024 pixels. The build makes the
  macOS app icon (`firefox.icns` and `Assets.car`), window icons and the logo
  Firefox's own pages show from it. Add `icon.svg` too if you have one; it's
  used where Firefox wants an SVG logo.
- **`prefs.js`**: the browser's default prefs, in Firefox's `pref()` syntax.
  They load after Neeko's, so they win over any Neeko default, privacy ones
  included. Only change a privacy default on purpose; the privacy test
  (`python3 neeko/tools/test_privacy.py`) shows the effect.
- **Any Firefox branding file**, at the same path as in Firefox's
  `browser/branding/unofficial/` (for example `content/firefox-wordmark.svg`),
  replaces Firefox's, and wins over anything made from `icon.png`. Files
  that aren't Firefox branding files are reported and ignored.

## How the build uses the app folder

The Makefile's app step (`tools/app.ts`) turns the app folder into what
Surfer and Firefox's build need. Firefox's own files stay untouched.

1. **`surfer.json`** is generated from Neeko's Firefox pin (`neeko.json`) and
   `browser.json`. It's not committed; nobody edits it.
2. **A Firefox branding folder** is generated at
   `engine/browser/branding/release/` and selected with `--with-branding`. It
   starts as a copy of Firefox's unofficial branding, then gets the app's
   names (`configure.sh`, `brand.ftl`, `brand.properties`), its prefs
   appended to `firefox-branding.js`, its icons, its version files, and its
   UI.
3. **The UI goes inside the app.** The app's `ui/` folder is bundled into
   Firefox's `browser.jar` at `chrome://neeko-ui/content/`. Neeko uses it
   whenever the `neeko.ui.path` pref is empty, which is how packaged
   browsers run. Dev launches (`make run`) set `neeko.ui.path` to the app's
   `ui/` folder, which wins over the bundled copy, so UI changes still only
   need a relaunch.
4. **Build settings** (`app.mozconfig` in that folder, read by
   `configs/common/mozconfig`): the program name (`--with-app-basename`), the
   bundle id prefix (`--with-distribution-id`), and the version files
   (`--with-version-file-path`).
5. **Packaging.** Neeko's chrome files live in `browser.jar`, which packaged
   builds already include. Its two pref files need Firefox's package list
   (`browser/installer/package-manifest.in`) to name them, which is Neeko's
   second, three-line patch: `src/browser/installer/package-manifest-in.patch`.

## Release builds

```sh
make release          # hours: a full build, then a package (RUST_LTO=0|1 to choose)
python3 tools/test_release.py
python3 tools/test_api.py --app dist/Neeko.app
python3 tools/test_privacy.py --app dist/Neeko.app
```

Artifact builds stay the everyday dev loop. `make release` compiles
everything from source (`NEEKO_FULL_BUILD=1`), in its own build folder
(`engine/obj-release`) so the dev build is left alone, then runs
`mach package` and copies the result into the app's `dist/` folder as
`<Name>.app` and `<name>-<version>.dmg`. The full build compiles the launcher
with the browser's own name, so its profile folder is its own, and compiles
Firefox's telemetry upload, crash reporter and updater out entirely instead
of only switching them off. It belongs on a build machine or CI, not in the
edit loop.

`tools/test_release.py` launches the packaged app with a throwaway profile
and checks it is its own browser: program name and profile folder, bundle
id, versions, telemetry, crash reporter and updater compiled out, Neeko's
prefs packaged, and the bundled UI running with the API. Then the API and
privacy tests run against the same app with `--app`.

**Verified on 2026-09-23** with Neeko's demo app, on an 8 GB M1:
`tools/test_release.py` passed all 13 checks (program name `Neeko`, profile
folder `~/Library/Application Support/Neeko`, bundle id `dev.neeko.demo`,
About version 0.1.0 on Firefox 156.0.1, telemetry, crash reporter and
updater compiled out, prefs and UI packaged), the API test passed all 52
checks against `dist/Neeko.app`, and so did the privacy test: while idle,
only the three kept Remote Settings hosts; while browsing, only the
websites; nothing around the proxy; upload disabled, no pings waiting.

**Build machines:** a full build with all optimizations needs 16 GB of
memory or more. On smaller machines `make release` runs fewer jobs and
skips Rust link-time optimization, which alone needs about 10 GB; the
browser is the same, its Rust code a little bigger and slower. The 8 GB
machine above took about six hours; see [lessons.md](lessons.md) for why.

The packages aren't signed or notarized yet; that needs the browser's own
Apple Developer ID and belongs with distribution (updates, crash reports) in
the roadmap.

## Versions

Neeko releases are annotated `vX.Y.Z` tags, starting at `v0.1.0`. Browsers
pin one. A breaking change to the API is a new major version (a new minor
version while Neeko is `0.x`). The version of Neeko's own demo app in its
`browser.json` follows Neeko's.

## Trade-offs

- Git submodules need `--recursive` when cloning, and a commit in the browser
  repo to move the pin. The starter's Makefile and README cover both (a plain
  `make` initializes a missing submodule).
- Each browser checkout has its own `neeko/engine/` (about 10 GB). Several
  browsers on one machine could share one Neeko checkout later if that
  matters.
- A full release build is slow. That's the price of a launcher with the
  browser's own name; every Firefox fork pays it.
