// Checks for the Neeko API, run by tools/test_api.py inside a browser window
// (chrome context: window is the browser window). It drives the API the way
// a UI would, through the `neeko` object in the UI page, and returns one line
// per check.

const BASE = "__BASE__";
const HOST = BASE.replace("http://", "");
const SLOW_SIZE = Number("__SLOW_SIZE__");
// The same test server as another site ("localhost"), so its pages get a
// content process of their own.
const OTHER_SITE = BASE.replace("127.0.0.1", "localhost");
// Nothing listens there.
const CLOSED = "__CLOSED__";

let results = [];
let check = (ok, what) => results.push(`${ok ? "ok  " : "FAIL"} ${what}`);

async function waitFor(test, what, timeout = 10000) {
  let end = Date.now() + timeout;
  while (Date.now() < end) {
    let value = await test();
    if (value) {
      check(true, what);
      return value;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  check(false, `timed out waiting for ${what}`);
  return null;
}

async function rejects(promise, pattern, what) {
  try {
    await promise;
    check(false, `${what} (it resolved)`);
  } catch (e) {
    check(pattern.test(e.message), `${what} (${e.message})`);
  }
}

let frame = document.getElementById("neeko-ui");
let neeko = await waitFor(() => frame.contentWindow.neeko, "the UI's neeko");
if (!neeko) {
  return results;
}
await waitFor(() => window.gBrowserInit?.delayedStartupFinished, "startup");

// Focus, prompts, the downloads panel and fullscreen all need this window to
// be the active one. Under heavy load, macOS can take a while to bring a newly
// launched app to the front.
window.focus();
await waitFor(() => Services.focus.activeWindow == window, "the window to be active", 30000);

check(Object.isFrozen(neeko) && Object.isFrozen(neeko.tabs), "neeko is frozen");
let platform = { Darwin: "macos", WINNT: "windows", Linux: "linux" }[Services.appinfo.OS];
check(neeko.platform == platform, `neeko.platform (${neeko.platform})`);

// The UI folder in neeko.ui.path (here the test UI) wins over the UI the build
// bundles inside the app.
let served = Cc["@mozilla.org/chrome/chrome-registry;1"]
  .getService(Ci.nsIChromeRegistry)
  .convertChromeURL(Services.io.newURI("chrome://neeko-ui/content/index.html")).spec;
check(
  served.startsWith("file:") && served.includes("/test-ui/"),
  `neeko.ui.path wins over the bundled UI (${served})`
);

// Everything the API tells the UI, as it arrives.
let events = [];
for (let type of ["open", "close", "select", "move", "update"]) {
  neeko.tabs.on(type, data => events.push({ type, ...data }));
}
let updated = (id, test) =>
  events.find(e => e.type == "update" && e.tab.id == id && test(e.tab));

// Listing
let list = await neeko.tabs.list();
check(list.length == gBrowser.tabs.length, `list has every tab (${list.length})`);
check(list.filter(t => t.selected).length == 1, "exactly one tab is selected");
let first = await neeko.tabs.current();
check(first.id == list.find(t => t.selected).id, "current() is the selected tab");
check(
  [
    "id",
    "url",
    "title",
    "icon",
    "loading",
    "canGoBack",
    "canGoForward",
    "selected",
    "audible",
    "muted",
    "crashed",
    "error",
    "groupId",
  ].every(k => k in first),
  "tabs have every field"
);
check(
  !first.audible && !first.muted && !first.crashed && first.error === null,
  "a quiet, working tab says so"
);

// Opening
let tab = await neeko.tabs.open(`${BASE}/one`);
check(tab.selected, "open() selects the new tab");
let opened = events.find(e => e.type == "open" && e.tab.id == tab.id);
check(opened, "open event");
check(
  opened?.index == gBrowser.tabs.indexOf(gBrowser.selectedTab),
  `open event has the tab's index (${opened?.index})`
);
check(
  events.some(e => e.type == "select" && e.id == tab.id && e.previousId == first.id),
  "select event with the previous tab"
);
check((await neeko.tabs.list()).length == list.length + 1, "list grows by one");
await waitFor(
  () => updated(tab.id, t => t.title == "Page one" && !t.loading),
  "Page one to load"
);
let now = await neeko.tabs.current();
check(now.url == `${BASE}/one`, `url (${now.url})`);
check(!now.canGoBack && !now.canGoForward, "a new tab can't go back or forward");

// Navigating. A bare host:port/path gets fixed up like the address bar would.
// Back skips pages the user never clicked, typed or scrolled in (Firefox's
// browser.navigation.requireUserInteraction), so Page one counts as used, as
// after a click. Without this, whether stray input reached it decided the
// back() checks.
let history = gBrowser.selectedBrowser.browsingContext.sessionHistory;
history.getEntryAtIndex(history.index).hasUserInteraction = true;
await neeko.nav.go(`${HOST}/two`);
await waitFor(
  () => updated(tab.id, t => t.url == `${BASE}/two` && t.title == "Page two"),
  "go() to fix up and load Page two"
);
await waitFor(() => updated(tab.id, t => t.canGoBack), "canGoBack after go()");

await neeko.nav.back();
await waitFor(
  () => updated(tab.id, t => t.url == `${BASE}/one` && t.canGoForward),
  "back() to Page one"
);
await neeko.nav.forward();
await waitFor(
  () => updated(tab.id, t => t.url == `${BASE}/two` && !t.canGoForward),
  "forward() to Page two"
);

let mark = events.length;
await neeko.nav.reload();
await waitFor(
  () =>
    events
      .slice(mark)
      .some(e => e.type == "update" && e.tab.id == tab.id && e.tab.loading),
  "reload() to start loading"
);
await waitFor(
  () =>
    events
      .slice(mark)
      .some(e => e.type == "update" && e.tab.id == tab.id && !e.tab.loading),
  "reload() to finish"
);

// Web pages can't see the API.
await neeko.nav.go(`${BASE}/probe`, tab.id);
let probed = await waitFor(
  () => updated(tab.id, t => t.title.startsWith("undefined")),
  "the probe page"
);
check(
  probed?.tab.title == "undefined,undefined,undefined,undefined",
  `web pages have no neeko, nor neekoPage (${probed?.tab.title})`
);

// Selecting and moving
await neeko.tabs.select(first.id);
check((await neeko.tabs.current()).id == first.id, "select() switches tabs");
check(
  events.some(e => e.type == "select" && e.id == first.id && e.previousId == tab.id),
  "select event"
);
gBrowser.moveTabTo(gBrowser.tabs[opened.index], { tabIndex: 0 });
await waitFor(
  () => events.some(e => e.type == "move" && e.id == tab.id && e.index == 0),
  "move event"
);
check((await neeko.tabs.list())[0].id == tab.id, "list follows the new order");

// Sleeping tabs are described without waking them.
let sleeper = gBrowser.addTab(`${BASE}/one`, {
  createLazyBrowser: true,
  lazyTabTitle: "Sleeper",
  triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
});
let described = (await neeko.tabs.list()).find(t => t.title == "Sleeper");
check(described && !described.canGoBack, "sleeping tabs are listed");
check(!sleeper.linkedPanel, "listing doesn't wake sleeping tabs");
await neeko.tabs.close(described.id);
check(!sleeper.isConnected || sleeper.closing, "close() closes a sleeping tab");

// Closing
await neeko.tabs.close(tab.id);
check(events.some(e => e.type == "close" && e.id == tab.id), "close event");
check(
  !(await neeko.tabs.list()).some(t => t.id == tab.id),
  "closed tabs leave the list"
);

// Mistakes are rejected with a message.
await rejects(neeko.tabs.select(999999), /No tab/, "select() of an unknown tab");
await rejects(neeko.tabs.select(), /tab id/, "select() without an id");
await rejects(neeko.nav.go("   "), /URL or search/, "go() with nothing");
await rejects(neeko.tabs.open(42), /URL or search/, "open() with a number");
try {
  neeko.tabs.on("nope", () => {});
  check(false, "on() with an unknown event throws");
} catch (e) {
  check(e instanceof frame.contentWindow.TypeError, "on() with an unknown event throws");
}
await rejects(neeko.tabs.open(null, { nope: true }), /Unknown option/, "open() with an unknown option");
await rejects(neeko.tabs.open(null, { index: -1 }), /whole number/, "open() at a negative index");
await rejects(neeko.tabs.move("0"), /position/, "move() without a position");
await rejects(neeko.tabs.setMuted("yes"), /true or false/, "setMuted() with a string");
await rejects(neeko.tabs.duplicate(999999), /No tab/, "duplicate() of an unknown tab");

// Opening with options: in the background, and at a position.
let front = await neeko.tabs.current();
let behind = await neeko.tabs.open(`${BASE}/one`, { background: true, index: 0 });
check(!behind.selected, "open() in the background doesn't select the tab");
check((await neeko.tabs.current()).id == front.id, "the selected tab stays selected");
check(
  events.find(e => e.type == "open" && e.tab.id == behind.id)?.index == 0 &&
    (await neeko.tabs.list())[0].id == behind.id,
  "open() at an index puts the tab there"
);

// Moving, by the API. A position past the end means the end.
let tabCount = gBrowser.tabs.length;
await neeko.tabs.move(1000, behind.id);
check(
  events.some(e => e.type == "move" && e.id == behind.id && e.index == tabCount - 1),
  "move() moves a tab, with a move event"
);
check((await neeko.tabs.list()).at(-1).id == behind.id, "list follows move()");
await neeko.tabs.move(0, behind.id);
check((await neeko.tabs.list())[0].id == behind.id, "move() back to the start");

// Duplicating: a copy next to the tab, with its page and history.
await waitFor(() => updated(behind.id, t => t.title == "Page one" && !t.loading), "the tab to copy to load");
let copy = await neeko.tabs.duplicate(behind.id);
check(copy.selected && copy.id != behind.id, "duplicate() opens a copy and selects it");
check(
  events.find(e => e.type == "open" && e.tab.id == copy.id)?.index == 1,
  "the copy opens next to the tab"
);
await waitFor(
  () => updated(copy.id, t => t.url == `${BASE}/one` && t.title == "Page one"),
  "the copy shows the same page"
);
let quietCopy = await neeko.tabs.duplicate(behind.id, { background: true });
check(!quietCopy.selected && (await neeko.tabs.current()).id == copy.id, "duplicate() in the background");

// Muting.
await neeko.tabs.setMuted(true, behind.id);
check(updated(behind.id, t => t.muted), "setMuted(true) mutes, with an update");
check(gBrowser.tabs[0].linkedBrowser.audioMuted, "Firefox mutes the tab");
await neeko.tabs.setMuted(false, behind.id);
check(updated(behind.id, t => !t.muted), "setMuted(false) unmutes");
for (let t of [behind, copy, quietCopy]) {
  await neeko.tabs.close(t.id);
}

// Tabs report their icon as a short blob: URL the UI can show, shared by
// tabs with the same icon, and gone once no tab has it.
let iconTab = await neeko.tabs.open(`${BASE}/icon`);
let iconURL = (
  await waitFor(() => updated(iconTab.id, t => t.icon?.startsWith("blob:")), "a tab's icon, as a blob: URL")
)?.tab.icon;
let image = new frame.contentWindow.Image();
image.src = iconURL;
let decoded = await image.decode().then(() => image.naturalWidth, () => 0);
check(decoded == 2, `the UI can show it (${decoded}px wide)`);
let twin = await neeko.tabs.open(`${BASE}/icon`, { background: true });
await waitFor(() => updated(twin.id, t => t.icon == iconURL), "tabs with the same icon share its URL");
await neeko.tabs.close(iconTab.id);
check(
  await frame.contentWindow.fetch(iconURL).then(() => true, () => false),
  "the icon stays while a tab shows it"
);
await neeko.tabs.close(twin.id);
check(
  !(await frame.contentWindow.fetch(iconURL).then(() => true, () => false)),
  "and goes when no tab does"
);

// SVG icons, which Firefox has the page's own process draw
// (moz-remote-image:), come as a blob: URL too, of the picture it draws.
let svgTab = await neeko.tabs.open(`${BASE}/svg-icon`);
let svgIcon = (
  await waitFor(() => updated(svgTab.id, t => t.icon?.startsWith("blob:")), "an SVG icon, as a blob: URL")
)?.tab.icon;
check(
  gBrowser.selectedTab.getAttribute("image")?.startsWith("moz-remote-image:"),
  "which Firefox had drawn elsewhere (moz-remote-image:)"
);
let svgImage = new frame.contentWindow.Image();
svgImage.src = svgIcon;
check(await svgImage.decode().then(() => svgImage.naturalWidth > 0, () => false), "and the UI can show it");
await neeko.tabs.close(svgTab.id);

// Sound.
let audioTab = await neeko.tabs.open(`${BASE}/audio`);
await waitFor(() => updated(audioTab.id, t => t.audible), "a tab playing sound is audible", 15000);
await neeko.tabs.setMuted(true);
await waitFor(() => updated(audioTab.id, t => t.muted), "a playing tab mutes");
await neeko.tabs.close(audioTab.id);

// Error pages: the page that failed, and why.
let errorTab = await neeko.tabs.open(`${BASE}/one`);
await neeko.nav.go(`${CLOSED}/`);
let failed = await waitFor(
  () => updated(errorTab.id, t => t.error?.page == "neterror"),
  "a tab reports Firefox's error page"
);
check(
  failed?.tab.error.code == "connectionFailure" && failed.tab.url == `${CLOSED}/`,
  `with its error code and the address that failed (${JSON.stringify(failed?.tab.error)}, ${failed?.tab.url})`
);
await neeko.nav.go(`${BASE}/two`);
await waitFor(() => updated(errorTab.id, t => t.title == "Page two" && t.error === null), "the error goes with the page");
await neeko.tabs.close(errorTab.id);

// A tab whose content process goes away is crashed, until reloaded.
let crashTab = await neeko.tabs.open(`${OTHER_SITE}/one`);
await waitFor(() => updated(crashTab.id, t => t.title == "Page one" && !t.loading), "a page in a process of its own");
let pid = gBrowser.selectedBrowser.frameLoader?.remoteTab?.osPid;
Cc["@mozilla.org/processtools-service;1"].getService(Ci.nsIProcessToolsService).kill(pid);
await waitFor(() => updated(crashTab.id, t => t.crashed), "its tab is crashed once the process is gone", 20000);
await neeko.nav.reload(crashTab.id);
await waitFor(
  () => updated(crashTab.id, t => !t.crashed && t.title == "Page one"),
  "reload() brings it back",
  20000
);
await neeko.tabs.close(crashTab.id);

// Handing the keys to the page.
let field = frame.contentDocument.getElementById("field");
field.focus();
check(document.activeElement == frame, "the UI has focus");
await neeko.tabs.focus();
check(document.activeElement == gBrowser.selectedBrowser, "focus() hands it to the page");

// Drawing over the page. While an element marked data-neeko-overlay overlaps
// the page, it's drawn over the page and takes the pointer there, shadow
// included; the rest of the page stays visible and takes the pointer.
let overTab = await neeko.tabs.open(`${BASE}/tall`);
await waitFor(() => updated(overTab.id, t => t.title == "0" && !t.loading), "a page to draw over");
let menu = frame.contentDocument.getElementById("menu");
let uiOverPage = () => document.documentElement.hasAttribute("neeko-ui-over-page");
let hit = (x, y) => {
  let element = document.elementFromPoint(x, y);
  return element == frame ? "ui" : document.getElementById("tabbrowser-tabbox").contains(element) ? "page" : element?.id;
};
let colorAt = async (x, y) => {
  let bitmap = await browsingContext.currentWindowGlobal.drawSnapshot(new DOMRect(x, y, 1, 1), 1, "white");
  let canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = canvas.height = 1;
  let context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0);
  return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)].join();
};
let green = "0,200,0";
check(hit(450, 150) == "page" && !uiOverPage(), "the page is on top to begin with");
menu.hidden = false;
await waitFor(uiOverPage, "an overlay over the page puts the UI above it");
check(hit(450, 150) == "ui", `the overlay takes the pointer (${hit(450, 150)})`);
check(hit(390, 150) == "ui", `and so does its shadow (${hit(390, 150)})`);
check(hit(800, 400) == "page", `the rest of the page still takes it (${hit(800, 400)})`);
check(hit(80, 300) == "ui", `and the UI around the page (${hit(80, 300)})`);
// The wheel scrolls the page, but not through the overlay. (The page titles
// itself with how far it's scrolled.)
let scrolled = async (x, y) => {
  let before = gBrowser.selectedTab.label;
  windowUtils.sendWheelEvent(x, y, 0, 300, 0, WheelEvent.DOM_DELTA_PIXEL, 0, 0, 0, 0);
  for (let i = 0; i < 20 && gBrowser.selectedTab.label == before; i++) {
    await new Promise(r => setTimeout(r, 50));
  }
  return gBrowser.selectedTab.label != before;
};
check(await scrolled(800, 400), "the wheel still scrolls the page");
check(!(await scrolled(450, 150)), "but not through the overlay");
let painted = await colorAt(450, 150);
check(painted == green, `the overlay is drawn over the page (${painted})`);
painted = await colorAt(800, 400);
check(painted == "255,255,255", `the rest of the page is still drawn (${painted})`);
// Moved off the page (the page starts 160px from the left), it doesn't.
menu.style.left = "10px";
menu.style.width = "100px";
await waitFor(() => !uiOverPage(), "an overlay beside the page leaves the page on top");
menu.style.left = "400px";
menu.style.width = "200px";
await waitFor(uiOverPage, "back over the page");
menu.hidden = true;
await waitFor(() => !uiOverPage() && !frame.style.clipPath, "hidden, it leaves the page on top");
check(hit(450, 150) == "page", "and the page takes the pointer again");

