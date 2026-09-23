# The Neeko API

Your UI talks to Firefox through one global object, `neeko`. It's there
before your first script runs, in your UI page (`ui/index.html`) and nowhere
else. Web pages never get it.

This first version covers tabs and navigation, nothing more. Features get
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

## Fallbacks

Firefox keeps running underneath your UI, so a browser built on Neeko works
even where its UI has no controls yet.

- **Keyboard shortcuts** work as usual: Cmd+T, Cmd+W, Ctrl+Tab, Cmd+[ and
  Cmd+], Cmd+R.
- **The address bar.** If your UI doesn't listen for `addressbar`, Cmd+L
  shows Firefox's own navigation toolbar across the top of the window. It
  goes away again when it loses focus: after Enter, Escape, or a click
  elsewhere.
- **Permission prompts and other Firefox panels.** Camera, microphone and
  location prompts, password saving, add-on installs and notices like
  "add-on added" are Firefox's own. They hang from the top edge of the web
  page, just inside its corners: on the left for the address bar's prompts,
  on the right for the toolbar buttons' notices, and they follow the page
  if your UI moves it.
- **Fullscreen.** When a web page goes fullscreen (a video's fullscreen
  button, say), it fills the screen over your UI, and goes back into your
  content slot when it exits. Your UI stays loaded and its scripts keep
  running, but it isn't drawn meanwhile.

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
