# How Neeko fits together

Neeko is a mask for Firefox. Firefox keeps running exactly as it is, with
all its logic: tabs, history, extensions, session restore, prompts,
security. Neeko hides everything Firefox draws around the web page and puts
a web page of your own in its place, your browser's UI. A small API lets that
UI ask Firefox to do things and hear what Firefox is doing. Anything the UI
doesn't handle yet, Firefox still handles its own way, so a browser built on
Neeko always works.

## The layers

From what a browser's developer writes, down to Firefox itself:

```
 your browser's repo    browser.json · ui/ · branding/          (the app)
        │
 the UI page            ui/index.html, running inside the window, with `neeko`
        │  messages of plain data
 Neeko                  src/browser/neeko/: window hook, API, styles, prefs
        │  Firefox's official startup hooks
 Firefox                engine/: Firefox 156.0.1, unchanged but for two small patches
        │
 the build              Surfer + tools/app.ts + mach: artifact or full build
```

### 1. The app: a browser's own files

A browser built on Neeko is a folder with three things, and a fourth if it
wants:

- `browser.json`: its name, vendor, app id and version, and optionally its
  look for what Firefox still draws (`theme`), which of Firefox's menus to
  keep (`menus`) and its containers (`containers`).
- `ui/`: its interface, an ordinary web page (`index.html` and whatever it
  loads).
- `branding/`: its icon, its own default prefs, and any Firefox branding
  file it wants to replace.
- `pages/` (optional): its own pages in tabs, like a start page, served as
  `about:<name>`.

That folder is the browser's own git repo, with Neeko inside it as a pinned
submodule (`neeko/`). Neeko's own repo is built the same way: its
`browser.json`, `ui/` (the demo UI) and `branding/` are the demo app. See
[docs/using-neeko.md](docs/using-neeko.md).

### 2. The UI page

The UI is a web page loaded into a frame that fills the browser window. It
marks where the website should appear with `data-neeko-content`, and Neeko
lays Firefox's real page area exactly over that spot, following it as it
moves, resizes or animates. The page is on top of the UI, except where the
UI marks elements with `data-neeko-overlay` (menus, a sliding sidebar): while
one overlaps the page, the UI goes above the page, clipped to everything but
the page plus those elements, so they're drawn over it and the rest of the
page stays visible and live. On macOS, the window's close, minimize and zoom
buttons go wherever the page puts `data-neeko-window-buttons`, and the
page's `-moz-window-dragging: drag` areas move the window (NeekoWindow allows
them in the UI frame, which Firefox only does for a window's top document;
the page area is always `no-drag`); on Linux the window keeps the system's
titlebar.

The page gets one global, `neeko`, before any of its scripts run. It's the
only way the UI talks to Firefox ([docs/api.md](docs/api.md)). Web pages
never get it.

The UI page is served from `chrome://neeko-ui/content/`, because Firefox's
window only allows frames from `chrome:` addresses. In dev launches that
address points at the app's `ui/` folder (the `neeko.ui.path` pref), so
editing the UI only needs a relaunch. Builds also bundle the UI inside the
app, and packaged browsers use that copy.

### 3. Neeko: the bridge

Neeko's code lives in `src/browser/neeko/`, a folder Firefox builds
because of a one-line patch. It plugs into Firefox only through Firefox's
official startup hooks (`Neeko.manifest`):

- **`NeekoWindow.sys.mjs`** runs for every browser window, before it's first
  drawn. It hides Firefox's toolbars and sidebar (`neeko.css`), mounts the
  UI frame, keeps the page area over the UI's content slot (or over the
  whole screen while a page is fullscreen) and the UI's overlays over the
  page, shows Firefox's notification bars across the top of the page, gives
  the UI page its API, and
  sends Cmd+L to the UI's address bar (or shows Firefox's own if the UI has
  none). Pop-up windows keep Firefox's minimal UI.
- **`NeekoPanels.sys.mjs`** gives Firefox's own panels (permission prompts,
  the downloads panel, notices) somewhere to hang from: the top edge of the
  web page, since the toolbar icons they normally hang from are hidden. It
  also hands permission prompts to a UI that shows them itself, keeping
  Firefox's prompt closed meanwhile.
- **`NeekoAPI.sys.mjs`** is Firefox's side of the API, one per UI page. It
  answers calls and turns Firefox's tab and navigation signals into events.
- **`NeekoDownloads.sys.mjs`** follows the window's downloads for the API,
  once the UI asks about them.
- **`NeekoBookmarks.sys.mjs`** turns Firefox's bookmarks (Places) into plain
  data and events for the API.
