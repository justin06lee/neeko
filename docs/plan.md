# Neeko build plan

The running plan for building Neeko: how we work, the user's rules, every
decision made so far, current status, and lessons learned. **A new session
should read this first.** Setup step 7 turns the rules into `CLAUDE.md` and the
rest into `ARCHITECTURE.md` and `ROADMAP.md`; until then this file is the
source of truth.

## How we work

- Two tracks run side by side: **Setup** (steps 1–7) and **Privacy** (steps
  1–5). Do one step at a time, explain it in plain language, and check with the
  user before moving on. The user writes casually and wants plain explanations
  plus a clear recommendation, not a survey.
- The user builds their own browser on Neeko in parallel and adds API features
  one at a time as that browser needs them. Keep Neeko small: foundation only.

## Decisions so far

- **Neeko is a framework, not a browser.** It's a "mask" or bridge: Firefox's
  entire UI is hidden, developers draw any UI in plain HTML/CSS/JS, a Neeko JS
  API connects it to Firefox's real features, and fallbacks cover whatever a UI
  doesn't handle yet. Name, logo and branding belong to whoever builds on
  Neeko.
- **Developer experience: "clone it and we have APIs."** Keep the
  developer-owned area separate from Neeko's internals, so pulling Neeko
  updates never conflicts. That area is `ui/`, their name and logo, and later a
  backend folder. A prebuilt, Electron-style runtime is an open alternative,
  to decide in setup step 6.
- **Hide and plug (option A), with no patch system.**
  - Firefox's logic keeps running; its UI is hidden.
  - Neeko plugs in through Firefox's official per-window startup hooks.
  - No Zen-style patching. Zen carries 256 patches and rebases them every
    month.
  - The only Firefox change is the one-line `src/browser/moz-build.patch`.
  - Features go on the lowest rung that works:
    1. **UI** built on the API.
    2. **Privileged backend modules** in the developer's own folder, plugged in
       through the same hooks.
    3. **Engine patches**, only with the user's explicit approval and an
       explanation of the update cost.
- **UI hosting: "Become" first, "Trick" later.**
  - Become (current): the UI runs inside the real window, so it's fast and can
    draw anywhere.
  - Trick (later): a sandboxed UI page that can only use the API.
  - Design the API as messages from day one, so Trick can drop in without
    changing any API calls.
- **The API is messages of plain data** (setup step 4, `docs/api.md`).
  - The UI sees a global `neeko` object (`neeko-api.js`), installed into the
    UI page only, before its scripts. Firefox's side is `NeekoAPI.sys.mjs`,
    one instance per UI page.
  - Calls are `{ id, method, params }`, replies `{ id, result | error }`,
    events `{ event, data }`. Become mode carries them over a
    `MessageChannel`; Trick will only swap the channel.
  - Tabs are snapshots `{ id, url, title, loading, canGoBack, canGoForward,
    selected }` with session-unique numeric ids. Events: `open`, `close`,
    `select`, `move`, `update` (with the list of changed fields).
  - A missing tab id means the selected tab (except `select`). `nav.go` and
    `tabs.open` take address-bar text and fix it up like Firefox's own
    address bar (`openTrustedLinkIn` with `allowThirdPartyFixup`).
- **Listening means "the UI handles it"; nobody listening means fallback.**
  The UI reports its first and last listener per event (`events.listen`),
  Neeko only sends listened events, and Firefox's own UI steps in for
  features nobody listens to. First use: `nav.on("addressbar")` gets Cmd+L
  and new New-Tab-page tabs; with no listener, Cmd+L shows Firefox's
  navigation toolbar until it loses focus. Future fallbacks (permission
  prompts, context menus) should follow the same rule.
- **Surfer stays as the build tool.** Neeko's own code must never depend on
  Surfer; only the build plumbing does.
- **Performance matters** ("a bajillion tabs"):
  - Keep the hidden UI asleep.
  - Hand the UI favicons and previews by reference, never copies.
  - Put tab sleeping in the API.
  - Add a performance test with a budget (roadmap).
- **Privacy by default** is a hard requirement (see the privacy track).
  Implemented in privacy step 3 (`docs/privacy/implementation.md`):
  - Neeko's pref files are named `firefox-neeko*.js`. Firefox reads default
    pref files in reverse alphabetical order and the last one wins, so
    these beat Firefox's `firefox.js` but lose to `firefox-branding.js`,
    where a browser built on Neeko can override them.
  - Defaults, never locks, and no `policies.json`: no "managed by your
    organization" notice, and browsers built on Neeko stay free to change
    anything.

