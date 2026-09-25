# Roadmap

API features to add, one at a time, most essential first. Each one ships
with a fallback (Firefox's own behavior while no UI listens), a section in
[docs/api.md](docs/api.md), a demo in the demo UI (`ui/`), and checks in
`tools/test_api.js` ([CLAUDE.md](CLAUDE.md) has the rules). The order is a
recommendation: the user's browser decides what comes next, since features
get added as it needs them.

"Today" notes what happens without the feature, as of Firefox 156.0.1.

## Done

- [x] **Tabs and navigation** (v0.1.0): list, open, close, select, change
  events; go, back, forward, reload, URL, title, loading state.
- [x] **Address bar requests** (v0.1.0): Cmd+L and new New Tab pages ask the
  UI's address bar; Firefox's own address bar is the fallback.
- [x] **Firefox's own fallbacks under a custom UI** (v0.1.1): web page
  fullscreen fills the screen; permission prompts and other panels hang
  from the top of the page; the downloads panel opens when a download
  starts.
- [x] **Permission prompts** (v0.2.0): location, notifications, storage, VR, MIDI,
  local network: the UI gets the request and answers it, with Firefox's
  delay against clickjacking. Fallback: Firefox's own prompt.
- [x] **Fullscreen** (v0.2.0): the UI hears when a page or the window goes
  fullscreen, can lay out page fullscreen itself, and can exit it or make
  the window fullscreen. Fallback: the page fills the screen over the UI.
- [x] **Downloads** (v0.2.0): list, progress, open, show in Finder, cancel, retry,
  remove, and start, update and remove events. Fallback: Firefox's
  downloads panel.
- [x] **Tabs, round two** (v0.3.0): each tab's icon by reference (a `blob:`
  URL shared by tabs with the same icon, never image data), whether it plays
  sound or is muted, whether it crashed, and the error page Firefox shows in
  its place; open in the background or at a position, duplicate, move,
  mute, hand the keys to the page, and `neeko.platform`. Fallbacks:
  Firefox's own error and crashed tab pages, and its shortcuts.
- [x] **UI drawn over the web page** (v0.4.0): elements the UI marks
  `data-neeko-overlay` (menus, a sidebar sliding out, its own error page)
  are drawn over the page, shadows included, and take the pointer there,
  while the rest of the page stays visible and live. Fallback: the page
  stays on top.
- [x] **UI settings and the color scheme** (v0.5.0): the UI's own settings,
  saved, the same in every window, readable before its first paint, with
  change events; and light, dark or the system's color scheme for web
  pages, Firefox's own pages and panels, and the UI's
  `prefers-color-scheme`. Fallback: no settings, and the system's color
  scheme.

## API features, in order

The first four are what Toji, the user's browser, asked for next, in its
order (2026-09-25).

1. [ ] **Bookmarks**, the bookmarks toolbar first: list (with icons, by
   reference), add, remove, change events, and whether a URL is bookmarked.
2. [ ] **The browser's own pages.** A start page (the New Tab page and home
   page) and later settings pages, as ordinary pages from the app folder in
   tabs, with a small, safe API of their own: go where the user typed, open
   a tab, the UI settings, the search engines. These run in web content
   processes, so what they get needs the user's approval first (the rule
   that web pages never reach the API).
3. [ ] **Pointer at the page's edges.** Events when the pointer reaches the
   page's top edge or the window's left edge, where the page covers the
   window, so the UI can peek a bar or a sidebar out.
4. [ ] **Tab groups**, Firefox's own: list groups (name, color, collapsed),
   each tab's group, create, rename, collapse, ungroup, move tabs in and
   out, with events.
5. [ ] **Camera, microphone, passwords and add-on installs.** Permission
   prompts are done (see Done); these doorhangers stay Firefox's for now,
   hanging from the top of the page. Camera and microphone prompts let the
   user pick a device inside Firefox's panel (`WebRTCParent.sys.mjs` reads
   the choice from it), so the API would need device lists; password saving
   and add-on installs show forms and permission lists.
6. [ ] **Context menus.** The UI can draw its own menu for pages, links,
   images and selections, with Firefox's actions available. Fallback:
   Firefox's own context menu.
