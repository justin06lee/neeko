# How a browser uses Neeko

Setup step 6: how a separate browser project (such as the one the user is
building) should use Neeko, so that Neeko and the browser both stay easy to
update. **Status: proposed. The recommendation below is what gets
implemented unless the user picks another option.**

## What has to be true

- **Updating Neeko is one small step** and never conflicts with the
  browser's own work. Firefox updates arrive through Neeko.
- **The browser only contains its own things:** its UI, name, icons, its own
  prefs, and later its own privileged backend modules.
- **Adding an API feature is easy from inside the browser project,** because
  the user adds Neeko features one at a time as the browser needs them.
- **Shipped browsers have their own identity.** Setup and privacy work found
  that Mozilla's prebuilt launcher (used by the fast artifact builds) has
  "Firefox" compiled in: its app name, and so its profile folder
  (`~/Library/Application Support/Firefox`). A shipped browser needs a
  launcher compiled with its own name. `mach package` also leaves out
  Neeko's pref files today.

## The options

| | How it works | Updating Neeko | Verdict |
| --- | --- | --- | --- |
| **A. Template (fork)** | The browser starts as a clone of Neeko and pulls Neeko's changes with `git pull`. | A merge. Conflicts wherever both sides touched the same file: the README, `surfer.json` (name and Firefox version), the demo UI. | Simple to start, messy to keep up. An API feature added in the browser repo is hard to send back to Neeko. |
| **B. Layered patches** | The browser keeps patches against Neeko, like Zen keeps against Firefox. | Rebasing patches, every time. | No. This is exactly what "hide and plug" avoided. |
| **C. Prebuilt runtime** | Neeko ships a built app, Electron-style, and the browser adds its UI and branding. | Download a new runtime. | Not yet. The launcher's name is compiled in, so every browser needs its own compiled launcher anyway, and Neeko would need to host builds for every platform. |
| **D. Neeko as a dependency** | The browser repo has Neeko inside it as a pinned git submodule and owns everything else. | Point the submodule at a newer Neeko tag. Nothing to merge. | **Recommended.** |

## Recommended: Neeko as a pinned dependency (D)

The browser's repo looks like this:

```
mybrowser/
├── neeko/           Neeko itself, a git submodule pinned to a release tag
├── ui/              The browser's UI (HTML, CSS, JS on the neeko API)
├── branding/        Name, icons, brand strings, and prefs that override Neeko's
├── browser.json     Name, vendor, app ID: the browser's identity
├── Makefile         A few lines that hand everything to neeko/
└── README.md
```

**Day to day.** `make` builds the browser with Neeko's fast artifact build and
launches it with its own UI and a throwaway dev profile, exactly like Neeko's
own `make` does today.

**Updating Neeko** (including Firefox updates, which Neeko pins):
`git -C neeko fetch --tags && git -C neeko checkout v0.3.0`, then commit the
new pointer. Nothing merges, so nothing conflicts. Pinning to a tag means the
browser moves to a new Neeko when it chooses to, and can go back.

**Adding an API feature the browser needs.** Work inside `neeko/`, which is a
normal Neeko checkout: branch, build, test, commit, push to Neeko, tag. Then
the browser points at the new tag. The feature lands in Neeko, where every
browser built on Neeko gets it, not in the browser's repo.

**Overriding Neeko.** The browser's `branding/` prefs load after Neeko's
(that's why Neeko's pref files are named `firefox-neeko*.js`), so the browser
can change any Neeko default, privacy defaults included, without touching
Neeko.

**Starting a new browser keeps "clone it and we have APIs":** a starter
template (a small repo, or `neeko/tools/new-browser`) that creates the layout
above, with the submodule already set up and a copy of the demo UI as a
starting point. `git clone --recursive`, `make`, done.

**Releases.** Artifact builds stay the everyday dev loop. A release build
(`make release`) does a full build (`NEEKO_FULL_BUILD=1`), which compiles the
launcher with the browser's own name, so its profile folder is its own, and
compiles Firefox's telemetry out entirely instead of only switching it off.
It takes an hour or two, so it belongs on a build machine or CI, not in the
edit loop. The same build packages the browser's UI into the app and includes
Neeko's pref files.

### What Neeko needs to change for this

Neeko's own repo becomes "just another browser": its demo UI and placeholder
branding are the default app, and the build takes the app from a folder.

1. **Build from an app folder.** The build reads `browser.json`, `ui/` and
   `branding/` from the app folder (the parent folder when Neeko is a
   submodule; Neeko's own demo app otherwise) and generates Surfer's config
   from them. `surfer.json` stops being hand-edited by browsers.
2. **Branding.** Name, vendor, app ID, icons and brand strings come from the
   app folder, through Firefox's normal branding mechanism, with the app's
   prefs file loading after Neeko's.
3. **Packaging.** Bundle the app's UI inside the app and point Neeko at it
   when there's no dev UI path, and add Neeko's pref files to
   `package-manifest.in` (one small, clearly marked patch).
4. **Release builds.** `make release`: a full build and `mach package`,
   verified by launching the result and checking `Services.appinfo.name` and
   the profile folder.
5. **The starter.** Create a new browser with the layout above.
6. **Versions.** Tag Neeko releases (`v0.1.0` onward). A breaking API change
   is a major version.

### Trade-offs

- Git submodules need `--recursive` when cloning, and a commit in the browser
  repo to move the pin. The starter and README cover both.
- Each browser checkout has its own `neeko/engine/` (about 10 GB). Several
  browsers on one machine could share one Neeko checkout later if that
  matters.
- A full release build is slow. That's the price of a launcher with the
  browser's own name; every Firefox fork pays it.