## Setup track (the user's original steps, verbatim)

1. Research Surfer (Zen Browser's tool for building Firefox forks) and set up
   this repo with it, pinned to a current stable Firefox version. Use artifact
   builds if possible. Build and run plain Firefox through Surfer to confirm it
   works. **Done.**
2. Research how Firefox's frontend is wired (browser.xhtml,
   tabbrowser/gBrowser, how the page content area works, how permission
   prompts and panels attach to UI). Then give me 2-3 options for how Neeko
   should hide Firefox's UI and replace it, with pros/cons for each (e.g. keep
   Firefox's logic running invisibly vs. replacing it). Pay special attention
   to which option keeps Firefox updates easy. Wait for me to choose. **Done:
   A, hide and plug.**
3. Implement the chosen approach: Firefox UI hidden, a blank custom UI loaded
   from a clearly separated folder, and one web page showing in a content area
   the custom UI can position freely. **Done; the user hasn't reviewed the
   result yet.**
4. Create the first tiny version of the Neeko API: tabs (list, open, close,
   select, change events) and navigation (go to URL, back, forward, reload,
   current URL/title, loading state). Nothing more. **Done: `docs/api.md`,
   checked by `tools/test_api.py`.**
5. Build a minimal demo UI using only the API: a tab list and an address bar.
   Ugly is fine. It just proves the bridge works. **Done: `ui/`, named "the
   demo UI" in the component library.**
6. Propose how a separate browser project (mine) should use Neeko, e.g.
   template repo, layered patches, or something else, keeping in mind that
   Neeko and my browser must both be easy to update. **Next.**
7. Create these files:
   - CLAUDE.md: rules for all future work (below).
   - ARCHITECTURE.md: how the layers connect, in plain language.
   - ROADMAP.md: an ordered checklist of API features to add one at a time,
     most essential first (e.g. permission fallbacks, context menus,
     downloads, history, bookmarks, find-in-page, devtools, extensions UI,
     fullscreen, etc.).

### CLAUDE.md rules (the user's, verbatim)

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

## Privacy track (the user's task, verbatim)

