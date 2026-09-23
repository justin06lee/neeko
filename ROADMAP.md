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

## API features, in order

1. [ ] **Camera, microphone, passwords and add-on installs.** Permission
   prompts are done (see Done); these doorhangers stay Firefox's for now,
   hanging from the top of the page. Camera and microphone prompts let the
   user pick a device inside Firefox's panel (`WebRTCParent.sys.mjs` reads
   the choice from it), so the API would need device lists; password saving
   and add-on installs show forms and permission lists.
2. [ ] **Favicons, by reference.** Each tab's icon as a URL the UI can put
   in an `<img>`, never image data copied through the API.
3. [ ] **Context menus.** The UI can draw its own menu for pages, links,
   images and selections, with Firefox's actions available. Fallback:
   Firefox's own context menu.
4. [ ] **Find in page.** Find, next, previous, match count. Fallback:
   Firefox's find bar.
5. [ ] **Address bar suggestions.** History, bookmark and open-tab matches
   for what the user types, and search suggestions, fetched only when the
   UI asks (search suggestions send what you type to the search engine,
   which is why they're off in Firefox's hidden address bar).
6. [ ] **History.** Search and list visits, delete entries.
7. [ ] **Bookmarks.** Read, add, edit, remove, with change events.
8. [ ] **Tab sleeping.** Unload a tab to save memory, and a `sleeping`
   field on tabs. Needed for "a bajillion tabs".
9. [ ] **Tab previews, by reference.** Thumbnails the UI shows without
   copying image data.
10. [ ] **Extensions UI.** List extensions' toolbar buttons, show their
    badges and open their popups from the UI. Today: extensions work, but
    their buttons live in the hidden toolbar.
11. [ ] **DevTools.** Open and close DevTools for the page, and the Browser
    Toolbox for the UI (dev builds already allow it).
12. [ ] **Performance test with a budget.** Automated: hundreds of tabs,
    memory and tab-switch time, measured against stock Firefox, failing
    when Neeko gets slower.
13. [ ] **"Trick" mode.** Run the UI as a sandboxed, unprivileged page that
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
- **Neeko's name and branding** beyond the placeholder: the demo app is
  "Neeko" with an icon made from the README banner's fox mask.
- **Publishing Neeko:** creating a GitHub repo and pushing. Until then,
  browsers use a local path as the submodule URL.
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