- **`NeekoPages.sys.mjs`** serves the app's own pages (`pages/<name>.html`)
  as `about:<name>`, at startup: web content with no privileges, in
  Firefox's privileged about: process, not linkable by websites, with the
  start page as the New Tab and home page, and private windows' first page. A process script registers them
  in content processes too, and a window actor (`NeekoPageChild` and
  `NeekoPageParent`) gives them `neekoPage`, checking every call, and
  `NeekoImport.sys.mjs` does their importing from other browsers. This is
  the one place web content gets an API (the user's decision, with those
  locks).
- **`NeekoTheme.sys.mjs`** puts the app's look (`browser.json`'s `theme`,
  bundled as CSS values) on what Firefox still draws: a page's dialogs, its
  panels and bars, the find bar. Neeko's `neeko-theme.css` and
  `neeko-theme-dialog.css` map the values onto Firefox's own styles, so apps
  never style Firefox's elements.
- **`NeekoContainers.sys.mjs`** keeps the app's containers (Firefox user
  contexts: its own cookies and site data each) and each window's: it
  decides a new window's from how it was opened, keeps a window without one
  from loading until the UI picks, and every tab in its window's
  container.
- **`NeekoHelpers.sys.mjs`** starts the app's helpers (`browser.json`'s
  `helpers`, programs the build puts next to Firefox's) when the UI or a
  page first asks one something, with an environment of Neeko's choosing,
  and carries the requests to it over 127.0.0.1, streaming the answers
  back as messages. The helper's token stays in this module.
- **`NeekoMenus.sys.mjs`** trims Firefox's menu bar and context menu to
  what the app keeps (`browser.json`'s `menus`), in Neeko's names for them
  (`NeekoMenuNames.sys.mjs`, which the build reads too).
- **`NeekoSettings.sys.mjs`** keeps the UI's settings (prefs named
  `neeko.settings.*`, shared by every window) and the color scheme
  (Firefox's `ui.systemUsesDarkTheme`). The UI gets both with `neeko`,
  before its first paint, and change events keep them current.
- **`neeko-api.js`** is the UI's side: the `neeko` object.
- **`NeekoPrivacy.sys.mjs`** and the pref files (`firefox-neeko.js`,
  `firefox-neeko-privacy.js`) set Neeko's defaults, privacy first.

### 4. Firefox

`engine/` is Firefox's own source for the pinned release (`neeko.json`),
downloaded by Surfer and not committed. Neeko changes two Firefox files,
each by a few marked lines: one adds Neeko's folder to the build
(`src/browser/moz-build.patch`), one adds Neeko's pref files to packaged
builds (`src/browser/installer/package-manifest-in.patch`). Everything else
is Neeko's own files next to Firefox's, so a new Firefox release is mostly a
version bump.

### 5. The build

`make` runs the whole chain:

1. `tools/app.ts` reads the app folder and writes Surfer's config
   (`surfer.json`) and a Firefox branding folder with the app's name, icon,
   prefs, version and UI (`engine/browser/branding/release/`).
2. Surfer (the tool Zen Browser uses) downloads Firefox once, links Neeko's
   files into it and applies the two patches.
3. Firefox's own build tool, mach, builds it.

Everyday builds are **artifact builds**: Mozilla's prebuilt C++ and Rust for
the exact same release, with only the frontend (JavaScript, HTML, CSS, where
Neeko lives) built locally. About 30 seconds. Their catch: the prebuilt
launcher has Firefox's name compiled in, so dev builds must always run with
a throwaway profile, which `make` and the tests do.

**Release builds** (`make release`) compile everything from source, in their
own build folder. That takes hours, but the result carries the browser's own
name and profile folder and has Firefox's telemetry, crash reporter and
updater compiled out. `mach package` then makes the app and a disk image,
and `tools/app.ts` adds the app's helpers (`browser.json`'s `helpers`) to
both. Dev builds link to them instead, after every `mach build`.