> Next task for Neeko: privacy by default. No telemetry or usage data may ever
> be sent to Mozilla (or anyone else) from any browser built on Neeko,
> starting from the very first launch. Browsers built on Neeko must inherit
> this automatically, with no extra setup.
>
> RULES FOR THIS TASK
> - Do NOT edit Firefox's own default pref files (e.g. all.js, firefox.js) or
>   other Firefox files. All changes must live in Neeko's own layers (build
>   config, Neeko's prefs files, and only if truly necessary, small
>   clearly-marked patches) so Firefox updates stay easy.
> - Verify every pref and build flag name against the current Firefox source.
>   Don't trust pref lists from memory or AI chats; many are outdated or made
>   up.
>
> DO THESE STEPS ONE AT A TIME, EXPLAIN EACH IN PLAIN LANGUAGE, AND CHECK WITH
> ME BEFORE MOVING ON:
>
> 1. INVENTORY: Research every way current Firefox connects to Mozilla or
>    third-party services (telemetry, Glean, crash reporter,
>    studies/experiments, Remote Settings, Safe Browsing, captive portal and
>    connectivity checks, sponsored content/suggestions, Pocket, push service,
>    DNS-over-HTTPS defaults, geolocation, search suggestions, add-on updates,
>    app updates, anything else). Use Betterfox, arkenfox, LibreWolf, and Zen's
>    prefs as reference sources. Give me a table: what it is, what data it
>    sends, where, and whether it's tracking or a security feature. **Done:
>    `docs/privacy/inventory.md`.**
> 2. DECISIONS: Sort the table into three groups and wait for my approval:
>    - KILL: pure telemetry/tracking (disable completely)
>    - KEEP/REPLACE: security features (e.g. certificate revocation, malicious
>      extension blocklists, Safe Browsing), with options for keeping,
>      self-hosting, or making them opt-in, and the privacy vs. security
>      tradeoff of each
>    - LATER: things that will point to my own servers once I distribute (e.g.
>      app updates)
>
>    **Done: `docs/privacy/decisions.md`, approved as proposed on
>    2026-09-23.**
> 3. IMPLEMENT: Apply the approved decisions using build flags in mozconfig
>    and a dedicated Neeko privacy prefs file. Organize it with a comment on
>    every pref explaining what it does. Explain whether enterprise policies
>    (policies.json) are worth using and their downsides (e.g. "managed by
>    your organization" message).
>
>    **Done: `docs/privacy/implementation.md`.**
> 4. VERIFY: Create an automated privacy test that:
>    - launches the browser with a FRESH profile (first launch matters)
>    - routes all traffic through a local proxy (e.g. mitmproxy)
>    - idles for a few minutes, then visits a few normal websites
>    - lists every domain contacted and FAILS if any request goes to
>      telemetry/tracking endpoints from the KILL list
>
>    Also check about:telemetry and about:glean show nothing uploaded.
> 5. DOCUMENT:
>    - PRIVACY.md: every connection the browser makes and why, in plain
>      language, suitable for showing to users.
>    - Add to CLAUDE.md: after every Firefox version update, re-run the privacy
>      test and re-check the reference sources (Betterfox, LibreWolf, etc.) for
>      newly added telemetry. Any new feature added to Neeko must not introduce
>      outgoing connections without my approval.
>    - Add to ROADMAP.md: a later, separate item for protection against WEBSITE
>      tracking (tracking protection, fingerprinting resistance), since that's
>      a different problem from Mozilla telemetry.

## Open questions for the user

- **License for Neeko's own code.** `package.json` and `surfer.json` say
  MPL-2.0 as a placeholder; not confirmed.
- **How browsers get Neeko** (setup step 6): clone-and-build template, or a
  prebuilt runtime.
- **Branding:** currently Firefox's unofficial "Nightly" branding. Browsers
  built on Neeko set their own; Neeko just needs to make that easy.
- **Shipping needs its own launcher and packaging** (setup step 6). The
  prebuilt launcher calls itself Firefox and uses Firefox's profile folder,
  and `mach package` would leave out Neeko's pref files (see Lessons).

## Lessons learned

### Artifact builds

- **The C++/Rust comes prebuilt from Mozilla's official build.**
  - Compile-time gates are Mozilla's, and telemetry uploads are compiled on.
  - `StaticPrefList.yaml` edits do nothing; override prefs in pref files.
  - The binary must stay named `firefox`.
  - Mozilla's core expects Firefox-named GPU and media helper apps.
    `firefox-neeko.js` works around that.
- **The prebuilt launcher ignores the local `application.ini`.** It uses app
  data compiled into itself (`browser/app/nsBrowserApp.cpp`): vendor
  Mozilla, name Firefox, crash reporter on, Mozilla's update URL. So:
  - `Services.appinfo.name` is "Firefox", and the default profile folder is
    `~/Library/Application Support/Firefox/Profiles`, the user's real
    Firefox profiles. Always launch dev builds with their own profile
    (`make`, the test tools); shipped browsers need their own launcher
    (setup step 6).
  - Build flags only help by removing locally built code and programs:
    `--disable-updater` and `--disable-crashreporter` work that way.
  - Startup logs two harmless errors: the prebuilt core still lists
    `UpdateServiceStub.sys.mjs` and `CrashService.sys.mjs`, which those
    flags removed.
  - Dev bundles still contain Mozilla's `crashreporter.app` (artifact
    builds copy it). `mach run` disables it with `MOZ_CRASHREPORTER_DISABLE`,
    but direct launches don't.
- **`mach package` drops Neeko's pref files.**
  `browser/installer/package-manifest.in` lists default pref files by name.
  Shipping needs a small patch there or another packaging route (setup
  step 6).
- **The revision to download** is read from `engine/sourcestamp.txt`
  (`configs/common/mozconfig`).
- **`mk_add_options` only sets make variables.** The old
  `MOZ_TELEMETRY_REPORTING=` / `MOZ_DATA_REPORTING=` lines did nothing, and
  Surfer's `MOZ_APPUPDATE_HOST` export is ignored. Privacy step 3 replaced
  them with real `ac_add_options` flags.

### Surfer quirks

- It rewrites `surfer.json` formatting.
- It needs `src/` to exist.
- It creates an empty `tests/` folder.
- It writes the brand version (`1.0.0`) into Firefox's `version.txt`. Never
  use versions ending in `a1` or `b1`: artifact builds would then look for
  nightly or beta binaries.
- After exporting a patch, run `bun run surfer import`. That checks the patch
  applies cleanly and updates Surfer's patch count.

### Hide and plug

- **Chrome frames never deliver `load` to the embedding window.**
  `NeekoWindow` hooks the UI document through the `document-element-inserted`
  observer, then waits for that document's own `DOMContentLoaded`.
- **`frameElement.ownerGlobal` is undefined in module code.** Use
  `ownerDocument.defaultView`.
- **`#browser` is `position: relative`**, so the UI frame needs `z-index: 1`
  and the page area `z-index: 2`.