// The pointer at the page's edges, which the UI never sees over the page.
let edges = [];
let stopEdges = neeko.pointer.on("edge", data => edges.push(data));
await neeko.pointer.setEdges({ top: 10, left: 4 });
let pageBox = document.getElementById("tabbrowser-tabbox").getBoundingClientRect();
let moveTo = async (x, y) => {
  synthesizeMouseEvent("mousemove", x, y, {});
  await new Promise(r => setTimeout(r, 50));
};
let lastEdge = () => JSON.stringify(edges.at(-1) ?? null);
await moveTo(pageBox.left + 300, pageBox.top + 300);
let quietBefore = edges.length;
await moveTo(pageBox.left + 310, pageBox.top + 310);
check(edges.length == quietBefore, "no events while the pointer is away from the edges");
await moveTo(pageBox.left + 300, pageBox.top + 5);
check(lastEdge() == '{"edge":"top","outside":false}', `the pointer at the page's top edge (${lastEdge()})`);
await moveTo(pageBox.left + 300, pageBox.top + 15);
check(lastEdge() == '{"edge":null,"outside":false}', `and away from it (${lastEdge()})`);
await moveTo(pageBox.left + 2, pageBox.top + 300);
check(lastEdge() == '{"edge":"left","outside":false}', `at the left edge, 4px deep (${lastEdge()})`);
await moveTo(pageBox.left + 6, pageBox.top + 300);
check(lastEdge() == '{"edge":null,"outside":false}', "past it");
await moveTo(pageBox.right - 2, pageBox.top + 300);
check(lastEdge() == '{"edge":null,"outside":false}', "edges it doesn't watch stay quiet");
await moveTo(pageBox.left - 20, pageBox.top + 300);
check(lastEdge() == '{"edge":null,"outside":false}', "over the UI, the pointer isn't at the page's edge");
// Leaving the window across the left edge.
await moveTo(pageBox.left + 2, pageBox.top + 300);
gBrowser.selectedBrowser.dispatchEvent(
  new MouseEvent("mouseout", { bubbles: true, clientX: pageBox.left - 1, clientY: pageBox.top + 300, relatedTarget: null })
);
await waitFor(() => lastEdge() == '{"edge":"left","outside":true}', "leaving the window across it");
await rejects(neeko.pointer.setEdges({ middle: 3 }), /Unknown edge/, "setEdges() with an unknown edge");
await rejects(neeko.pointer.setEdges({ top: -1 }), /depth/, "setEdges() with a bad depth");
await neeko.pointer.setEdges({});
let afterStop = edges.length;
await moveTo(pageBox.left + 300, pageBox.top + 5);
check(edges.length <= afterStop + 1 && lastEdge().includes("null"), "setEdges({}) stops it");
stopEdges();
await neeko.tabs.close(overTab.id);