7. [ ] **Find in page.** Find, next, previous, match count. Fallback:
   Firefox's find bar.
8. [ ] **Address bar suggestions.** History, bookmark and open-tab matches
    for what the user types, and search suggestions, fetched only when the
    UI asks (search suggestions send what you type to the search engine,
    which is why they're off in Firefox's hidden address bar).
9. [ ] **History.** Search and list visits, delete entries.
10. [ ] **Tab sleeping.** Unload a tab to save memory, and a `sleeping`
    field on tabs. Needed for "a bajillion tabs".
11. [ ] **Tab previews, by reference.** Thumbnails the UI shows without
    copying image data (the way tab icons work).
12. [ ] **Extensions UI.** List extensions' toolbar buttons, show their
    badges and open their popups from the UI. Today: extensions work, but
    their buttons live in the hidden toolbar.
13. [ ] **DevTools.** Open and close DevTools for the page, and the Browser
    Toolbox for the UI (dev builds already allow it).
14. [ ] **Performance test with a budget.** Automated: hundreds of tabs,
    memory and tab-switch time, measured against stock Firefox, failing
    when Neeko gets slower.
15. [ ] **"Trick" mode.** Run the UI as a sandboxed, unprivileged page that
    can only use the API. The API is already messages of plain data, so
    this swaps the channel, not the calls.

## Privacy

- [ ] **Protection from website tracking.** A separate problem from Mozilla
  telemetry, which is done: this is about what websites and their trackers
  learn. Tracking protection strictness (Firefox's standard mode is on
  today), fingerprinting resistance, cookie isolation, and speculative
  connections and prefetch (#23 in the privacy inventory, left alone so far).
  Research what Firefox 156 offers, compare Betterfox, arkenfox and
  LibreWolf, and propose defaults with their trade-offs (some sites break
  under strict settings).

## Shipping (for when browsers are distributed)

- [ ] **Signing and notarization** for macOS, with the browser's own Apple
  Developer ID, in `make release`.
- [ ] **Updates** from the browser's own update server (app updates are
  compiled out today; Surfer can generate update manifests).
- [ ] **Crash reports** to a self-hosted server, if wanted (compiled out
  today).
- [ ] **Safe Browsing** with the browser's own Google API key, if wanted
  (off today: no key, so no phishing and malware warnings).
- [ ] **Linux and Windows builds** (untested so far).

## Open decisions (the user's)

- **Neeko's license.** `package.json` says MPL-2.0 as a placeholder, the same
  as Firefox's. Not confirmed.
- **Neeko's name and branding** beyond the placeholder. The README shows
  the golden ring icon (light mode) and the blue butterfly (dark mode); both are in `assets/` in macOS app icon shape. The demo app itself
  still has the placeholder fox-mask icon (`branding/`). If the icons'
  artwork is someone else's, using it publicly needs their permission.
- **Making Neeko public.** It's on GitHub as a private repo
  (github.com/justin06lee/neeko, since 2026-09-24); browsers use it as
  their submodule URL. Public depends on the license and branding above.
- **Remote Settings filtering** (recommended: leave as is). Firefox's
  Remote Settings keeps about 35 data collections fresh, not just the
  security lists: search engine config, website compatibility fixes,
  password-form rules, some New Tab data. They come from the same host as
  the security lists in the same requests, sending nothing about you, so
  filtering them would save downloads, not privacy. It would take a patch
  to Firefox's Remote Settings code, as LibreWolf does.
- **Firefox Suggest if a region is set** (recommended: leave as is). If a
  user or a browser sets `browser.search.region` to the US, UK, Germany,
  France or Italy, Firefox turns on Suggest in its own (fallback) address
  bar at runtime, over Neeko's defaults. Region detection is off, so this
  only happens by choice, and custom address bars don't use it. Blocking it
  anyway would mean Neeko fighting Firefox's runtime prefs.
- **Firefox Labs** (decided: no policy for now). Only an enterprise policy
  turns it off, which would show "managed by your organization". It enrolls
  in nothing unless the user opts in from Settings.