- **The CSP of `browser.xhtml` only allows `chrome:` frames.** That's why the UI
  is served as `chrome://neeko-ui/`, registered at runtime from the
  `neeko.ui.path` pref.
- **macOS window buttons** render wherever an element with
  `-moz-default-appearance: -moz-window-button-box` sits. Neeko exposes that as
  `[data-neeko-window-buttons]`.
- **Hit-testing checks out:** the UI background gets UI clicks, and the slot
  gets the remote page.
- **Measured with 300 tabs:** same memory and tab-switch time as stock Firefox,
  and faster to open tabs.

### Neeko API

- **`loadSubScript` returns the script's value only when asked.** Use
  `loadSubScriptWithOptions(url, { target, wantReturnValue: true })`.
  `neeko-api.js` evaluates to its install function, so it adds nothing else
  to the UI page's globals.
- **`gBrowser` appears at the browser window's `DOMContentLoaded`**
  (`Tabbrowser.create`). The UI page has always started after that (checked
  at startup and for new windows), but `connectAPI` still handles it
  starting first: the UI's calls wait in the unstarted `MessagePort`.
- **Sleeping tabs wake on most browser properties.** On a lazy tab (no
  `tab.linkedPanel`), reading `canGoBack` or `canGoForward` inserts the
  browser and loads the page. `currentURI` and `contentTitle` are safe.
- **Where the tab signals come from:** `TabAttrModified` with `label` or
  `busy` for title and loading; a tabs progress listener's
  `onLocationChange` for URL and back/forward; `TabBrowserInserted` and
  `TabBrowserDiscarded` for tabs waking and sleeping.
- **Events caused by a call arrive before its reply**, because they share one
  ordered port. Events from anything else (links, shortcuts) arrive a moment
  after the fact, so tests must wait for them.
- **Firefox's wish to focus its address bar is readable.** New tabs opened
  on the New Tab page get `gURLBar.getBrowserState(browser).urlbarFocused`
  set at `addTab`, and Firefox focuses the address bar when they're
  selected. Neeko turns that into the `addressbar` event at `TabSelect`.
- **Cmd+L is a command event** on `#Browser:OpenLocation`, handled by a
  listener on its parent `#mainCommandSet`. A listener on the command itself
  runs first and can `stopPropagation()`. Keys reach it even when focus is
  in the page or the UI frame.
- **Firefox's keyboard shortcuts keep working** (Cmd+T, Cmd+W, Ctrl+Tab,
  Cmd+[, Cmd+], Cmd+R). Before the Cmd+L fallback, Cmd+L logged a harmless
  `getBoxQuads` error from the hidden address bar measuring itself.

### Testing and debugging tools

- **API test:** `python3 tools/test_api.py` (after `make build`) launches the
  dev build with a fresh profile, a free Marionette port and a bare UI of
  its own, serves test pages from localhost, and runs `tools/test_api.js` in
  the browser window.
- **Driving the UI like a user needs care with Marionette.** Starting a
  Marionette session, and its own pointer and key actions, move focus into
  the web page. For UI tests, use one session, click with
  `window.synthesizeMouseEvent`, and type with `nsITextInputProcessor`
  (`beginInputTransactionForTests(window)`, then `keydown`/`keyup`), which
  goes to whatever really has focus. Hover-only controls need a `mousemove`
  first.

- **Marionette:** launch with `-marionette -remote-allow-system-access` and use
  `tools/marionette.py` to run JavaScript in the browser window or synthesize
  clicks.
- **Screenshots:** `screencapture -x -o -l <window id>`, with the window id
  from `CGWindowListCopyWindowInfo` (the process's on-screen layer-0 window).
  ruri's bridge can't see this app's window.
- **mach hides its output** when it detects an AI agent. To see verbose
  output, run it with `env -u AI_AGENT -u CLAUDE_CODE_ENTRYPOINT`.
- **The user has another Firefox build project (`toji`) on this machine.**
  Only ever kill processes under `/neeko/engine/obj-…` (as `make stop` does).
- **The privacy inventory's baseline capture** used a tiny logging proxy
  (not committed), and so did the step 3 check. The privacy test in step 4
  should use mitmproxy, as the task says.
- **Never run the privacy test through Marionette** (or set
  `remote.prefs.recommended=false`). Marionette applies its own "recommended
  prefs", which turn off telemetry, captive portal checks and more, hiding
  exactly the defaults under test. Reading default values with
  `Services.prefs.getDefaultBranch("")` is fine, since those prefs are user
  values.
