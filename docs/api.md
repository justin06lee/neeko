# The Neeko API

Your UI talks to Firefox through one global object, `neeko`. It's there
before your first script runs, in your UI page (`ui/index.html`) and nowhere
else. Web pages never get it.

So far it covers tabs and tab groups, navigation, permission prompts, fullscreen,
downloads, bookmarks, your UI's settings and the color scheme, find in page,
drawing over the page, the pointer at the page's edges, and your browser's own pages
(which get a small API of their own, `neekoPage`). And Firefox's own UI,
where it still shows, can take your browser's look (see
[Firefox's own UI, in your look](#firefoxs-own-ui-in-your-look)). Features get
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
  UI listens for (settings and color scheme changes always come, since
  `neeko` keeps its copy of them current). Where a feature has a fallback, Firefox's own version
  steps in only while nobody listens (see [Fallbacks](#fallbacks)).
- **Options are checked.** Methods that take an options object reject
  options they don't know, so a typo fails loudly instead of doing nothing.

`neeko.platform` says which system the browser runs on: `"macos"`,
`"windows"` or `"linux"`. It's there at once, not a promise, so your UI can
lay itself out before it first draws (room for macOS's window buttons, say).

## Tabs

A tab looks like this:

```js
{
  id: 3,
  url: "https://example.com/",  // without any user:password@ part
  title: "Example Domain",      // what Firefox would show on the tab
  icon: "blob:chrome://neeko-ui/5f3c…",  // or null
  loading: false,
  canGoBack: true,
  canGoForward: false,
  selected: true,
  audible: false,               // playing sound
  muted: false,
  crashed: false,               // its content process went away
  error: null,                  // or { page: "neterror", code: "dnsNotFound" }
  groupId: null,                // the tab group it's in (see Tab groups)
}
```

The URL of a new tab is `about:newtab` until the user goes somewhere. Tabs
that are asleep (restored from the last session but never opened, or unloaded
to save memory) report `canGoBack` and `canGoForward` as false; finding out
would wake them.

`canGoBack` is Firefox's own answer, the same as its Back button: it skips
pages the user never clicked, typed or scrolled in, so a tab that went from
one untouched page to another can't go back.

**`icon`** is a URL to put in an `<img>`, never the image itself. Firefox
keeps most icons as `data:` URLs (the whole image, often many kilobytes), so
Neeko hands your UI a short `blob:` URL for the same image instead. Tabs with
the same icon share one URL, so each icon loads once however many tabs show
it. A URL stays valid while a tab shows its icon; once none does, it stops
working, so don't keep old ones. SVG icons Firefox draws in the page's own
process, never in your UI's, and hands over as a picture, so for a moment
after one arrives a tab's `icon` can still be `null`: an `update` follows.
Icons Firefox has as ordinary URLs (`chrome://`, for its own pages) come as
they are. `null` means the page has no icon (yet): show your own default.

**`audible`** follows Firefox's speaker icon: it goes on when the page plays
sound, and off a moment after it stops. A muted tab can still be `audible`.

**`crashed`** means the tab's content process went away (it crashed, or ran
out of memory). Firefox shows its "Gah. Your tab just crashed." page in the
tab. `nav.reload()` brings the tab back, as that page's Restore This Tab
button does.

**`error`** is set while Firefox shows one of its error pages in place of the
page, and `url` is the address that failed. `page` is which error page:
`neterror` (the connection failed: `dnsNotFound`, `connectionFailure`,
`netTimeout`, `netOffline` and so on), `certerror` (the site's certificate
isn't trusted), `blocked` (Safe Browsing), `httpsonlyerror` or
`restricted`; `code` is Firefox's own name for what went wrong. Your UI can
draw its own error page from these. Firefox's page is there meanwhile,
working, in the page area.

### Methods

| Method | What it does |
| --- | --- |
| `neeko.tabs.list()` | All tabs in this window, in order. |
| `neeko.tabs.current()` | The selected tab. |
| `neeko.tabs.open(url?, options?)` | Opens a tab and selects it. `url` is anything a user could type in an address bar (see `nav.go`). With no `url` (or `null`), it opens the New Tab page, like Cmd+T. Resolves to the new tab. Options below. |
| `neeko.tabs.duplicate(tabId?, options?)` | Opens a copy of a tab right after it, with its page and history, and selects it. Pass `{ background: true }` to leave the selection alone. Resolves to the copy. |
| `neeko.tabs.move(index, tabId?)` | Moves a tab to position `index` (0 is the first). Firefox keeps pinned tabs first, and a position past the end means the end. A position among a group's tabs puts it in that group, as dragging it there in Firefox would. |
| `neeko.tabs.setMuted(muted, tabId?)` | Mutes (`true`) or unmutes (`false`) a tab. |
| `neeko.tabs.setGroup(groupId, tabId?)` | Puts a tab at the end of a tab group, or with `null` takes it out of its group, to just after the group. Pinned tabs can't be in a group. |
| `neeko.tabs.focus()` | Puts keyboard focus in the selected tab's page, as clicking it would. Call it when your address bar is done: after Escape, say. |
| `neeko.tabs.close(tabId?)` | Closes a tab. Closing the last one closes the window, as in Firefox. |
| `neeko.tabs.select(tabId)` | Switches to a tab. |
| `neeko.tabs.on(event, listener)` | Listens for an event. Returns a function that stops listening. Unknown event names throw. |

`open`'s options:

| Option | What it does |
| --- | --- |
| `background: true` | Opens the tab without selecting it. |
| `index: n` | Opens it at position `n`, such as right after the selected tab. By default it goes at the end. |
| `addressbar: false` | A New Tab page opened in front doesn't ask for the address bar (no `addressbar` event), and the keyboard focus stays where it is, for a UI that wants the keys itself. |

A tab opened in front on a web address gets the keyboard focus, as in
Firefox; one on the New Tab page asks for the address bar instead.

### Events

| Event | Data | When |
| --- | --- | --- |
| `open` | `{ tab, index }` | A tab opened, at position `index`. Tabs can open without your UI asking (links, Cmd+T), so always handle this. |
| `close` | `{ id }` | A tab closed. |
| `select` | `{ id, previousId }` | The selected tab changed. |
| `move` | `{ id, index }` | A tab moved to position `index`. |
| `update` | `{ tab, changed }` | Anything in a tab's description changed but `selected`: its URL, title, icon, loading state, back/forward availability, sound, crash, error page or group. `changed` lists which fields, such as `["title", "icon"]`. |

## Tab groups

Firefox's own tab groups: named, colored sets of tabs that sit together in
the window's tabs and can be collapsed. They're saved with the session.

```js
let group = await neeko.groups.create([tab1.id, tab2.id], { name: "Reading" });
await neeko.groups.update(group.id, { collapsed: true });
```

A group looks like this:

```js
{
  id: "1790000000000-42",  // stays the same for the group's life
  name: "Reading",         // "" if the user didn't name it
  color: "purple",
  collapsed: false,
}
```

Its tabs are the ones whose `groupId` is its `id`, always next to each
other in `tabs.list()`, so draw the group's header before the first of
them. A collapsed group's tabs are still listed; Firefox shows only the
selected one of them, if any. The colors are `blue`, `purple`, `cyan`,
`orange`, `yellow`, `pink`, `green`, `gray` and `red`: draw them however
you like.

| Method | What it does |
| --- | --- |
| `neeko.groups.list()` | This window's groups, in the order they appear. |
| `neeko.groups.create(tabIds, options?)` | Makes a group of these tabs, gathered where the first of them is. Options: `name`, and `color` (by default one no other group uses). Resolves to the group. |
| `neeko.groups.update(groupId, changes)` | Changes `name` or `color`, or `collapsed`: `true` collapses it, `false` expands it. Resolves to the group. |
| `neeko.groups.ungroup(groupId)` | Ends the group. Its tabs stay where they are, in no group. |
| `neeko.groups.on(event, listener)` | Listens for an event, as `tabs.on` does. |

`tabs.setGroup(groupId, tabId?)` moves a tab into or out of a group (see
Tabs).

| Event | Data | When |
| --- | --- | --- |
| `create` | `{ group }` | A group was made, by your UI or otherwise (a restored session). Its tabs follow, each with a tabs `update` for its `groupId`. |
| `remove` | `{ id }` | A group is gone: ungrouped, or its last tab closed or left it. |
| `update` | `{ group, changed }` | Its name, color or collapsed state changed; `changed` says which. |

Tabs joining or leaving a group arrive as tabs `update` events with
`groupId` among the changes.

## Navigation

Each method acts on the tab you name, or on the selected tab if you don't.

### Methods

| Method | What it does |
| --- | --- |
| `neeko.nav.go(input, tabId?)` | Loads what a user typed into an address bar. Firefox turns it into a URL the way its own address bar would: `example.com` becomes `https://example.com/` (or `http://` where needed), and anything that isn't a web address becomes a search with the default search engine. |
| `neeko.nav.back(tabId?)` | Goes back, if the tab can. |
| `neeko.nav.forward(tabId?)` | Goes forward, if the tab can. |
| `neeko.nav.reload(tabId?)` | Reloads the page. A crashed tab comes back, with its history. |
| `neeko.nav.on(event, listener)` | Listens for an event, as `tabs.on` does. |

The current URL, title and loading state are fields of each tab: read them
from `tabs.current()` and follow them with `update` events.

### Events

| Event | Data | When |
| --- | --- | --- |
| `addressbar` | `{}` | The user wants the address bar: they pressed Cmd+L or chose File > Open Location, or a new tab opened on the New Tab page. Focus yours and select its text, as Firefox does. |

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

## Settings

Your UI's own settings (a theme, a layout, whether a sidebar is open):
saved in the profile, the same in every window, and there without waiting
when a window's UI starts.

```js
let layout = neeko.settings.get("layout") ?? "top";   // at once, no promise
await neeko.settings.set("layout", "side");
neeko.settings.on("change", ({ key, value }) => apply(key, value));
```

Read them in a plain `<script>` in your page's `<head>` (not a module,
which runs later) and your UI's first paint is already right, so a new
window never flashes the wrong layout. The demo UI's `ui/early.js` does
that.

Names are 1 to 64 letters, digits, `-` or `_`. Values are strings (up to
4096 characters), `true` or `false`, or whole numbers; store anything
bigger or more structured some other way. `get` returns `undefined` for a
setting that isn't there.

| Method | What it does |
| --- | --- |
| `neeko.settings.get(key)` | A setting's value, or `undefined`. At once. |
| `neeko.settings.all()` | Every setting, as `{ key: value }`. At once. |
| `neeko.settings.set(key, value)` | Saves a setting for every window. `null` removes it. Resolves once saved; by then `get` already returns the new value. |
| `neeko.settings.on(event, listener)` | Listens for an event, as `tabs.on` does. |

| Event | Data | When |
| --- | --- | --- |
| `change` | `{ key, value }` | A setting changed, in this window or another (or in about:config). `value` is `null` if it was removed. |
| `request` | `{}` | The user asked for your browser's settings: Cmd+, or Settings… in the app menu. Show yours (open your settings page, say). Listening for this is how your UI says it has settings of its own; otherwise Firefox's open. |

```js
// Cmd+, opens the browser's own settings page.
neeko.settings.on("request", () => neeko.tabs.open("about:mybrowser-settings"));
```

Firefox's settings stay reachable by their address, `about:preferences`.

Settings are Firefox prefs named `neeko.settings.<key>`. Your browser can
ship defaults for them in its `branding/prefs.js`, such as
`pref("neeko.settings.layout", "side");`; removing a setting with `null`
goes back to that default.

## Color scheme

Makes web pages, Firefox's own pages and panels, and your UI's own
`prefers-color-scheme` light or dark, or follow the system's setting again,
in every window:

```js
await neeko.colorScheme.set("dark");   // "light", "dark" or "system"
neeko.colorScheme.get();               // "dark", at once
```

It's saved, and it's in effect before your UI's first paint, so a UI that
styles itself with `@media (prefers-color-scheme: …)` is right from the
start and follows every change on its own (the demo UI's `style.css` does
this). Web pages that support dark mode switch as you change it.

| Method | What it does |
| --- | --- |
| `neeko.colorScheme.get()` | `"light"`, `"dark"`, or `"system"` when the system's setting applies. At once. |
| `neeko.colorScheme.set(scheme)` | Sets it for everything, in every window. |
| `neeko.colorScheme.on(event, listener)` | Listens for an event, as `tabs.on` does. |

| Event | Data | When |
| --- | --- | --- |
| `change` | `{ colorScheme }` | It changed, in this window or another. |

It's Firefox's `ui.systemUsesDarkTheme` pref, which stands in for the
system's light or dark setting. A Firefox theme with a color scheme of its
own, if the user installs one, still wins in its windows.

## Bookmarks

Firefox's own bookmarks: the same ones its Library window shows, saved in
the profile and shared by every window.

```js
let toolbar = await neeko.bookmarks.list();          // the bookmarks toolbar
let starred = (await neeko.bookmarks.find(tab.url)).length > 0;
await neeko.bookmarks.add({ url: tab.url, title: tab.title });
neeko.bookmarks.on("add", ({ bookmark, index }) => draw(bookmark, index));
```

A bookmark looks like this:

```js
{
  id: "Ab3dE7fGhI0k",        // stays the same across sessions
  type: "bookmark",          // or "folder" or "separator"
  parentId: "toolbar_____",  // the folder it's in
  title: "Example Domain",
  url: "https://example.com/",           // null for folders and separators
  icon: "page-icon:https://example.com/",  // or null
  added: 1790000000000,      // when it was added, in milliseconds
}
```

**`icon`** is a URL for an `<img>`: Firefox serves the page's icon from its
own store, so no image data goes through the API. It's `null` if Firefox has
no icon for the page (it gets one when the page is visited).

**Folders.** `neeko.bookmarks.folders` has the ids of the folders every
profile has, at once: `toolbar` (the bookmarks toolbar), `menu` (the
bookmarks menu), `other` ("Other Bookmarks") and `mobile`. Folders can hold
folders. Firefox's tags are left out.

### Methods

| Method | What it does |
| --- | --- |
| `neeko.bookmarks.list(folderId?)` | What's in a folder, in order: the bookmarks toolbar if you leave the id out. Folders inside come as items of type `folder`; list them for their contents. |
| `neeko.bookmarks.get(id)` | One bookmark, folder or separator. |
| `neeko.bookmarks.find(url)` | Every bookmark of this URL, in any folder. An empty list means the page isn't bookmarked: that's your star. |
| `neeko.bookmarks.add(item)` | Adds `{ url, title }`, a folder (`{ type: "folder", title }`) or a separator (`{ type: "separator" }`), in `parentId` at `index` (0 is the first). By default it goes at the end of the folder Firefox puts new bookmarks in, the toolbar unless the user chose another. Resolves to the new item. |
| `neeko.bookmarks.update(id, changes)` | Changes `title` or `url`, or moves the item: to `index` in its folder, or into `parentId` (at `index`, or the end). Resolves to the item as it is now. |
| `neeko.bookmarks.remove(id)` | Removes a bookmark or separator, or a folder with everything in it. |
| `neeko.bookmarks.on(event, listener)` | Listens for an event, as `tabs.on` does. |

### Events

Changes arrive however they're made: by your UI, another window, or
Firefox's Library window.

| Event | Data | When |
| --- | --- | --- |
| `add` | `{ bookmark, index }` | Something was added, at position `index` in its folder. |
| `remove` | `{ id, parentId }` | Something was removed. Removing a folder sends one event, for the folder. |
| `move` | `{ id, parentId, index, oldParentId }` | Something moved to position `index` in `parentId`. |
| `update` | `{ bookmark, changed }` | Its title or URL changed; `changed` says which (`["title"]`, or `["url", "icon"]`). |
| `request` | `{ tabId }` | The user asked to bookmark the page: Cmd+D, or Bookmarks > Bookmark Current Tab. Listening for this is how your UI says it bookmarks pages itself. |

## Find in page

Your UI can have its own find bar, with Firefox doing the finding: the same
matching, selection, scrolling and highlighting as Firefox's find bar.
Listen for `request` and Cmd+F comes to your UI instead of opening
Firefox's.

```js
neeko.find.on("request", ({ command, selection }) => {
  if (command == "find") showFindBar(selection);    // Cmd+F
  if (command == "next") neeko.find.next();          // Cmd+G
});
input.oninput = async () => {
  let { result, current, total } = await neeko.find.find(input.value);
  count.textContent = result == "notFound" ? "No matches" : `${current} of ${total}`;
};
```

A search looks like this:

```js
{
  result: "found",   // or "wrapped" (it went around the end), or "notFound"
  current: 2,        // which match is selected, from 1
  total: 12,         // how many there are; -1 when there are more than limit
  limit: 1000,       // how many Firefox counts at most
}
```

| Method | What it does |
| --- | --- |
| `neeko.find.find(text, options?, tabId?)` | Finds `text` in the page, as typing in Firefox's find bar does: the first match from where the page's selection is, selected and scrolled to. Options: `caseSensitive`, `wholeWord` and `matchDiacritics`, all `false` unless given. `""` clears the search. Resolves to the search. |
| `neeko.find.next(tabId?)` | The next match of what was last found, going around at the end, as Cmd+G does. |
| `neeko.find.previous(tabId?)` | The one before, as Cmd+Shift+G does. |
| `neeko.find.highlight(highlight, tabId?)` | Highlights every match (`true`), or stops. Later searches in the tab keep highlighting until `close()`. |
| `neeko.find.close(tabId?)` | Done finding: the highlights go and the match stays selected, as when Firefox's find bar closes. Call `neeko.tabs.focus()` too, to give the page its keys back, as Firefox does. |
| `neeko.find.on(event, listener)` | Listens for an event, as `tabs.on` does. |

Each tab has its own search, like Firefox's find bars: `next()` goes on
from what that tab last found. A tab that's asleep can't be searched.

| Event | Data | When |
| --- | --- | --- |
| `request` | `{ command, selection }` | The user wants to find in the page. `command` is `"find"` (Cmd+F, Edit > Find, or / or ' typed in a page), `"next"` (Cmd+G), `"previous"` (Cmd+Shift+G) or `"selection"` (Cmd+E: find the selected text). `selection` is the text selected in the page, for `find` and `selection`, to start with, as Firefox's find bar does; `""` if none. Listening for this is how your UI says it finds in pages itself. |

## The browser's own pages

Pages of your browser's own, shown in tabs like web pages: a start page,
settings, a welcome page. Put them in your app's `pages/` folder:
`pages/<name>.html` is `about:<name>`. `pages/start.html` is also the New
Tab page and the home page (unless the user picks another), in private
windows too: there it's their first page and their New Tab page, instead of
Firefox's purple private browsing page. `neekoPage.private` tells it which
kind of window it's in, so it can say so, or look different.

```
pages/
├── start.html      about:start: the New Tab page and home page
├── settings.html   about:settings... except that's Firefox's (see below)
└── start.js, style.css, images...
```

**They're web pages, locked down.** Each is its own `about:` address with no
privileges, the same as a website's. They run in Firefox's privileged
about: process, never in a process with websites. Websites can't open,
link to or frame them. And instead of `neeko`, they get `neekoPage`, a small
API of their own, which Firefox's side checks on every call really comes
from one of these pages, as a tab's page.

- **Names are lowercase letters, digits and `-`.** Firefox's own `about:`
  pages keep their names: a page named like one (`preferences`, `settings`,
  `welcome`, `newtab`...) isn't served, and the console says so. Firefox's
  pages stay there as the fallbacks.
- **Use absolute URLs, or a `<base>`.** `about:start` isn't a folder, so
  relative URLs don't resolve. Put
  `<base href="chrome://neeko-pages/content/">` in the page's `<head>` and
  relative paths work, as in the demo app's `pages/start.html`.
- **With a bundler (Vite and the like):** set its base to `./` or
  `chrome://neeko-pages/content/`. Its default, root-relative paths
  (`/assets/app.css`) resolve to `chrome://neeko-pages/assets/app.css`,
  outside your pages, and the files silently don't load. Bundlers also
  inline small images as `data:` URLs, which a Content Security Policy
  like the demo page's (`default-src chrome:`) refuses: add `data:` to
  `img-src`, or turn the inlining off. And take `crossorigin` off
  stylesheet links (`<link rel="stylesheet" crossorigin>`, which Vite
  writes): such a stylesheet loads but none of its rules apply, with no
  error, unless the same file was already loaded without it. Module
  scripts with `crossorigin` are fine.
- **They can't link to each other** (since websites can't either): use
  `neekoPage.go()` or `neekoPage.open()`, or have your UI open them with
  `neeko.tabs.open("about:settings")`.
- **Everything is a promise**, even reading a setting: `neekoPage` isn't in
  your UI's process. Only `neekoPage.private` is there at once.

```js
document.querySelector("form").onsubmit = event => {
  event.preventDefault();
  neekoPage.go(input.value);          // this tab goes where the user typed
};
let theme = await neekoPage.settings.get("theme");
```

| Method | What it does |
| --- | --- |
| `neekoPage.private` | `true` in a private window, `false` otherwise. At once, not a promise: a tab never moves between the two. |
| `neekoPage.go(input)` | This tab goes where the user typed, as `neeko.nav.go` does: an address, or a search with the default search engine. `javascript:` and `data:` addresses are refused. |
| `neekoPage.open(input, options?)` | Opens what the user typed in a new tab next to this one, selected unless `{ background: true }`. |
| `neekoPage.settings.get(key)` | One of your UI's settings (see Settings), or `undefined`. |
| `neekoPage.settings.all()` | Every setting, as `{ key: value }`. |
| `neekoPage.settings.set(key, value)` | Saves a setting for every window and page, as `neeko.settings.set` does. |
| `neekoPage.settings.on("change", listener)` | Calls `listener({ key, value })` when a setting changes, from anywhere. Returns a function that stops it. |
| `neekoPage.search.engines()` | Firefox's search engines, as `[{ id, name, isDefault }]`, in Firefox's order. |
| `neekoPage.search.setDefault(id)` | Makes one of them the default, as Firefox's settings do. |

In dev launches (`make`), pages load from your app's `pages/` folder, so
changes only need a relaunch or a reload of the page. Firefox's content
sandbox only lets them read their own files there because `make` passes it
two extra read paths (`security.sandbox.content.mac.testing_read_path1` and
`2`); packaged browsers carry their pages inside the app and need none.

## Drawing over the page

The web page is drawn on top of your UI, over the element you mark
`data-neeko-content`. To draw something of your UI over the page (a menu or
dropdown, a sidebar sliding out, a bar peeking down, your own error page),
mark it `data-neeko-overlay`. No script needed:

```html
<div class="menu" data-neeko-overlay hidden>…</div>
```

While a marked element is showing and overlaps the page, it's drawn over the
page and takes the pointer there. Everywhere else the page is drawn and
takes the pointer (clicks, the wheel) as usual. Show and hide overlays any
way you like: `hidden`, a class, a `:hover` rule, an animation; Neeko
follows along, frame by frame while things move.

- **An overlay's area is its box plus its `box-shadow`.** Its shadow and
  rounded corners are drawn over the page too. Anything it draws further
  out (a `filter`, an `outline`) is cut off at that area: mark a wrapper
  that covers it.
- **Within that area, the page shows only where your UI is transparent.** If
  your UI paints a background under its content slot (on `body`, say), a
  shadow falling on the page shows that background instead. Paint the
  background around the slot instead; the demo UI gives its slot a huge
  `box-shadow` in the background color, beneath everything else
  (`ui/style.css`).
- **Showing means rendered**: not `display: none`, `visibility: hidden` or
  `opacity: 0`.
- **A click in the page** goes to the page, not your UI, even with a menu
  open. To close a menu when that happens, listen for your UI window's
  `blur`: a click in the page moves the keyboard focus there. For a modal
  overlay that should block the page, mark a transparent element covering
  the whole slot.

## The pointer at the page's edges

Over the web page, the pointer is the page's: your UI hears nothing of it.
Where the page reaches the window's edge (your sidebar hidden, say), your UI
can't tell when the pointer gets there to slide something out. Tell Neeko
which of the page's edges to watch, and how deep a band along each, in CSS
pixels:

```js
await neeko.pointer.setEdges({ left: 4, top: 10 });
neeko.pointer.on("edge", ({ edge, outside }) => {
  if (edge == "left") showSidebar();   // it slides out over the page
});
```

| Method | What it does |
| --- | --- |
| `neeko.pointer.setEdges(edges)` | Watches the page's `top`, `right`, `bottom` and `left` edges you give a depth (1 to 200 pixels), and no others. Replaces what was set before; `{}` stops watching. |
| `neeko.pointer.on(event, listener)` | Listens for an event, as `tabs.on` does. |

| Event | Data | When |
| --- | --- | --- |
| `edge` | `{ edge, outside }` | The pointer, over the page, came into the band along a watched edge (`edge` is `"top"`, `"right"`, `"bottom"` or `"left"`), or left it (`edge` is `null`). Where two bands meet, `top` counts first, then `left`, `right`, `bottom`. `outside` is `true` when the pointer left the window across that edge, which is how a quick flick past the window's edge still counts. |

The pointer going from the page onto your UI (onto the sidebar that slid
out, say) counts as leaving the band: from there your UI hears it itself.
Only the pointer's moves are watched, and only while you watch some edge;
nothing runs in the web page for it.

## Firefox's own UI, in your look

Some things Firefox still draws itself: a page's dialogs (`alert()`,
`confirm()`, `prompt()`, "leave this page?" and sign-in prompts), the bars
over the page (a blocked pop-up, a page slowing the browser down), the
fallbacks your UI doesn't handle yet (Firefox's panels, such as its camera,
password and add-on prompts and the downloads and bookmark panels; the find
bar; the link status bubble) and form autocomplete. Give your browser's look
as a `theme` in `browser.json`, and they wear it instead of Firefox's: your
font, your colors in light and dark, your corner radii.

```json
"theme": {
  "font": {
    "family": "Poppins",
    "files": [
      { "file": "fonts/poppins-400.woff2", "weight": 400 },
      { "file": "fonts/poppins-600.woff2", "weight": 600 }
    ]
  },
  "radius": 12,
  "dialogRadius": 16,
  "buttonHeight": 36,
  "light": {
    "text": "#171717", "muted": "#737373",
    "surface": "#ffffff", "line": "rgba(0, 0, 0, 0.07)", "field": "rgba(0, 0, 0, 0.03)",
    "primary": "#171717", "onPrimary": "#ffffff"
  },
  "dark": {
    "text": "#fafafa", "muted": "#a3a3a3",
    "surface": "#171717", "line": "rgba(255, 255, 255, 0.08)", "field": "rgba(255, 255, 255, 0.04)",
    "primary": "#ffffff", "onPrimary": "#171717"
  }
}
```

| Key | What it is |
| --- | --- |
| `font` | Optional. `family` is the font's name; `files` are its font files (`.woff2`, `.woff`, `.ttf` or `.otf`), paths in your app folder, each with its `weight` (400 by default), and optionally `style` (`"italic"`) and `unicodeRange`. Without `files`, the font must be installed. Without `font`, the system's font, as Firefox uses. |
| `radius` | Corner radius of panels, bars, buttons and fields, in pixels. 8 by default. |
| `dialogRadius` | Corner radius of a page's dialogs. `radius` + 4 by default. |
| `buttonHeight` | Height of buttons and fields. 32 by default, Firefox's. |
| `light`, `dark` | The colors for each scheme. `text`, `surface` (backgrounds), `primary` (the main button, such as Allow or OK) and `onPrimary` (its text) are required; `muted` (secondary text), `line` (borders), `field` (text fields, other buttons) and `backdrop` (the dimmed page behind a dialog) are made from them if you leave them out. |

Colors are CSS colors: `#rrggbb`, `rgba(…)`, `hsl(…)` and the like. Which
scheme shows follows `neeko.colorScheme`, live. `make` checks every value
and says what's wrong, and nothing but these values reaches the CSS: your
browser never styles Firefox's elements itself. Neeko maps the theme onto
Firefox's own styles (its design tokens, where it has them), and keeps that
working when Firefox changes. Change the theme and run `make` again.

Without a `theme`, Firefox's own look stays: that's the fallback.

## Firefox's menus, trimmed

The menu bar (on macOS, File, Edit, View and the rest at the top of the
screen) and the page's context menu (right-click) are Firefox's. Say in
`browser.json` which of their menus and items your browser keeps, and the
rest are hidden, with the separators tidied (never first, last or two in a
row):

```json
"menus": {
  "menubar": {
    "file": ["newWindow", "newPrivateWindow", "newTab", "closeTab", "closeWindow"],
    "edit": true,
    "view": ["zoom", "fullScreen"],
    "window": true,
    "help": []
  },
  "context": ["back", "forward", "reload", "stop", "openLinkInTab", "copyLink",
              "copy", "paste", "cut", "undo", "redo", "selectAll", "spelling",
              "openImage", "saveImage", "copyImage", "savePage", "inspect"]
}
```

- **`menubar`**: the menus to keep, each with the items it keeps, or `true`
  to keep it whole. Menus left out are hidden. Items keep Firefox's order.
  On macOS the application menu (About, Settings, Services, Hide, Quit)
  always stays, and so does Quit elsewhere.
- **`context`**: the items to keep. Firefox still shows only those that fit
  what was clicked (a link's items on a link), so list everything your
  browser should ever offer.
- **Without `menus`, or without one of its parts,** that menu is Firefox's
  own, whole: the fallback. Items Firefox adds in later versions stay
  hidden in a trimmed menu until Neeko names them and you list them.
- Keyboard shortcuts keep working, even for hidden items.

The names, which Neeko keeps working across Firefox versions
(`src/browser/neeko/NeekoMenuNames.sys.mjs`); `make` rejects any other:

| Menu | Items |
| --- | --- |
| `file` | `newTab`, `newContainerTab`, `newWindow`, `newPrivateWindow`, `openLocation`, `openFile`, `closeTab`, `closeWindow`, `savePage`, `emailLink`, `pageSetup`, `print`, `import`, `workOffline` |
| `edit` | `undo`, `redo`, `cut`, `copy`, `paste`, `delete`, `selectAll`, `find`, `findAgain`, `textDirection` |
| `view` | `toolbars`, `sidebar`, `zoom`, `pageStyle`, `repairTextEncoding`, `fullScreen`, `readerView`, `allTabs`, `pageDirection` |
| `tools` | `downloads`, `addons`, `sync`, `firefoxView`, `editPDF`, `browserTools`, `pageInfo` |
| `help` | `help`, `reportBrokenSite`, `feedback`, `troubleshootMode`, `troubleshootingInfo`, `reportDeceptiveSite`, `switchDevice`, `policySupport` |
| `history`, `bookmarks`, `profiles`, `window` | Only `true`: their contents are Firefox's own lists. |

| Context menu | Items |
| --- | --- |
| The page | `back`, `forward`, `reload`, `stop`, `bookmarkPage`, `savePage`, `selectAll`, `takeScreenshot`, `sendPageToDevice`, `viewSource`, `inspect`, `inspectAccessibility`, `pageDirection`, `drmLearnMore` |
| Links | `openLinkInCurrentTab`, `openLinkInTab`, `openLinkInContainerTab`, `openLinkInSplitView`, `openLinkInWindow`, `openLinkInPrivateWindow`, `openLinkInSmartWindow`, `previewLink`, `bookmarkLink`, `saveLink`, `copyLink`, `copyCleanLink`, `copyEmail`, `copyPhone`, `sendLinkToDevice` |
| Images, video, audio | `openImage`, `reloadImage`, `saveImage`, `copyImage`, `copyImageLink`, `emailImage`, `copyTextFromImage`, `imageInfo`, `imageDescription`, `visualSearch`, `setAsDesktopBackground`, `play`, `pause`, `mute`, `unmute`, `playbackSpeed`, `loop`, `fullScreen`, `controls`, `openVideo`, `pictureInPicture`, `saveVideoFrame`, `saveVideo`, `saveAudio`, `copyVideoLink`, `copyAudioLink`, `emailVideo`, `emailAudio` |
| Text and selections | `undo`, `redo`, `cut`, `copy`, `paste`, `pasteWithoutFormatting`, `delete`, `revealPassword`, `textDirection`, `searchSelection`, `searchSelectionPrivate`, `translateSelection`, `printSelection`, `viewSelectionSource`, `linkToHighlight`, `addSearchEngine`, `askAIChatbot` |
| Groups | `spelling` (suggestions, dictionaries), `passwords` (fill, generate, manage), `frame` (the This Frame menu), `pdf` (in Firefox's PDF viewer), `viewSourceCommands` (on view-source: pages), `extensions` (every item extensions add) |

## Fallbacks

Firefox keeps running underneath your UI, so a browser built on Neeko works
even where its UI has no controls yet.

- **Keyboard shortcuts** work as usual: Cmd+T, Cmd+W, Ctrl+Tab, Cmd+[ and
  Cmd+], Cmd+R, and Ctrl+M to mute a tab.
- **Your browser's own pages.** Without a `pages/start.html`, the New Tab
  page and the home page are Firefox's own, and private windows show
  Firefox's private browsing page.
- **Tab groups.** Groups made before your UI showed them (restored with
  the session) keep working: their tabs are listed like any others, with a
  `groupId`.
- **Bookmarking.** If your UI doesn't listen for `bookmarks` `request`,
  Cmd+D opens Firefox's own bookmark panel at the top right of the page, to
  name and file the bookmark. Cmd+Shift+O always opens Firefox's Library
  window, with every bookmark.
- **Drawing over the page.** Without elements marked `data-neeko-overlay`,
  the page stays on top of your UI everywhere in its slot.
- **Find in page.** If your UI doesn't listen for `find` `request`, Cmd+F
  (and / in a page) opens Firefox's find bar along the bottom of the page,
  in your `theme` if you have one.
- **Menus.** Without `menus` in `browser.json`, Firefox's menu bar and
  context menu are all there. Without a `settings` `request` listener,
  Cmd+, opens Firefox's settings.
- **Notification bars.** Firefox's bars about the page (it blocked a
  pop-up, the page is slowing the browser down, and the like) show across
  the top of the page, which moves down to make room, as in Firefox. They
  go when the page does, or when closed.
- **Error pages and crashed tabs.** Firefox's own error pages ("Hmm. We're
  having trouble finding that site.") and its crashed tab page show in the
  page area, with their buttons working, whether or not your UI reads a
  tab's `error` and `crashed`.
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
  loads (handing `neeko` the platform, settings and color scheme to read
  without waiting), lays the page over your content slot and your overlays
  over the page, and handles Cmd+L and its fallback.
- `src/browser/neeko/NeekoSettings.sys.mjs` keeps the settings and the
  color scheme, in prefs.
- `src/browser/neeko/NeekoBookmarks.sys.mjs` turns Firefox's bookmarks
  (Places) into plain data and events.
- `src/browser/neeko/NeekoTheme.sys.mjs` puts your `theme` on Firefox's own
  UI, with `neeko-theme.css` and `neeko-theme-dialog.css`.
- `src/browser/neeko/NeekoMenus.sys.mjs` trims Firefox's menus to your
  `menus`, by the names in `NeekoMenuNames.sys.mjs`.
- `src/browser/neeko/NeekoPages.sys.mjs` serves the app's pages as `about:`
  pages, in every process; `NeekoPageChild.sys.mjs` gives them `neekoPage`,
  and `NeekoPageParent.sys.mjs` checks and carries out its calls.

## Testing

```sh
make build
python3 tools/test_api.py
```

This launches the dev build with a fresh profile and a bare test UI of its
own (so it doesn't depend on what's in `ui/`), serves a few test pages from
localhost (no internet needed), and drives every method and event through
`neeko`. That includes checks that web pages can't see it, that sleeping tabs
stay asleep, and that each fallback (the address bar, prompts, fullscreen,
the downloads panel) steps in only when nobody listens. It asks for a
location, goes fullscreen (the screen switches for a moment), downloads a
few small files, plays a tone too quietly to hear, and crashes one test
tab on purpose (it stops that tab's content process), all from localhost,
in its throwaway profile.