// The address bar. Listening takes effect once Neeko has read the message,
// which any later reply confirms.
let openLocation = () =>
  document.getElementById("Browser:OpenLocation").doCommand();
let fallbackShowing = () =>
  document.documentElement.hasAttribute("neeko-firefox-address-bar");

openLocation();
check(
  fallbackShowing() && gURLBar.focused,
  "Cmd+L with no listener shows Firefox's address bar"
);
gBrowser.selectedBrowser.focus();
check(!fallbackShowing(), "it hides again when it loses focus");

let asked = 0;
let stopAsking = neeko.nav.on("addressbar", () => asked++);
await neeko.tabs.current();
openLocation();
await waitFor(() => asked == 1, "Cmd+L reaches a UI that listens");
check(!fallbackShowing() && !gURLBar.focused, "Firefox's address bar stays hidden");

let blank = await neeko.tabs.open();
await waitFor(() => asked == 2, "a new tab on the New Tab page asks too");
await neeko.tabs.close(blank.id);
let unasked = await neeko.tabs.open(null, { addressbar: false });
await neeko.tabs.current();
check(unasked.selected && asked == 2, "one opened with addressbar: false doesn't");
await neeko.tabs.close(unasked.id);

stopAsking();
await neeko.tabs.current();
openLocation();
check(fallbackShowing(), "after the UI stops listening, the fallback is back");
gBrowser.selectedBrowser.focus();

// Web page fullscreen: the page fills the window over the UI, then goes back
// into the UI's content slot.
let tabbox = document.getElementById("tabbrowser-tabbox");
let rectOf = element => {
  let { left, top, right, bottom } = element.getBoundingClientRect();
  return [left, top, right, bottom].map(Math.round);
};
let slotRect = () =>
  rectOf(frame.contentDocument.querySelector("[data-neeko-content]"));
let pageTab = await neeko.tabs.open(`${BASE}/fullscreen`);
await waitFor(
  () => document.documentElement.hasAttribute("inDOMFullscreen"),
  "a page to go fullscreen"
);
await waitFor(
  () => `${rectOf(tabbox)}` == `0,0,${innerWidth},${innerHeight}`,
  "the page to fill the window"
);
check(getComputedStyle(frame).visibility == "hidden", "the UI isn't drawn meanwhile");
document.exitFullscreen();
await waitFor(
  () => !document.documentElement.hasAttribute("inDOMFullscreen") && !fullScreen,
  "fullscreen to end"
);
await waitFor(
  () => `${rectOf(tabbox)}` == `${slotRect()}` && !`${slotRect()}`.startsWith("0,0"),
  "the page to go back into the UI's slot"
);
check(getComputedStyle(frame).visibility == "visible", "the UI is drawn again");
await neeko.tabs.close(pageTab.id);

// A UI that listens for "page" lays out page fullscreen itself: the page
// stays in its slot, wherever the UI puts it, and the UI stays drawn.
let fullscreen = [];
let stopPage = neeko.fullscreen.on("page", ({ fullscreen: on }) =>
  fullscreen.push(`page ${on}`)
);
let stopWindow = neeko.fullscreen.on("window", ({ fullscreen: on }) =>
  fullscreen.push(`window ${on}`)
);
let heardFullscreen = what => fullscreen.includes(what);
let fullscreenState = async () => JSON.stringify(await neeko.fullscreen.state());
check(
  (await fullscreenState()) == `{"page":false,"window":false}`,
  `state() before (${await fullscreenState()})`
);
pageTab = await neeko.tabs.open(`${BASE}/fullscreen`);
await waitFor(() => heardFullscreen("page true"), "the UI hears a page go fullscreen");
await waitFor(() => heardFullscreen("window true"), "and the window with it");
check((await fullscreenState()) == `{"page":true,"window":true}`, `state() (${await fullscreenState()})`);
await new Promise(r => setTimeout(r, 300));
check(
  `${rectOf(tabbox)}` == `${slotRect()}` &&
    `${rectOf(tabbox)}` != `0,0,${innerWidth},${innerHeight}`,
  `the page stays in the UI's slot (${rectOf(tabbox)})`
);
check(getComputedStyle(frame).visibility == "visible", "the UI stays drawn");
await neeko.fullscreen.exit();
await waitFor(
  () => heardFullscreen("page false") && heardFullscreen("window false"),
  "exit() ends page fullscreen, and the window's"
);
await neeko.tabs.close(pageTab.id);

await neeko.fullscreen.setWindow(true);
await waitFor(() => fullScreen && fullscreen.at(-1) == "window true", "setWindow(true)");
check(
  (await fullscreenState()) == `{"page":false,"window":true}`,
  `a fullscreen window without a fullscreen page (${await fullscreenState()})`
);
await neeko.fullscreen.setWindow(false);
await waitFor(() => !fullScreen && fullscreen.at(-1) == "window false", "setWindow(false)");
check(fullscreen.filter(e => e.startsWith("page")).length == 2, "no extra page events");
await rejects(neeko.fullscreen.setWindow("yes"), /true or false/, "setWindow() with a string");
stopPage();
stopWindow();
await neeko.tabs.current();
check(
  !document.documentElement.hasAttribute("neeko-ui-fullscreen"),
  "once the UI stops listening, the fallback is back"
);

// Firefox's own panels hang from the top edge of the page, 8px in, since the
// toolbar icons they'd hang from are hidden: the address bar's panels on the
// left, the toolbar buttons' on the right.
let hangsFrom = (panel, side) => {
  let [left, top, right] = rectOf(panel);
  let [pageLeft, pageTop, pageRight] = rectOf(tabbox);
  let inset = side == "left" ? left - pageLeft : pageRight - right;
  return (
    panel.anchorNode?.id == "neeko-panel-anchor" &&
    Math.abs(inset - 8) <= 1 &&
    Math.abs(top - pageTop - 8) <= 1
  );
};
let where = panel => `at ${rectOf(panel)}, the page at ${rectOf(tabbox)}`;

let promptTab = await neeko.tabs.open(`${BASE}/geo`);
let prompt = await waitFor(
  () =>
    PopupNotifications.panel.state == "open" &&
    PopupNotifications.getNotification("geolocation"),
  "the location prompt"
);
check(
  hangsFrom(PopupNotifications.panel, "left"),
  `it hangs from the page's top left (${where(PopupNotifications.panel)})`
);
PopupNotifications.remove(prompt);

let notice = PanelUI.notificationPanel;
AppMenuNotifications.showNotification("addon-installed", { callback() {} }, null, {
  name: "Test add-on",
  customElementOptions: { addonId: "test@neeko" },
});
await waitFor(() => notice.state == "open", "an add-on added notice");
check(
  hangsFrom(notice, "right"),
  `the menu button's notices hang from the top right (${where(notice)})`
);
AppMenuNotifications.removeNotification("addon-installed");

