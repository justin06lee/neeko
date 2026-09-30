# Working on Neeko

Neeko is a framework, not a browser. It hides Firefox's entire interface and
lets developers draw any browser UI in plain HTML, CSS and JS. The `neeko`
API bridges that UI to Firefox's real features, and fallbacks cover whatever
a UI doesn't handle yet. Browsers built on Neeko keep it as a pinned git
submodule and bring their own UI, name and icon (`docs/using-neeko.md`).

The user builds their own browser on Neeko in parallel and adds API features
one at a time as that browser needs them. Keep Neeko small: foundation only.

Read before working:

- [ARCHITECTURE.md](ARCHITECTURE.md): how the layers connect, and why.
- [ROADMAP.md](ROADMAP.md): what's next, in order, and open decisions.
- [docs/lessons.md](docs/lessons.md): Firefox and tooling traps. Read the
  section for whatever you're about to touch.
- [docs/api.md](docs/api.md), and [PRIVACY.md](PRIVACY.md) with
  [docs/privacy/](docs/privacy/implementation.md) for anything network-related.

## The user's rules (verbatim)

- Never modify engine code (dom/, layout/, netwerk/, js/, gfx/, etc.) without
  asking me first and explaining the update cost.
- Keep Neeko's code in its own folders; keep patches to Firefox files as few
  and as small as possible.
- Every new API feature must: have a fallback, be documented, and be
  demonstrated in the demo UI.
- SECURITY: the Neeko API is powerful and must only be available to the
  browser's own UI, never to web pages. Treat all web content as untrusted.
- Firefox is MPL-2.0 licensed; flag any licensing questions.
- After significant changes, verify the build still works and patches still
  apply cleanly.
- Add features one at a time, following ROADMAP.md.

## Privacy (the user's rules, verbatim)

From the privacy task:

> No telemetry or usage data may ever be sent to Mozilla (or anyone else)
> from any browser built on Neeko, starting from the very first launch.
> Browsers built on Neeko must inherit this automatically, with no extra
> setup.
>
> - Do NOT edit Firefox's own default pref files (e.g. all.js, firefox.js) or
>   other Firefox files. All changes must live in Neeko's own layers (build
>   config, Neeko's prefs files, and only if truly necessary, small
>   clearly-marked patches) so Firefox updates stay easy.
> - Verify every pref and build flag name against the current Firefox source.
>   Don't trust pref lists from memory or AI chats; many are outdated or made
>   up.

From privacy step 5:

> After every Firefox version update, re-run the privacy test and re-check
> the reference sources (Betterfox, LibreWolf, etc.) for newly added
> telemetry. Any new feature added to Neeko must not introduce outgoing
> connections without my approval.

In practice:

- The privacy test is `python3 tools/test_privacy.py` (about 6 minutes, after
  `make build`). Run it after every Firefox update, and after any change
  that could touch the network. It must pass.
- The reference sources are Betterfox, LibreWolf, arkenfox and Zen's prefs
  (`docs/privacy/research/reference-projects.md` has what they said last
  time). Check each for prefs added since the last Firefox version, verify
  every candidate in the new Firefox source, and update
  `src/browser/neeko/firefox-neeko-privacy.js`, `docs/privacy/` and
  [PRIVACY.md](PRIVACY.md).
- A new outgoing connection, from Neeko or from a Firefox feature an API
  exposes, needs the user's approval first. PRIVACY.md lists every
  connection; keep it current.

## Updating Firefox

1. Set the new release in `neeko.json` (`"firefox"`).
2. Move the old source aside or delete it (`engine/`, about 10 GB, and
   `.surfer/engine/firefox-*.tar.xz`), then `make build`. Surfer downloads
   the new release and re-applies Neeko's two patches; fix any that no
   longer apply (`bun run surfer export <file>`, then `bun run surfer
   import`).
3. `python3 tools/test_api.py`, then `python3 tools/test_privacy.py`.
4. Re-check the privacy reference sources (above) and re-verify every pref
   in `firefox-neeko-privacy.js` against the new source.
5. Commit, then release a new Neeko version (below).

## How the API is designed

- **Messages of plain data.** Calls are `{ id, method, params }`, replies
  `{ id, result | error }`, events `{ event, data }`. Never hand the UI live
  Firefox objects. That's what lets "Trick" mode (a sandboxed UI page) drop
  in later without changing any API call.