**On Linux, `make install`** installs a browser for the user from the
artifact build, packaged by Firefox's packager, since a full build is out of
reach of many Linux machines. Its launcher runs the prebuilt program with
`-app` and the app's own `application.ini`, which gives it the app's name,
profile folder and desktop identity and no crash reporter, as a release's
would ([docs/using-neeko.md](docs/using-neeko.md#installing-on-linux)).

## How things flow

**A window opens.** Firefox calls `NeekoWindow.init` before the first paint.
Neeko finds the UI (the dev folder or the bundled copy), hides Firefox's UI,
and adds the UI frame. As the UI document is created, Neeko installs
`neeko` into it and connects it to a new `NeekoAPI` for this window; once
the page is parsed, it starts keeping the web page over the content slot.

**The UI calls the API.** `neeko.tabs.open("example.com")` becomes a message
`{ id, method: "tabs.open", params }` on a `MessageChannel`. `NeekoAPI` does
it through Firefox's own tab code (fixing up the address as Firefox's
address bar would) and replies `{ id, result }`. Anything that changes along
the way (a tab opened, got selected, started loading) arrives as events
first, on the same ordered channel.

**Firefox does something by itself.** A link opens a tab, a page changes
its title, the user presses Cmd+W. `NeekoAPI` hears Firefox's own signals
and sends events, but only the ones the UI listens for.

**The UI doesn't handle something.** Neeko's rule is that listening means
"my UI handles this", and nobody listening means Firefox's own version:

- No `addressbar` listener: Cmd+L shows Firefox's own address bar.
- No `prompts` `open` listener: Firefox's own prompt asks for permissions.
- No `fullscreen` `page` listener: a fullscreen page fills the window over
  the UI.
- No `downloads` `start` listener: Firefox's downloads panel opens when a
  download starts.
- No `bookmarks` `request` listener: Cmd+D opens Firefox's bookmark panel.
- No `settings` `request` listener: Cmd+, opens Firefox's settings.
- No `find` `request` listener: Cmd+F opens Firefox's find bar.
- No `status` `link` or `message` listener: Firefox's status bubble shows
  them.

Every future feature with a Firefox fallback (context menus) works the same
way. Until then, Firefox's own versions of those already
work, with their panels hanging from the top of the page.

## Decisions, and why

- **Hide and plug, not patching Firefox.** Zen Browser carries about 256
  patches against Firefox and rebases them every month. Neeko hides
  Firefox's UI with CSS and plugs in through official hooks instead, so
  Firefox updates stay cheap. Firefox's own UI stays in the document, not
  laid out or painted; with 300 tabs it measured the same memory and
  tab-switching speed as stock Firefox.
- **Features go on the lowest rung that works:** UI on the API first, then
  privileged modules through the hooks, and Firefox patches only with the
  user's approval and an explanation of the update cost.
- **"Become" now, "Trick" later.** Today the UI runs inside the real window
  ("Become"): fast, and it can draw anywhere. Later a sandboxed mode
  ("Trick") can run the UI as an unprivileged page that only has the API.
  The API is messages of plain data from day one, so Trick only swaps the
  channel.
- **Neeko is a dependency, not a template.** Browsers pin Neeko as a
  submodule instead of forking it, so updating Neeko (and Firefox with it)
  never conflicts with the browser's own work, and API features added for
  one browser land in Neeko for all of them.
- **Surfer stays as the build tool** (downloading Firefox, applying
  patches), but Neeko's own code never depends on it, and Neeko generates
  its own branding rather than using Surfer's (which would override
  Neeko's privacy prefs).
- **Privacy by default, as defaults, not locks.** Neeko's pref files turn
  telemetry, studies, ads and the rest off from the first launch, in every
  browser built on Neeko. They're defaults: a browser can change any of them
  in its own prefs, and users can too. No enterprise policies, which would
  show "managed by your organization" and lock settings for good. See
  [PRIVACY.md](PRIVACY.md).
- **Firefox's version stays the engine version.** Add-on updates and website
  compatibility fixes compare against it; a browser's own version is shown
  in its About window instead.
- **Performance is a feature** ("a bajillion tabs"): the hidden Firefox UI
  stays asleep, big things reach the UI by reference (tab icons are `blob:`
  URLs made in the UI page, one per distinct icon; tab previews will work
  the same way), tab sleeping belongs in the API, and a performance test
  with a budget is on the roadmap.

## Where things are

```
neeko/
├── neeko.json        The Firefox release Neeko is built on
├── browser.json      The demo app: name, vendor, app id, version
├── ui/               The demo UI, built only on the API
├── branding/         The demo app's icon and prefs
├── src/browser/
│   ├── neeko/        Neeko itself: window hook, API, styles, prefs
│   ├── moz-build.patch
│   └── installer/package-manifest-in.patch
├── configs/          Build settings (mozconfig) Surfer merges
├── tools/            app.ts (the app step), new-browser.ts (the starter),
│                     tests (test_api, test_privacy, test_release), marionette.py
├── docs/             API, using Neeko in a browser, privacy research, lessons
├── Makefile          make, make build, make update, make stop, make release,
│                     make install and make uninstall (Linux)
├── engine/           Firefox's source and builds (not committed)
└── dist/             Release packages (not committed)
```