// A download opens Firefox's downloads panel, on the right like the others.
let downloadsPanel = () => document.getElementById("downloadsPanel");
await neeko.nav.go(`${BASE}/download`);
await waitFor(
  () => downloadsPanel()?.state == "open",
  "the downloads panel to open when a download starts"
);
check(
  hangsFrom(downloadsPanel(), "right"),
  `it hangs from the page's top right (${where(downloadsPanel())})`
);
let downloads = await Downloads.getList(Downloads.ALL);
await waitFor(
  async () =>
    (await downloads.getAll()).some(
      d => d.succeeded && d.target.path.endsWith("neeko-test.txt")
    ),
  "the download to finish"
);
DownloadsPanel.hidePanel();
await neeko.tabs.close(promptTab.id);

// Firefox's notification bars (a blocked pop-up, a slow page) show across
// the top of the page, which moves down to make room, as in Firefox.
let barTab = await neeko.tabs.open(`${BASE}/one`);
// Firefox removes bars like this one when the page's address changes.
await waitFor(() => updated(barTab.id, t => t.title == "Page one" && !t.loading), "a page for a bar");
let pageTop = () => gBrowser.selectedBrowser.getBoundingClientRect().top;
let topBefore = pageTop();
let bars = gBrowser.getNotificationBox(gBrowser.selectedBrowser);
let bar = await bars.appendNotification("neeko-test", {
  label: "A test bar",
  priority: bars.PRIORITY_INFO_MEDIUM,
});
// It slides into place (300ms), so the check waits for it to get there.
await waitFor(
  () =>
    bar.checkVisibility() &&
    pageTop() > topBefore &&
    bar.getBoundingClientRect().top >= gBrowser.tabbox.getBoundingClientRect().top,
  "a notification bar shows, and the page moves down for it"
);
let barRect = bar.getBoundingClientRect();
let pageRect = gBrowser.tabbox.getBoundingClientRect();
check(
  barRect.top >= pageRect.top &&
    barRect.left >= pageRect.left &&
    barRect.right <= pageRect.right &&
    barRect.bottom <= pageTop(),
  `across the top of the page, above it (bar ${Math.round(barRect.top)}-${Math.round(barRect.bottom)}, page from ${Math.round(pageTop())})`
);
bars.removeNotification(bar);
await waitFor(() => pageTop() == topBefore, "and the page moves back up once it's gone");
await neeko.tabs.close(barTab.id);

// The app's theme (browser.json's, here the demo app's) on what Firefox
// still draws: its panels, bars and find bar get the theme's values through
// Firefox's own tokens, and a page's dialogs get it inside too.
let themeValue = (element, name) =>
  element.ownerDocument.defaultView.getComputedStyle(element).getPropertyValue(name).trim();
let surface = themeValue(document.documentElement, "--neeko-theme-surface");
check(
  document.documentElement.hasAttribute("neeko-theme") && surface.length > 0,
  `the window has the app's theme (surface ${surface})`
);
check(
  themeValue(PopupNotifications.panel, "--panel-background-color") == surface &&
    themeValue(PopupNotifications.panel, "--button-background-color-primary") ==
      themeValue(document.documentElement, "--neeko-theme-primary"),
  "Firefox's panels and their buttons take its colors"
);
let alertTab = await neeko.tabs.open(`${BASE}/alert`);
let alertFrame = await waitFor(
  () =>
    [...document.querySelectorAll(".dialogFrame")].find(f =>
      f.contentDocument?.documentURI.startsWith("chrome://global/content/commonDialog.xhtml")
    )?.contentDocument?.readyState == "complete" &&
    [...document.querySelectorAll(".dialogFrame")].find(f =>
      f.contentDocument?.documentURI.startsWith("chrome://global/content/commonDialog.xhtml")
    ),
  "a page's alert()"
);
if (alertFrame) {
  let dialogDoc = alertFrame.contentDocument;
  let dialogBg = alertFrame.contentWindow.getComputedStyle(dialogDoc.documentElement).backgroundColor;
  let boxBg = getComputedStyle(alertFrame.closest(".dialogBox")).backgroundColor;
  check(
    dialogDoc.documentElement.hasAttribute("neeko-theme") && dialogBg == boxBg,
    `it has the theme inside and around it (${dialogBg}, ${boxBg})`
  );
  dialogDoc.querySelector("dialog").getButton("accept").click();
}
await neeko.tabs.close(alertTab.id);

// Permission prompts. A UI that listens for "open" shows them itself, and
// Firefox's own panel stays closed.
let prompts = [];
let stopPromptOpen = neeko.prompts.on("open", ({ prompt }) =>
  prompts.push({ type: "open", prompt })
);
let stopPromptClose = neeko.prompts.on("close", ({ id }) =>
  prompts.push({ type: "close", id })
);
let promptFor = tab => prompts.find(e => e.type == "open" && e.prompt.tabId == tab.id);
let promptClosed = id => prompts.some(e => e.type == "close" && e.id == id);
let titleOf = async tab => (await neeko.tabs.list()).find(t => t.id == tab.id)?.title;
await neeko.tabs.current();

let askTab = await neeko.tabs.open(`${BASE}/geo`);
let request = (await waitFor(() => promptFor(askTab), "a location prompt reaches the UI"))
  ?.prompt;
check(
  request?.kind == "location" && request.origin == HOST && request.message.includes(HOST),
  `it says who asks for what (${request?.kind}: ${request?.message})`
);
check(
  request?.actions.length == 2 && request.remember?.label && !request.remember.checked,
  `with actions and a remember checkbox (${JSON.stringify(request?.actions)})`
);
await new Promise(r => setTimeout(r, 300));
check(PopupNotifications.panel.state == "closed", "Firefox's own prompt stays closed");
check(
  (await neeko.prompts.list()).some(p => p.id == request?.id),
  "list() has the waiting prompt"
);
// Under heavy load, half a second can pass before the answer arrives, so the
// delay is longer for this check.
Services.prefs.setIntPref("security.notification_enable_delay", 60000);
await rejects(
  neeko.prompts.answer(request?.id, 0),
  /Too soon/,
  "allowing right away is refused, against clickjacking"
);
Services.prefs.setIntPref("security.notification_enable_delay", 500);
await rejects(neeko.prompts.answer(request?.id, 5), /no action/, "answer() with no such action");
await rejects(neeko.prompts.answer(999999, 1), /No prompt/, "answer() of an unknown prompt");
// Block needs no delay.
await neeko.prompts.answer(request?.id, 1);
await waitFor(() => promptClosed(request?.id), "answering closes the prompt");
await waitFor(async () => (await titleOf(askTab)) == "error 1", "the page hears it's blocked");
await neeko.tabs.close(askTab.id);

let allowTab = await neeko.tabs.open(`${BASE}/geo`);
let allowed = (await waitFor(() => promptFor(allowTab), "a second prompt"))?.prompt;
await new Promise(r => setTimeout(r, 600));
await neeko.prompts.answer(allowed?.id, 0, { remember: true });
await waitFor(() => promptClosed(allowed?.id), "Allow closes it too");
let site = Services.scriptSecurityManager.createContentPrincipalFromOrigin(BASE);
check(
  Services.perms.testExactPermissionFromPrincipal(site, "geo") ==
    Services.perms.ALLOW_ACTION,
  "Allow with remember saves the permission"
);
await waitFor(
  async () => !["geo", "error 1"].includes(await titleOf(allowTab)),
  "the page is allowed"
);
Services.perms.removeFromPrincipal(site, "geo");
await neeko.tabs.close(allowTab.id);

// Prompts the API doesn't cover stay Firefox's.
let heardBefore = prompts.length;
let unknown = PopupNotifications.show(
  gBrowser.selectedBrowser,
  "neeko-test",
  "Not a permission prompt",
  null,
  { label: "OK", accessKey: "O", callback() {} },
  []
);
await waitFor(
  () => PopupNotifications.panel.state == "open",
  "other prompts still open Firefox's panel"
);
check(prompts.length == heardBefore, "and don't reach the UI");
unknown.remove();

// When the UI stops listening, Firefox's panel shows what's still waiting.
let leftTab = await neeko.tabs.open(`${BASE}/geo`);
let left = (await waitFor(() => promptFor(leftTab), "a third prompt"))?.prompt;
stopPromptOpen();
await neeko.tabs.current();
await waitFor(
  () => PopupNotifications.panel.state == "open",
  "Firefox shows a waiting prompt once the UI stops listening"
);
check(
  hangsFrom(PopupNotifications.panel, "left"),
  `where its fallback prompts go (${where(PopupNotifications.panel)})`
);
await neeko.tabs.close(leftTab.id);
await waitFor(() => promptClosed(left?.id), "closing its tab closes the prompt");
stopPromptClose();

// Downloads. A UI that listens for "start" shows downloads itself, and
// Firefox's downloads panel doesn't open for them.
let downloadEvents = [];
for (let type of ["start", "update", "remove"]) {
  neeko.downloads.on(type, data => downloadEvents.push({ type, ...data }));
}
let started = name =>
  downloadEvents.find(e => e.type == "start" && e.download.filename == name)
    ?.download;
