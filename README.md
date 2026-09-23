<div align="center">

<img src="assets/neeko.svg" alt="neeko" width="620" />

# neeko

**Build any browser UI you want in plain HTML, CSS and JS. Firefox does the rest.**<br>
*Firefox underneath, any face on top.*

</div>

---

Neeko is a framework on top of Firefox. It hides Firefox's own interface and
lets you draw your own (a diagonal tab bar, a circular address bar, anything)
with ordinary web code. A bridge API connects that UI to Firefox's real
features, and anything your UI doesn't handle yet falls back to a working
default, so a browser built on Neeko is always complete.

## Status

Early foundation work, on Firefox 156.0.1. Neeko hides Firefox's interface,
loads a custom UI from `ui/` with the web page placed wherever that UI says,
and gives the UI a first small JavaScript API for tabs and navigation. `ui/`
holds a deliberately plain demo UI built only on that API: a tab list, back,
forward and reload, and an address bar.

## Requirements

- macOS on Apple Silicon (Linux and Windows builds are untested so far)
- Xcode, [bun](https://bun.sh), and GNU tar (`brew install gnu-tar`)
- About 10 GB of free disk for the Firefox source and build

## Usage

```sh
make
```

The first run installs dependencies, downloads the Firefox source into
`engine/`, builds it, and launches it with your UI from `ui/` and a throwaway
dev profile. That takes about 15 minutes, mostly unpacking Firefox and
snapshotting it into git. After that, a rebuild takes under a minute.

| Command       | What it does                                       |
| ------------- | -------------------------------------------------- |
| `make`        | Set up if needed, build, and launch                |
| `make build`  | Build only                                         |
| `make update` | Quit a running dev build, rebuild, and relaunch it |

## Building a UI

Your UI is an ordinary web page: `ui/index.html` plus whatever CSS and JS it
loads. Neeko shows it in place of Firefox's interface, filling the window.
Changes to `ui/` only need a relaunch, not a rebuild.

- Mark the element where the website should appear with
  `data-neeko-content`. Neeko keeps the real page on top of it, matching its
  position, size and corner rounding, and follows it when it moves or
  animates.
- On macOS, the window's close, minimize and zoom buttons appear wherever you
  put an element with `data-neeko-window-buttons`.
- Your scripts get a global `neeko` object, the Neeko API: list, open, close
  and switch tabs, navigate, and hear about every change. It's documented in
  [docs/api.md](docs/api.md), and `ui/app.js` shows all of it in use.
- Scripts must be separate files (the page's security policy blocks inline
  scripts). They load from `chrome://neeko-ui/content/`, which maps to `ui/`.
- If there's no UI configured, Neeko stays out of the way and Firefox looks as
  usual. Pop-up windows, such as sign-in pop-ups, keep Firefox's minimal UI.

## How it works

Surfer (the tool Zen Browser uses to build its Firefox fork) downloads the
Firefox release pinned in `surfer.json`, applies this repo's changes to it, and
drives Firefox's own build tool.

Builds are **artifact builds**: instead of compiling Firefox's C++ and Rust
(hours), the build downloads Mozilla's prebuilt binaries for the exact same
release and only builds the frontend layer locally (minutes). Neeko works
entirely in that frontend layer. Set `NEEKO_FULL_BUILD=1` to compile
everything from source instead.

Neeko uses **hide and plug**. Firefox keeps running exactly as it is, logic
and all, so tabs, extensions, session restore and prompts all keep working.
Neeko hooks into Firefox's official per-window startup hook, before the
window is first drawn, and does four things:

1. It hides Firefox's toolbars and sidebar. The elements are never laid out or
   painted, which in a 300-tab test made opening tabs faster than stock
   Firefox, with no measurable difference in memory or tab switching.
2. It mounts your UI in a frame filling the window.
3. It places Firefox's real page area over your content slot.
4. It gives your UI the `neeko` API. Every call is a message to Firefox, so
   UIs will later be able to run sandboxed without changing their code.

The only change to a Firefox file is one line (plus a comment) that adds Neeko's folder
to the build (`src/browser/moz-build.patch`).

Because of artifact builds, the program inside the app bundle keeps the name
`firefox`. The profile folder is named "Neeko", so dev builds never touch a
regular Firefox profile. The visible name and icon come from branding, which
is still Firefox's unofficial "Nightly" branding for now.

```
neeko/
├── surfer.json   Firefox version pin and app name
├── configs/      Build settings Surfer merges into engine/mozconfig
├── ui/           The demo UI (yours to replace)
├── src/          Neeko's own files, layered onto engine/ by Surfer
│   └── browser/
│       ├── neeko/            Window hook, API, hide styles, default prefs
│       └── moz-build.patch   The one line that adds neeko/ to the build
├── docs/         The API reference (api.md), build plan (plan.md), privacy research
├── tools/        Dev helpers: test_api.py checks the API, marionette.py drives a build
├── assets/       README artwork
├── Makefile
└── engine/       Firefox source, downloaded by Surfer (not committed)
```

## License

Firefox is licensed under the [MPL-2.0](https://www.mozilla.org/MPL/2.0/).
