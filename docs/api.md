# The Neeko API

Your UI talks to Firefox through one global object, `neeko`. It's there
before your first script runs, in your UI page (`ui/index.html`) and nowhere
else. Web pages never get it.

So far it covers tabs, navigation, permission prompts, fullscreen and
downloads. Features get
added one at a time as browsers built on Neeko need them. The demo UI in
`ui/` uses every one of them.

```js
let tabs = await neeko.tabs.list();
neeko.tabs.on("update", ({ tab, changed }) => redraw(tab));
await neeko.tabs.open("example.com");
await neeko.nav.back();
```

## The basics

- **Every method returns a promise.** It resolves once Firefox has done the
  thing (started a load, switched a tab), or rejects with an `Error` whose
  message says what was wrong, such as `No tab with id 7 in this window.`
- **Everything is plain data.** Tabs are plain objects, snapshots taken at the
  moment they were sent. They don't update themselves; events tell you what
  changed.
- **Tabs are identified by `id`**, a number that stays the same for the
  tab's whole life, even if your UI reloads.
- **Leave out the tab id to mean the selected tab.** Every method that takes
  a tab id works this way, except `select`.
- **Each window is separate.** A UI sees and controls only its own window's
  tabs.
- **Events and replies arrive in order.** Events caused by a call arrive
  before its reply. So the usual pattern is safe: subscribe to events, call
  `list()` once, then apply events as they come.