let latest = id => downloadEvents.findLast(e => e.download?.id == id)?.download;
check(
  (await neeko.downloads.list()).some(
    d => d.filename == "neeko-test.txt" && d.state == "done"
  ),
  "list() has the earlier download, done"
);
let downloadTab = await neeko.tabs.open(`${BASE}/one`);
await neeko.nav.go(`${BASE}/download-slow`);
let slow = await waitFor(() => started("neeko-slow.bin"), "the UI hears a download start");
check(
  slow?.url == `${BASE}/download-slow` && slow.path.endsWith("/downloads/neeko-slow.bin"),
  `with where it's from and where it goes (${slow?.path})`
);
await waitFor(
  () => latest(slow?.id)?.state == "downloading" && latest(slow.id).received > 0,
  "progress updates"
);
check(latest(slow?.id)?.total == SLOW_SIZE, `and its size (${latest(slow?.id)?.total})`);
check(downloadsPanel()?.state != "open", "Firefox's downloads panel stays closed");
await neeko.downloads.cancel(slow?.id);
await waitFor(() => latest(slow?.id)?.state == "canceled", "cancel() stops it");
await neeko.downloads.retry(slow?.id);
await waitFor(
  () => latest(slow?.id)?.state == "done" && latest(slow.id).received == SLOW_SIZE,
  "retry() starts it again, to the end"
);

// Opening and showing files, without really launching anything.
let { DownloadIntegration } = ChromeUtils.importESModule(
  "resource://gre/modules/DownloadIntegration.sys.mjs"
);
let { launchFile, showContainingDirectory } = DownloadIntegration;
let launched = [];
let revealed = [];
DownloadIntegration.launchFile = file => launched.push(file.path);
DownloadIntegration.showContainingDirectory = async path => revealed.push(path);
try {
  await neeko.downloads.open(slow?.id);
  await waitFor(
    () => launched[0]?.endsWith("/neeko-slow.bin"),
    "open() opens the file"
  );
  await neeko.downloads.show(slow?.id);
  check(revealed[0]?.endsWith("/neeko-slow.bin"), "show() shows it in Finder");
} finally {
  Object.assign(DownloadIntegration, { launchFile, showContainingDirectory });
}