- **Listening means "the UI handles it"; nobody listening means Firefox's
  fallback.** The UI reports its first and last listener per event
  (`events.listen`), Neeko only sends listened events, and Firefox's own UI
  steps in for features nobody listens to. Every future fallback follows
  this rule.
- **Only the UI page gets `neeko`**, installed before its scripts. Web
  content must never reach it; `tools/test_api.js` has a probe page for
  this, and every new feature keeps it passing.
- **Each window is separate.** A UI sees and controls only its own window.
- **Every new API feature** gets a fallback, a section in `docs/api.md`, a
  demo in `ui/` (the demo UI), and checks in `tools/test_api.js`.
- **Performance:** keep the hidden Firefox UI asleep, and hand big things
  (favicons, previews) to the UI by reference, never as copies.
- **Features go on the lowest rung that works:** (1) UI built on the API,
  (2) privileged modules in Neeko's own folders, plugged in through
  Firefox's startup hooks, (3) Firefox patches, only with the user's
  approval and an explanation of the update cost.

## Working conventions

- **bun only** for JavaScript tooling (`bun install`, `bun run`, `bunx`),
  never npm, npx, pnpm or yarn. Test tools are plain Python 3.
- **Git:** the default branch is `master`. One feature branch per piece of
  work (`feat/<slug>`, `fix/<slug>`, `docs/<slug>`), conventional commits
  ending with the Co-Authored-By line, docs updated in the same commit,
  merged with `--no-ff`, then an annotated `feat-<slug>` tag. Releases are
  annotated `vX.Y.Z` tags (below).
- **Nothing outward-facing without asking:** no GitHub repo, remote or push
  without the user's OK.
- **README stays current**, keeping its banner.
- **The golden path is `make`.** `make build` takes about 30 seconds (an
  artifact build), `make` builds and launches the demo app, `make stop`
  quits only this checkout's dev build, `make release` takes hours.
- **Stop everything you start** (dev builds, servers, test browsers).
- **The component library (ruri):** "the demo UI" is `ui/`. When you build
  or change a piece of interface, register it with a screenshot.
- **Explain in plain language** with a clear recommendation, not a survey.
  The user writes casually.

## This machine

- **Never kill Firefox processes broadly.** The user runs another Firefox
  project (toji). Only kill processes under this checkout's `engine/obj-*/`
  (`make stop` does exactly that).
- **Never launch a dev build without its own `-profile`.** The prebuilt
  launcher calls itself Firefox, so its default profile folder is the
  user's real Firefox profiles. `make` and the test tools use throwaway
  profiles.
- **mach hides its output from AI agents.** Use `./mach build --verbose` to
  see errors.
- **Screenshots of the app:** `screencapture -x -o -l <window id>`, with the
  window id from Quartz's `CGWindowListCopyWindowInfo` for the app's pid
  (layer 0). ruri's bridge can't see this app's window.

## Testing

After `make build`:

- `python3 tools/test_api.py`: every API call and event, web pages can't see
  the API, and the bundled UI. About 10 seconds.
- `python3 tools/test_privacy.py`: every connection a fresh profile makes.
  About 6 minutes; `--idle 20 --browse 10` for a quick look,
  `--pref name=value` to check it still catches a leak.

After `make release`: `python3 tools/test_release.py`, then both tests above
with `--app dist/Neeko.app`.

On Linux, after `make install`: `python3 tools/test_install.py` (the installer,
in a throwaway home), and the API and privacy tests with
`--app ~/.local/share/neeko/app`.

Marionette has traps (focus, chrome context, its "recommended prefs"); see
the testing section of [docs/lessons.md](docs/lessons.md).

## Releasing Neeko

1. On `master`, with everything merged: set the version in `browser.json`
   (Neeko's demo app follows Neeko's version).
2. `make build` and both tests; for releases that change packaging or the
   Firefox version, also `make release` and the release checks.
3. `git tag -a vX.Y.Z -m "Release vX.Y.Z" -m "<highlights>"`. A breaking
   API change is a new major version (a new minor version while Neeko is
   0.x).
4. Ask before pushing. Browsers pick the release up by moving their
   submodule pin.