- **Listening means "my UI handles this".** Neeko only sends the events your
  UI listens for. Where a feature has a fallback, Firefox's own version
  steps in only while nobody listens (see [Fallbacks](#fallbacks)).

## Tabs

A tab looks like this:

```js
{
  id: 3,
  url: "https://example.com/",  // without any user:password@ part
  title: "Example Domain",      // what Firefox would show on the tab
  loading: false,
  canGoBack: true,
  canGoForward: false,
  selected: true,
}
```

The URL of a new tab is `about:newtab` until the user goes somewhere. Tabs
that are asleep (restored from the last session but never opened, or unloaded
to save memory) report `canGoBack` and `canGoForward` as false; finding out
would wake them.

`canGoBack` is Firefox's own answer, the same as its Back button: it skips
pages the user never clicked, typed or scrolled in, so a tab that went from
one untouched page to another can't go back.

### Methods

| Method | What it does |
| --- | --- |
| `neeko.tabs.list()` | All tabs in this window, in order. |
| `neeko.tabs.current()` | The selected tab. |
| `neeko.tabs.open(url?)` | Opens a tab at the end and selects it. `url` is anything a user could type in an address bar (see `nav.go`). With no `url`, it opens the New Tab page, like Cmd+T. Resolves to the new tab. |
| `neeko.tabs.close(tabId?)` | Closes a tab. Closing the last one closes the window, as in Firefox. |
| `neeko.tabs.select(tabId)` | Switches to a tab. |
| `neeko.tabs.on(event, listener)` | Listens for an event. Returns a function that stops listening. Unknown event names throw. |

### Events

| Event | Data | When |
| --- | --- | --- |
| `open` | `{ tab, index }` | A tab opened, at position `index`. Tabs can open without your UI asking (links, Cmd+T), so always handle this. |
| `close` | `{ id }` | A tab closed. |
| `select` | `{ id, previousId }` | The selected tab changed. |
| `move` | `{ id, index }` | A tab moved to position `index`. |
| `update` | `{ tab, changed }` | A tab's URL, title, loading state, or back/forward availability changed. `changed` lists which fields, such as `["title"]`. |

## Navigation

Each method acts on the tab you name, or on the selected tab if you don't.

### Methods

| Method | What it does |
| --- | --- |
| `neeko.nav.go(input, tabId?)` | Loads what a user typed into an address bar. Firefox turns it into a URL the way its own address bar would: `example.com` becomes `https://example.com/` (or `http://` where needed), and anything that isn't a web address becomes a search with the default search engine. |
| `neeko.nav.back(tabId?)` | Goes back, if the tab can. |
| `neeko.nav.forward(tabId?)` | Goes forward, if the tab can. |
| `neeko.nav.reload(tabId?)` | Reloads the page. |
| `neeko.nav.on(event, listener)` | Listens for an event, as `tabs.on` does. |

The current URL, title and loading state are fields of each tab: read them
from `tabs.current()` and follow them with `update` events.

### Events

| Event | Data | When |
| --- | --- | --- |
| `addressbar` | `{}` | The user wants the address bar: they pressed Cmd+L or chose File > Open Location, or a new tab opened on the New Tab page. Focus yours. |

Neeko never moves keyboard focus into your UI by itself; this event is your
cue.

## Permission prompts

When a site asks for a permission (your location, say), your UI can ask the
user itself. Listen for `open`, and Firefox's own prompt stays closed.

```js
neeko.prompts.on("open", ({ prompt }) => show(prompt));
neeko.prompts.on("close", ({ id }) => hide(id));
// The user clicks the prompt's second button, "Block":
await neeko.prompts.answer(prompt.id, 1, { remember: true });
```

A prompt looks like this:

```js
{
  id: 4,
  tabId: 2,                     // the tab whose page asks
  kind: "location",
  origin: "maps.example.com",   // who asks, as Firefox shows it
  message: "Allow maps.example.com to access your location?",
  hint: "",                     // extra text some prompts have
  learnMoreURL: "https://www.mozilla.org/en-US/firefox/geolocation/",  // or null
  actions: [{ label: "Allow" }, { label: "Block" }],
  remember: { label: "Remember this decision", checked: false },       // or null
}
```

The kinds are `location`, `notifications`, `persistent-storage`,
`storage-access` (a site embedded in another asking for its cookies), `vr`,
`midi`, `local-network` and `localhost` (a site asking to reach devices on
your network, or your own computer). The labels and message are Firefox's
own, in the user's language. The first action is the main one, which
Firefox's prompt highlights.

Prompts can come from any tab, including ones in the background: show
them when their tab is selected, or mark the tab. A prompt waits until it's
answered, or until Firefox closes it because its page went away.

### Methods

| Method | What it does |
| --- | --- |
| `neeko.prompts.list()` | The prompts waiting in this window, in every tab, oldest first. |
| `neeko.prompts.answer(promptId, action, options?)` | Answers a prompt as a click on one of Firefox's buttons would. `action` is an index into its `actions`. Pass `{ remember: true }` to check its remember box, if it has one. |
| `neeko.prompts.on(event, listener)` | Listens for an event, as `tabs.on` does. |

**Wait before allowing.** Like Firefox's own buttons, actions that grant
something only work once the prompt has been up for half a second (the
`security.notification_enable_delay` pref), counted again whenever its tab
is selected or the window is brought forward, and only while the window is
active. Earlier answers are refused with an error that says how long to
wait. It stops a page from making a prompt appear just as the user clicks
where "Allow" will be. Show your buttons disabled for that long. Blocking
works right away.

### Events

| Event | Data | When |
| --- | --- | --- |
| `open` | `{ prompt }` | A site asks for a permission. Listening for this is how your UI says it shows prompts itself. |
| `close` | `{ id }` | A prompt is gone: answered, or its page closed or went elsewhere. |

Camera, microphone and screen sharing prompts stay Firefox's (the user picks
a device in them), and so do password saving and add-on installs. They
appear hanging from the top of the page (see [Fallbacks](#fallbacks)).

## Fullscreen

Two things can be fullscreen: a web page (a video's fullscreen button), and
the window itself (the green button, or Ctrl+Cmd+F). A page going
fullscreen makes the window fullscreen too.

```js
neeko.fullscreen.on("page", ({ fullscreen }) =>
  document.body.classList.toggle("page-fullscreen", fullscreen)
);
```

While a page is fullscreen, Neeko makes it fill the window over your UI.
Listen for `page` and your UI does that instead: make your content slot
cover the window (and animate it, if you like), and the page follows it as
always. Your UI stays drawn, so anything outside the slot still shows.

### Methods

| Method | What it does |
| --- | --- |
| `neeko.fullscreen.state()` | `{ page, window }`: whether a web page is fullscreen, and whether the window is. |
| `neeko.fullscreen.exit()` | Ends page fullscreen, as Escape does. Resolves once it's over. |
| `neeko.fullscreen.setWindow(fullscreen)` | Makes the window fullscreen (`true`) or not (`false`), like View > Enter Full Screen. |
| `neeko.fullscreen.on(event, listener)` | Listens for an event, as `tabs.on` does. |

### Events

| Event | Data | When |
| --- | --- | --- |
| `page` | `{ fullscreen }` | A web page went fullscreen, or left it. Listening for this is how your UI says it lays page fullscreen out itself. |
| `window` | `{ fullscreen }` | The window went fullscreen, or left it. On macOS its window buttons are gone meanwhile. |

## Downloads

The window's downloads, the same list Firefox's downloads panel and
Library window show (private ones in a private window). Listen for `start`
and Firefox's downloads panel no longer opens when a download starts: your
UI shows it instead.

```js
neeko.downloads.on("start", ({ download }) => add(download));
neeko.downloads.on("update", ({ download }) => redraw(download));
```

A download looks like this:

```js
{
  id: 5,
  url: "https://example.com/report.pdf",   // where it's from
  filename: "report.pdf",
  path: "/Users/you/Downloads/report.pdf",  // where it goes
  state: "downloading",   // or "paused", "done", "failed", "canceled", "blocked"
  received: 1200000,      // bytes so far; once done, the file's size
  total: 4000000,         // or null if the site didn't say
  speed: 350000,          // bytes per second, Firefox's estimate
  startTime: 1790000000000,
  error: null,            // why it failed: "network", "file" or "other"
}
```

`update` comes whenever something changes, at most every 400 milliseconds
for progress (Firefox's own pace). `paused` downloads were paused from
Firefox's panel or Library window; retrying resumes them.

### Methods

Every method but `list` takes a download's `id`.

| Method | What it does |
| --- | --- |
| `neeko.downloads.list()` | Every download in the list, oldest first. |
| `neeko.downloads.open(downloadId)` | Opens the downloaded file, with the app the system would use (or Firefox, for files it shows itself, like PDFs). Rejects if the download isn't done. |
| `neeko.downloads.show(downloadId)` | Shows the file in Finder. |
| `neeko.downloads.cancel(downloadId)` | Stops a download and deletes what it had so far. |
| `neeko.downloads.retry(downloadId)` | Starts a failed, canceled or paused download again. |
| `neeko.downloads.remove(downloadId)` | Takes a download off the list and out of history. The file stays. |
| `neeko.downloads.on(event, listener)` | Listens for an event, as `tabs.on` does. |

### Events

| Event | Data | When |
| --- | --- | --- |
| `start` | `{ download }` | A download started. Listening for this is how your UI says it shows downloads itself. |
| `update` | `{ download }` | A download progressed, finished, failed or was canceled. |
| `remove` | `{ id }` | A download left the list. |

## Fallbacks

Firefox keeps running underneath your UI, so a browser built on Neeko works
even where its UI has no controls yet.

- **Keyboard shortcuts** work as usual: Cmd+T, Cmd+W, Ctrl+Tab, Cmd+[ and
  Cmd+], Cmd+R.
- **The address bar.** If your UI doesn't listen for `addressbar`, Cmd+L
  shows Firefox's own navigation toolbar across the top of the window. It
  goes away again when it loses focus: after Enter, Escape, or a click
  elsewhere.
- **Permission prompts and other Firefox panels.** If your UI doesn't
  listen for `prompts` `open`, permission prompts are Firefox's own, and
  so are, always, camera and microphone prompts, password saving, add-on
  installs and notices like "add-on added". They hang from the top edge of
  the web page, just inside its corners: on the left for the address bar's
  prompts, on the right for the toolbar buttons' notices, and they follow
  the page if your UI moves it. If your UI stops listening while prompts are
  waiting, Firefox's prompt shows them.
- **Downloads.** If your UI doesn't listen for `downloads` `start`, Firefox's
  downloads panel opens at the top right of the web page when a download
  starts, with its progress. Cmd+Shift+Y always shows every download, in
  Firefox's Library window.
- **Fullscreen.** If your UI doesn't listen for `fullscreen` `page`, a web
  page that goes fullscreen (a video's fullscreen button, say) fills the
  screen over your UI, and goes back into your content slot when it exits.
  Your UI stays loaded and its scripts keep running, but it isn't drawn
  meanwhile.

## Security

The API can do anything your browser's UI can, so Neeko only ever hands it
to your UI page: the page Neeko loads from `ui/` into the window's own UI
frame. Web pages run in separate processes and have no way to reach it.
Every call's input is checked before Firefox acts on it.

Stick to `neeko` in your UI code. For now your UI runs with Firefox's own
privileges (see below), so other Firefox internals happen to be reachable,
but they won't be when UIs can run sandboxed.

## How it works

Every call is a message. `neeko.tabs.open("example.com")` sends

```js
{ id: 12, method: "tabs.open", params: ["example.com"] }
```

and Firefox answers with `{ id: 12, result: { ...the tab } }` or
`{ id: 12, error: { message } }`. Events are messages too:
`{ event: "tabs.update", data: { tab, changed } }`. Only plain data crosses,
never live Firefox objects. When your UI adds its first listener for an
event, or removes its last, `neeko` sends
`{ method: "events.listen", params: ["tabs.update", true] }` (or `false`),
which is how Neeko knows what to send and when to fall back.

Right now your UI runs inside Firefox's own window process ("Become" mode),
and the messages travel over a `MessageChannel`. Messages mean a sandboxed
mode ("Trick") can come later, with your UI in a locked-down page, without
changing any of your calls: only the channel underneath changes.

The pieces:

- `src/browser/neeko/neeko-api.js` is the `neeko` object your UI sees. Neeko
  runs it in your page before your scripts.
- `src/browser/neeko/NeekoAPI.sys.mjs` is Firefox's side. It carries out the
  calls and watches the tabs for events.
- `src/browser/neeko/NeekoWindow.sys.mjs` connects the two when your UI
  loads, and handles Cmd+L and its fallback.

## Testing

```sh
make build
python3 tools/test_api.py
```

This launches the dev build with a fresh profile and a bare test UI of its
own (so it doesn't depend on what's in `ui/`), serves a few test pages from
localhost (no internet needed), and drives every method and event through
`neeko`. That includes checks that web pages can't see it, that sleeping tabs
stay asleep, and that the address bar fallback appears only when nobody
listens.