await neeko.nav.go(`${BASE}/download-broken`);
let broken = await waitFor(() => started("neeko-broken.bin"), "a download that breaks off");
await waitFor(
  () => latest(broken?.id)?.state == "failed" && latest(broken.id).error == "network",
  "is reported failed, because of the network"
);
await rejects(neeko.downloads.open(broken?.id), /hasn't finished/, "open() of a failed download");
await rejects(neeko.downloads.cancel(999999), /No download/, "cancel() of an unknown download");
await rejects(neeko.downloads.show("1"), /download id/, "show() with a string");
await neeko.downloads.remove(broken?.id);
await waitFor(
  () => downloadEvents.some(e => e.type == "remove" && e.id == broken?.id),
  "remove() takes it off the list"
);
check(
  !(await neeko.downloads.list()).some(d => d.id == broken?.id),
  "and list() no longer has it"
);
await neeko.tabs.close(downloadTab.id);

// Settings: the UI's own, saved, the same in every window, and there at once
// when a window's UI starts.
let settingEvents = [];
neeko.settings.on("change", data => settingEvents.push(data));
check(JSON.stringify(neeko.settings.all()) == "{}", "a fresh profile has no settings");
await neeko.settings.set("theme", "dark");
check(neeko.settings.get("theme") == "dark", "set() saves a setting, and get() reads it at once");
check(
  settingEvents.some(e => e.key == "theme" && e.value == "dark"),
  "with a change event, before set() resolves"
);
check(Services.prefs.getStringPref("neeko.settings.theme", "") == "dark", "it's a pref, saved with the profile");
await neeko.settings.set("sidebarOpen", true);
await neeko.settings.set("width", 240);
check(
  neeko.settings.get("sidebarOpen") === true && neeko.settings.get("width") === 240,
  "true/false and whole numbers keep their type"
);
await neeko.settings.set("width", "wide");
check(neeko.settings.get("width") === "wide", "a setting can change type");
await neeko.settings.set("width", null);
check(
  neeko.settings.get("width") === undefined &&
    !("width" in neeko.settings.all()) &&
    settingEvents.some(e => e.key == "width" && e.value === null),
  "null removes a setting, with a change event"
);
await rejects(neeko.settings.set("theme", 1.5), /whole numbers/, "set() with a fraction");
await rejects(neeko.settings.set("theme", { a: 1 }), /strings/, "set() with an object");
await rejects(neeko.settings.set("no spaces", 1), /Setting names/, "set() with a bad name");
Services.prefs.setStringPref("neeko.settings.layout", "side");
await waitFor(
  () => neeko.settings.get("layout") == "side",
  "a change from elsewhere (about:config) reaches the UI"
);

// A new window's UI has them before its first script runs, and every
// window hears every change.
let otherWindow = OpenBrowserWindow();
let otherNeeko = await waitFor(
  () => otherWindow.document?.getElementById("neeko-ui")?.contentWindow?.neeko,
  "a second window's UI"
);
check(
  otherNeeko?.settings.get("theme") == "dark" && otherNeeko.settings.get("layout") == "side",
  "it starts with the settings"
);
await otherNeeko?.settings.set("theme", "light");
await waitFor(() => neeko.settings.get("theme") == "light", "a change in one window reaches the others");

// The color scheme: web pages, Firefox's own pages and the UI's
// prefers-color-scheme follow it.
check(neeko.colorScheme.get() == "system", "the color scheme follows the system to begin with");
let schemes = [];
neeko.colorScheme.on("change", ({ colorScheme }) => schemes.push(colorScheme));
let schemeTab = await neeko.tabs.open(`${BASE}/scheme`);
await waitFor(() => updated(schemeTab.id, t => ["dark", "light"].includes(t.title)), "a page that shows its color scheme");
let uiDark = () => frame.contentWindow.matchMedia("(prefers-color-scheme: dark)").matches;
// Firefox's settings page runs in this process, so it can be asked directly.
let prefsTab = await neeko.tabs.open("about:preferences", { background: true });
let prefsBrowser = gBrowser.tabs.at(-1).linkedBrowser;
await waitFor(
  () => prefsBrowser.contentDocument?.readyState == "complete" && prefsBrowser.currentURI.spec == "about:preferences",
  "Firefox's settings page"
);
let firefoxPageDark = () =>
  prefsBrowser?.contentWindow?.matchMedia("(prefers-color-scheme: dark)").matches;
for (let scheme of ["dark", "light"]) {
  await neeko.colorScheme.set(scheme);
  check(neeko.colorScheme.get() == scheme && schemes.at(-1) == scheme, `colorScheme.set("${scheme}")`);
  await waitFor(() => updated(schemeTab.id, t => t.title == scheme), `web pages turn ${scheme}`);
  await waitFor(() => uiDark() == (scheme == "dark"), `and so does the UI's prefers-color-scheme`);
  await waitFor(() => firefoxPageDark() == (scheme == "dark"), "and Firefox's own pages");
  check(
    otherNeeko?.colorScheme.get() == scheme,
    "in every window"
  );
}
await neeko.colorScheme.set("system");
check(
  neeko.colorScheme.get() == "system" && !Services.prefs.prefHasUserValue("ui.systemUsesDarkTheme"),
  "and back to the system's"
);
await rejects(neeko.colorScheme.set("blue"), /light/, "colorScheme.set() with something else");
await neeko.tabs.close(schemeTab.id);
await neeko.tabs.close(prefsTab.id);
otherWindow.close();
await waitFor(() => otherWindow.closed, "the second window to close");
window.focus();
await waitFor(() => Services.focus.activeWindow == window, "this window to be active again", 30000);

// Tab groups: Firefox's own.
let groupEvents = [];
for (let type of ["create", "remove", "update"]) {
  neeko.groups.on(type, data => groupEvents.push({ type, ...data }));
}
let groupTabs = [];
for (let page of ["one", "two", "one"]) {
  groupTabs.push(await neeko.tabs.open(`${BASE}/${page}`, { background: true }));
}
check(groupTabs.every(t => t.groupId === null), "tabs start in no group");
let group = await neeko.groups.create([groupTabs[1].id, groupTabs[0].id], { name: "Work", color: "blue" });
check(
  group.name == "Work" && group.color == "blue" && group.collapsed === false && typeof group.id == "string",
  `create() makes a group (${JSON.stringify(group)})`
);
check(groupEvents.some(e => e.type == "create" && e.group.id == group.id), "with a create event");
check(
  [groupTabs[0], groupTabs[1]].every(t => updated(t.id, u => u.groupId == group.id)),
  "and an update for each tab that joined, with its groupId"
);
check((await neeko.groups.list()).some(g => g.id == group.id), "list() has it");
let order = (await neeko.tabs.list()).map(t => t.id);
check(
  order.indexOf(groupTabs[1].id) == order.indexOf(groupTabs[0].id) + 1,
  "its tabs stay together, where the first of them was"
);
let recolored = await neeko.groups.update(group.id, { name: "Play", color: "red" });
check(recolored.name == "Play" && recolored.color == "red", "update() renames and recolors");
await waitFor(
  () => groupEvents.some(e => e.type == "update" && e.group.color == "red" && e.changed.includes("color")),
  "with update events"
);
await neeko.groups.update(group.id, { collapsed: true });
await waitFor(
  () => groupEvents.some(e => e.type == "update" && e.group.collapsed && e.changed.join() == "collapsed"),
  "update() collapses it"
);
await neeko.groups.update(group.id, { collapsed: false });
await neeko.tabs.setGroup(group.id, groupTabs[2].id);
await waitFor(() => updated(groupTabs[2].id, t => t.groupId == group.id), "setGroup() puts a tab in a group");
await neeko.tabs.setGroup(null, groupTabs[2].id);
await waitFor(() => updated(groupTabs[2].id, t => t.groupId === null), "setGroup(null) takes it out");
let defaultColored = await neeko.groups.create([groupTabs[2].id]);
check(defaultColored.color && defaultColored.color != "red", `a new group gets an unused color (${defaultColored.color})`);
await rejects(neeko.groups.create([]), /tabs to group/, "create() with no tabs");
await rejects(neeko.groups.update(group.id, { color: "plaid" }), /color is one of/, "update() with an unknown color");
await rejects(neeko.groups.ungroup("nope"), /No tab group/, "ungroup() of an unknown group");
await neeko.groups.ungroup(group.id);
await waitFor(() => groupEvents.some(e => e.type == "remove" && e.id == group.id), "ungroup() ends the group");
check(
  (await neeko.tabs.list()).filter(t => [groupTabs[0].id, groupTabs[1].id].includes(t.id)).every(t => t.groupId === null),
  "its tabs stay, in no group"
);
await neeko.tabs.close(groupTabs[2].id);
await waitFor(
  () => groupEvents.some(e => e.type == "remove" && e.id == defaultColored.id),
  "a group goes when its last tab closes"
);
for (let t of groupTabs.slice(0, 2)) {
  await neeko.tabs.close(t.id);
}

// The browser's own pages: pages/<name>.html as about:<name>, in Firefox's
// privileged about: process, with neekoPage and nothing more.
let { NeekoPages } = ChromeUtils.importESModule("moz-src:///browser/neeko/NeekoPages.sys.mjs");
check(
  NeekoPages.names.join() == "start",
  `pages/start.html is served, and not pages/preferences.html, Firefox's own name (${NeekoPages.names})`
);
let startTab = await neeko.tabs.open("about:start");
let startPage = await waitFor(() => updated(startTab.id, t => t.title.includes(",")), "about:start");
check(startPage?.tab.title == "object,undefined,undefined,false", `it has neekoPage, no privileges and no neeko, and isn't private (${startPage?.tab.title})`);
check(gBrowser.selectedBrowser.remoteType == "privilegedabout", `in the privileged about: process (${gBrowser.selectedBrowser.remoteType})`);
check(
  gBrowser.selectedBrowser.contentPrincipal.isContentPrincipal &&
    gBrowser.selectedBrowser.contentPrincipal.spec == "about:start",
  "with a content principal of its own"
);
check(BROWSER_NEW_TAB_URL == "about:start", "it's the New Tab page");
check(
  Services.prefs.getDefaultBranch("").getStringPref("browser.startup.homepage") == "about:start",
  "and the home page"
);
let blankTab = await neeko.tabs.open();
check(blankTab.url == "about:start" || (await waitFor(() => updated(blankTab.id, t => t.url == "about:start"), "a new tab shows it")), "Cmd+T opens it");
await neeko.tabs.close(blankTab.id);
let prefsPage = await neeko.tabs.open("about:preferences");
await new Promise(r => setTimeout(r, 500));
check(!gBrowser.selectedBrowser.isRemoteBrowser, "about:preferences stays Firefox's");
await neeko.tabs.close(prefsPage.id);
let reachTab = await neeko.tabs.open(`${BASE}/reach-start`);
await new Promise(r => setTimeout(r, 1500));
check(
  (await neeko.tabs.list()).find(t => t.id == reachTab.id)?.url == `${BASE}/reach-start`,
  "a web page can't go to the browser's own pages"
);
await neeko.tabs.close(reachTab.id);

let pageTest = async (query, expected, what) => {
  let tab = await neeko.tabs.open(`about:start?test=${query}`);
  let done = await waitFor(() => updated(tab.id, t => expected(t.title)), what);
  return { tab, title: done?.tab.title };
};
let goTest = await pageTest(`go&to=${encodeURIComponent(`${HOST}/two`)}`, title => title == "Page two", "neekoPage.go() takes its tab where the user typed");
await neeko.tabs.close(goTest.tab.id);
let jsTest = await pageTest("js", title => title.startsWith("refused"), "but not to javascript:");
await neeko.tabs.close(jsTest.tab.id);
let openedBefore = events.length;
let openTest = await pageTest(`open&to=${encodeURIComponent(`${BASE}/one`)}`, title => title == "opened", "neekoPage.open() opens a tab");
let openedTab = await waitFor(
  () => events.slice(openedBefore).find(e => e.type == "open" && e.tab.id != openTest.tab.id),
  "the tab it opened"
);
let pageTabIndex = events.find(e => e.type == "open" && e.tab.id == openTest.tab.id)?.index;
check(
  openedTab && !openedTab.tab.selected && openedTab.index == pageTabIndex + 1,
  `in the background, next to the page's tab (${openedTab?.index} after ${pageTabIndex}; ${openTest.title})`
);
if (openedTab) {
  await neeko.tabs.close(openedTab.tab.id);
}
await neeko.tabs.close(openTest.tab.id);
await neeko.settings.set("shared", "fromUI");
let settingsTest = await pageTest("settings", title => title.startsWith("read") || title.startsWith("refused"), "neekoPage.settings");
check(settingsTest.title == "read fromUI", `a page reads the UI's settings (${settingsTest.title})`);
await waitFor(() => neeko.settings.get("fromPage") == "yes", "and writes them, for the UI too");
await neeko.tabs.close(settingsTest.tab.id);
let listenTest = await pageTest("listen", title => title == "listening", "a page listening for settings changes");
await neeko.settings.set("ping", "1");
await waitFor(() => updated(listenTest.tab.id, t => t.title == "change ping=1"), "hears them");
await neeko.tabs.close(listenTest.tab.id);
let { SearchService } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");
let engines = await SearchService.getVisibleEngines();
let enginesTest = await pageTest("engines", title => title.startsWith("engines") || title.startsWith("refused"), "neekoPage.search.engines()");
check(enginesTest.title == `engines ${engines.length} 1`, `lists the search engines, one of them the default (${enginesTest.title})`);
await neeko.tabs.close(enginesTest.tab.id);
let defaultEngine = await SearchService.getDefault();
let otherEngine = engines.find(e => e.id != defaultEngine.id);
if (otherEngine) {
  let defaultTest = await pageTest(`default&id=${otherEngine.id}`, title => title == "default set" || title.startsWith("refused"), "neekoPage.search.setDefault()");
  check((await SearchService.getDefault()).id == otherEngine.id, `sets the default search engine (${defaultTest.title})`);
  await SearchService.setDefault(defaultEngine, SearchService.CHANGE_REASON.USER);
  await neeko.tabs.close(defaultTest.tab.id);
}
await neeko.tabs.close(startTab.id);

// Private windows show the start page too, first and in new tabs, instead of
// Firefox's about:privatebrowsing, and it knows it's private.
let privateWin = OpenBrowserWindow({ private: true });
await waitFor(() => privateWin.gBrowserInit?.delayedStartupFinished, "a private window");
let privateTab = privateWin.gBrowser.selectedTab;
await waitFor(
  () => privateTab.linkedBrowser.currentURI.spec == "about:start" && privateTab.label.includes(","),
  `its first tab shows the start page (${privateTab.linkedBrowser.currentURI.spec})`
);
check(privateTab.label == "object,undefined,undefined,true", `and neekoPage.private is true there (${privateTab.label})`);
privateWin.BrowserCommands.openTab();
await waitFor(
  () => privateWin.gBrowser.selectedTab != privateTab && privateWin.gBrowser.selectedBrowser.currentURI.spec == "about:start",
  "a new tab in it shows the start page"
);
privateWin.close();
window.focus();
await waitFor(() => Services.focus.activeWindow == window, "this window to be active again", 30000);

// Bookmarks: Firefox's own, identified by ids that last across sessions.
let folders = neeko.bookmarks.folders;
check(
  folders.toolbar == "toolbar_____" && folders.other == "unfiled_____",
  `the folders every profile has (${JSON.stringify(folders)})`
);
let bookmarkEvents = [];
for (let type of ["add", "remove", "move", "update"]) {
  neeko.bookmarks.on(type, data => bookmarkEvents.push({ type, ...data }));
}
await neeko.tabs.current();
let toolbarBefore = await neeko.bookmarks.list();
// A page whose icon Firefox has stored, to bookmark.
let iconPage = `${BASE}/icon`;
let bookmarkTab = await neeko.tabs.open(iconPage);
await waitFor(
  async () => !!(await PlacesUtils.favicons.getFaviconForPage(Services.io.newURI(iconPage))),
  "Firefox to store the page's icon"
);
let saved = await neeko.bookmarks.add({ url: iconPage, title: "Icon page" });
check(
  saved.type == "bookmark" && saved.parentId == folders.toolbar && saved.title == "Icon page" && saved.url == iconPage,
  "add() bookmarks a page, on the toolbar by default"
);
check(saved.icon == `page-icon:${iconPage}`, `with its icon (${saved.icon})`);
let markImage = new frame.contentWindow.Image();
markImage.src = saved.icon;
check(await markImage.decode().then(() => markImage.naturalWidth > 0, () => false), "which the UI can show");
await waitFor(
  () => bookmarkEvents.some(e => e.type == "add" && e.bookmark.id == saved.id && e.index == toolbarBefore.length),
  "an add event, with its position"
);
let toolbarNow = await neeko.bookmarks.list();
check(
  toolbarNow.at(-1)?.id == saved.id && toolbarNow.length == toolbarBefore.length + 1,
  "list() has it, at the end"
);
check((await neeko.bookmarks.find(iconPage)).map(b => b.id).join() == saved.id, "find() finds it by its URL");
check((await neeko.bookmarks.find(`${BASE}/two`)).length == 0, "and nothing for a page that isn't bookmarked");
check((await neeko.bookmarks.get(saved.id)).title == "Icon page", "get()");

// Folders and separators; renaming, moving, removing.
let folder = await neeko.bookmarks.add({ type: "folder", title: "Stuff" });
let separator = await neeko.bookmarks.add({ type: "separator" });
check(
  folder.type == "folder" && folder.url === null && separator.type == "separator",
  "add() makes folders and separators"
);
let inside = await neeko.bookmarks.add({ url: `${BASE}/one`, title: "One", parentId: folder.id });
check((await neeko.bookmarks.list(folder.id)).map(b => b.id).join() == inside.id, "list() of a folder");
check(inside.icon === null, "a page without an icon has none");
await rejects(neeko.bookmarks.list(inside.id), /isn't a folder/, "list() of a bookmark");
check((await neeko.bookmarks.update(saved.id, { title: "Renamed" })).title == "Renamed", "update() renames");
await waitFor(
  () => bookmarkEvents.some(e => e.type == "update" && e.bookmark.id == saved.id && e.bookmark.title == "Renamed" && e.changed.includes("title")),
  "with an update event"
);
await neeko.bookmarks.update(saved.id, { url: `${BASE}/two` });
await waitFor(
  () => bookmarkEvents.some(e => e.type == "update" && e.bookmark.url == `${BASE}/two` && e.changed.includes("url")),
  "update() changes the URL"
);
await neeko.bookmarks.update(saved.id, { parentId: folder.id, index: 0 });
await waitFor(
  () => bookmarkEvents.some(e => e.type == "move" && e.id == saved.id && e.parentId == folder.id && e.index == 0 && e.oldParentId == folders.toolbar),
  "update() moves it into a folder, with a move event"
);
check(
  (await neeko.bookmarks.list(folder.id)).map(b => b.id).join() == [saved.id, inside.id].join(),
  "at the position asked"
);
await neeko.bookmarks.remove(folder.id);
await waitFor(
  () => bookmarkEvents.some(e => e.type == "remove" && e.id == folder.id && e.parentId == folders.toolbar),
  "remove() removes a folder, with a remove event"
);
check(
  !bookmarkEvents.some(e => e.type == "remove" && [saved.id, inside.id].includes(e.id)),
  "just one event, for the folder"
);
check((await neeko.bookmarks.find(`${BASE}/two`)).length == 0, "and what was in it goes too");
await neeko.bookmarks.remove(separator.id);

// Tags are bookmarks in a folder Firefox hides; they stay out.
let tagged = await neeko.bookmarks.add({ url: `${BASE}/one`, title: "Tagged" });
let beforeTagging = bookmarkEvents.length;
PlacesUtils.tagging.tagURI(Services.io.newURI(`${BASE}/one`), ["neeko-test"]);
await new Promise(r => setTimeout(r, 300));
check(bookmarkEvents.length == beforeTagging, "tagging a page doesn't look like bookmarks being added");
check((await neeko.bookmarks.find(`${BASE}/one`)).length == 1, "find() doesn't count tags");
check(!(await neeko.bookmarks.list(folders.toolbar)).some(b => b.title == "neeko-test"), "nor does list()");
PlacesUtils.tagging.untagURI(Services.io.newURI(`${BASE}/one`), ["neeko-test"]);
await neeko.bookmarks.remove(tagged.id);

await rejects(neeko.bookmarks.add({ url: "not a url" }), /URL/, "add() with a bad URL");
await rejects(neeko.bookmarks.add({ title: "Nothing" }), /url, or type/, "add() with neither a URL nor a type");
await rejects(neeko.bookmarks.get("nope"), /No bookmark/, "get() of an unknown bookmark");

// Cmd+D: the UI bookmarks the page itself if it listens, and otherwise
// Firefox's own bookmark panel opens at the top of the page.
let requests = [];
let stopRequests = neeko.bookmarks.on("request", data => requests.push(data));
await neeko.tabs.current();
let bookmarkPage = () => document.getElementById("Browser:AddBookmarkAs").doCommand();
bookmarkPage();
await waitFor(() => requests[0]?.tabId == bookmarkTab.id, "Cmd+D reaches a UI that listens, with the tab");
await new Promise(r => setTimeout(r, 300));
check(
  StarUI.panel.state == "closed" && !(await neeko.bookmarks.find(iconPage)).length,
  "and Firefox neither opens its panel nor bookmarks the page"
);
stopRequests();
await neeko.tabs.current();
bookmarkPage();
await waitFor(() => StarUI.panel.state == "open", "without a listener, Firefox's bookmark panel opens");
check(hangsFrom(StarUI.panel, "right"), `at the top right of the page (${where(StarUI.panel)})`);
StarUI.panel.hidePopup();
await waitFor(async () => (await neeko.bookmarks.find(iconPage)).length == 1, "and bookmarks the page");
for (let bookmark of await neeko.bookmarks.find(iconPage)) {
  await neeko.bookmarks.remove(bookmark.id);
}
await neeko.tabs.close(bookmarkTab.id);

// The menus: only what the app keeps (the test's neeko.menus pref), with
// the separators tidied. Firefox's own menus are the fallback.
let shownIn = popup =>
  [...popup.children].filter(item => !item.hidden && !item.collapsed);
let tidy = popup => {
  let shown = shownIn(popup).map(item => item.localName == "menuseparator");
  return !shown[0] && !shown.at(-1) && !shown.some((sep, i) => sep && shown[i + 1]);
};
let hiddenMenu = id => document.getElementById(id).hidden;
check(
  !hiddenMenu("file-menu") && !hiddenMenu("edit-menu") && !hiddenMenu("windowMenu") &&
    hiddenMenu("view-menu") && hiddenMenu("history-menu") && hiddenMenu("tools-menu"),
  "the menu bar has only the app's menus"
);
let filePopup = document.getElementById("menu_FilePopup");
filePopup.dispatchEvent(new Event("popupshowing", { bubbles: true }));
let fileItems = shownIn(filePopup).map(item => item.id).filter(Boolean);
check(
  fileItems.includes("menu_newNavigatorTab") &&
    fileItems.includes("menu_close") &&
    !fileItems.includes("menu_openFile") &&
    !fileItems.includes("menu_print") &&
    tidy(filePopup),
  `and in them only the app's items, tidily (${fileItems})`
);
let linkTab = await neeko.tabs.open(`${BASE}/link`);
await waitFor(() => updated(linkTab.id, t => t.title == "link" && !t.loading), "a page with a link");
let contextMenu = document.getElementById("contentAreaContextMenu");
let rightClick = async (x, y) => {
  let shown = new Promise(r => contextMenu.addEventListener("popupshown", r, { once: true }));
  let page = gBrowser.selectedBrowser.getBoundingClientRect();
  for (let type of ["mousedown", "contextmenu", "mouseup"]) {
    synthesizeMouseEvent(type, page.left + x, page.top + y, { button: 2 });
  }
  return Promise.race([shown.then(() => true), new Promise(r => setTimeout(() => r(false), 5000))]);
};
if (await waitFor(() => rightClick(30, 30), "the context menu on a link")) {
  await new Promise(r => setTimeout(r, 300));
  let items = shownIn(contextMenu).map(item => item.id).filter(Boolean);
  check(
    items.includes("context-openlinkintab") &&
      items.includes("context-copylink") &&
      !items.includes("context-openlink") &&
      !items.includes("context-inspect") &&
      !items.includes("context-ask-chat") &&
      tidy(contextMenu),
    `it has only the app's items for a link, tidily (${items})`
  );
  contextMenu.hidePopup();
}
await neeko.tabs.close(linkTab.id);

// Cmd+, (Settings... in the app menu): the UI shows its own settings if it
// listens, and otherwise Firefox's settings open.
let settingsRequests = [];
let stopSettings = neeko.settings.on("request", data => settingsRequests.push(data));
await neeko.tabs.current();
let tabsBeforeSettings = gBrowser.tabs.length;
document.getElementById("menu_preferences").doCommand();
await waitFor(() => settingsRequests.length == 1, "Cmd+, reaches a UI that listens");
await new Promise(r => setTimeout(r, 300));
check(gBrowser.tabs.length == tabsBeforeSettings, "and Firefox's settings stay closed");
stopSettings();
// From a web page: Firefox would open its settings in place of a New Tab
// page.
let settingsFrom = await neeko.tabs.open(`${BASE}/one`);
await waitFor(() => updated(settingsFrom.id, t => t.title == "Page one" && !t.loading), "a page to open settings from");
document.getElementById("menu_preferences").doCommand();
let firefoxSettings = await waitFor(
  () => gBrowser.tabs.find(tab => tab.linkedBrowser.currentURI.spec.startsWith("about:preferences")),
  "without a listener, Firefox's settings open"
);
if (firefoxSettings) {
  gBrowser.removeTab(firefoxSettings);
}
await neeko.tabs.close(settingsFrom.id);

// Find in page: Cmd+F, Cmd+G and Cmd+Shift+G go to a UI that listens, and
// Firefox's find does the finding.
let findTab = await neeko.tabs.open(`${BASE}/find`);
await waitFor(() => updated(findTab.id, t => t.title == "find" && !t.loading), "a page to find in");
let findRequests = [];
let stopFind = neeko.find.on("request", data => findRequests.push(data));
await neeko.tabs.current();
for (let id of ["cmd_find", "cmd_findAgain", "cmd_findPrevious"]) {
  document.getElementById(id).doCommand();
}
await waitFor(() => findRequests.length == 3, "Cmd+F, Cmd+G and Cmd+Shift+G reach a UI that listens");
check(
  findRequests.map(r => r.command).join() == "find,next,previous" &&
    typeof findRequests[0].selection == "string",
  `as find, next and previous, with the page's selection (${JSON.stringify(findRequests)})`
);
check(
  !gBrowser.isFindBarInitialized(gBrowser.selectedTab) || gBrowser.getCachedFindBar().hidden,
  "and Firefox's find bar stays closed"
);
let found = await neeko.find.find("fox");
check(
  found.result == "found" && found.current == 1 && found.total == 3,
  `find() finds the first of every match (${JSON.stringify(found)})`
);
found = await neeko.find.next();
check(found.result == "found" && found.current == 2, `next() goes to the next one (${JSON.stringify(found)})`);
await neeko.find.next();
found = await neeko.find.next();
check(found.result == "wrapped" && found.current == 1, `and wraps around at the end (${JSON.stringify(found)})`);
found = await neeko.find.previous();
check(found.result == "wrapped" && found.current == 3, `previous() goes back, around the start (${JSON.stringify(found)})`);
found = await neeko.find.find("Fox", { caseSensitive: true });
check(found.result == "found" && found.total == 1, `caseSensitive finds only "Fox" (${JSON.stringify(found)})`);
found = await neeko.find.find("zebra");
check(found.result == "notFound" && found.total == 0, `and what isn't there isn't found (${JSON.stringify(found)})`);
// Highlighting every match: asked for before a tab's first search, or
// before its page changes, it still applies (Firefox's finder in a page
// starts without it). The test paints highlighted matches red.
let redPixels = async () => {
  let page = gBrowser.selectedBrowser.getBoundingClientRect();
  let area = new DOMRect(page.left, page.top, Math.min(page.width, 700), 80);
  let bitmap = await browsingContext.currentWindowGlobal.drawSnapshot(area, 1, "white");
  let canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  let context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0);
  let data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let red = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) {
      red++;
    }
  }
  return red;
};
await neeko.find.close();
let highlightTab = await neeko.tabs.open(`${BASE}/find`);
await waitFor(() => updated(highlightTab.id, t => t.title == "find" && !t.loading), "a fresh page to highlight in");
await neeko.find.highlight(true);
await neeko.find.find("fox");
await waitFor(async () => (await redPixels()) > 0, "highlight() before the first search highlights every match");
await neeko.nav.go(`${BASE}/find-again`);
await waitFor(
  () => updated(highlightTab.id, t => t.title == "find again" && !t.loading),
  "the tab going to another page"
);
check((await redPixels()) == 0, "which starts with nothing highlighted");
await neeko.find.find("fox");
await waitFor(async () => (await redPixels()) > 0, "and a search there highlights every match again");
await neeko.find.close();
await waitFor(async () => (await redPixels()) == 0, "close() takes the highlights away");
await neeko.tabs.close(highlightTab.id);
await neeko.tabs.select(findTab.id);
await rejects(neeko.find.find(3), /text to find/, "find() without text");
await rejects(neeko.find.find("x", { wholeWords: true }), /Unknown option/, "find() with an unknown option");
stopFind();
await neeko.tabs.current();
document.getElementById("cmd_find").doCommand();
await waitFor(
  () => gBrowser.isFindBarInitialized(gBrowser.selectedTab) && !gBrowser.getCachedFindBar().hidden,
  "without a listener, Firefox's find bar opens"
);
gBrowser.getCachedFindBar().close(true);
await neeko.tabs.close(findTab.id);

// The link the pointer is over, and loading pages' status messages: a UI
// that listens shows them itself, and Firefox's status bubble doesn't.
let statusEvents = [];
let stopLink = neeko.status.on("link", data => statusEvents.push({ type: "link", ...data }));
let stopMessage = neeko.status.on("message", data => statusEvents.push({ type: "message", ...data }));
let hoverTab = await neeko.tabs.open(`${BASE}/link`);
await waitFor(() => updated(hoverTab.id, t => t.title == "link" && !t.loading), "a page with a link to point at");
let hoverRect = gBrowser.selectedBrowser.getBoundingClientRect();
let statusBubble = document.getElementById("statuspanel");
synthesizeMouseEvent("mousemove", hoverRect.left + 30, hoverRect.top + 30, {});
let linkEvent = await waitFor(
  () => statusEvents.find(e => e.type == "link" && e.url == `${BASE}/one`),
  "the link the pointer is over reaches the UI"
);
check(linkEvent?.text.endsWith("/one"), `with Firefox's text for it (${linkEvent?.text})`);
// Past Firefox's delay before its bubble shows (browser.overlink-delay).
await new Promise(r => setTimeout(r, 400));
check(getComputedStyle(statusBubble).visibility == "hidden", "and Firefox's status bubble stays hidden");
synthesizeMouseEvent("mousemove", hoverRect.left + 400, hoverRect.top + 300, {});
await waitFor(
  () => statusEvents.at(-1)?.type == "link" && statusEvents.at(-1).url == "",
  "off the link, the UI hears it's gone"
);
await neeko.nav.go(`${BASE}/slow-page`);
let loadingMessage = await waitFor(
  () => statusEvents.find(e => e.type == "message" && e.tabId == hoverTab.id && e.message),
  "a loading page's status message reaches the UI"
);
await waitFor(
  () => statusEvents.findLast(e => e.type == "message" && e.tabId == hoverTab.id)?.message === "",
  `and goes once it's loaded (it said "${loadingMessage?.message}")`
);
stopLink();
stopMessage();
await neeko.nav.go(`${BASE}/link`);
await waitFor(() => updated(hoverTab.id, t => t.title == "link" && !t.loading), "the page with the link again");
synthesizeMouseEvent("mousemove", hoverRect.left + 30, hoverRect.top + 30, {});
await waitFor(
  () =>
    statusBubble.getAttribute("type") == "overLink" &&
    !statusBubble.hasAttribute("inactive") &&
    getComputedStyle(statusBubble).visibility == "visible",
  "without a listener, Firefox's status bubble shows the link"
);
synthesizeMouseEvent("mousemove", hoverRect.left + 400, hoverRect.top + 300, {});
await neeko.tabs.close(hoverTab.id);

// Neeko sends only the events the UI listens for.
let heardSelect = 0;
let stopSelect = neeko.tabs.on("select", () => heardSelect++);
let other = await neeko.tabs.open(`${BASE}/one`);
check(heardSelect == 1, "a listened event arrives");
stopSelect();
await neeko.tabs.select(first.id);
check(heardSelect == 1, "an event nobody listens for doesn't");
await neeko.tabs.close(other.id);

// Reloading the UI gives it a fresh neeko with the same tab ids, and the old
// one stops hearing events.
let before = events.length;
frame.contentWindow.location.reload();
let fresh = await waitFor(
  () => frame.contentWindow.neeko != neeko && frame.contentWindow.neeko,
  "neeko after a UI reload"
);
check(
  (await fresh.tabs.current()).id == first.id,
  "tab ids survive a UI reload"
);
check(fresh.settings.get("theme") == "light", "and so do the settings");
let heard = [];
fresh.tabs.on("open", data => heard.push(data));
let extra = await fresh.tabs.open(`${BASE}/one`);
check(heard.some(e => e.tab.id == extra.id), "the new neeko hears events");
check(events.length == before, "the old neeko hears nothing");
await fresh.tabs.close(extra.id);

return results;
