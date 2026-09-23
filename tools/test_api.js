// Checks for the Neeko API, run by tools/test_api.py inside a browser window
// (chrome context: window is the browser window). It drives the API the way
// a UI would, through the `neeko` object in the UI page, and returns one line
// per check.

const BASE = "__BASE__";
const HOST = BASE.replace("http://", "");

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
  ["id", "url", "title", "loading", "canGoBack", "canGoForward", "selected"].every(
    k => k in first
  ),
  "tabs have every field"
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
  probed?.tab.title == "undefined,undefined,undefined",
  `web pages have no neeko (${probed?.tab.title})`
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
await rejects(
  neeko.prompts.answer(request?.id, 0),
  /Too soon/,
  "allowing right away is refused, against clickjacking"
);
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
let heard = [];
fresh.tabs.on("open", data => heard.push(data));
let extra = await fresh.tabs.open(`${BASE}/one`);
check(heard.some(e => e.tab.id == extra.id), "the new neeko hears events");
check(events.length == before, "the old neeko hears nothing");
await fresh.tabs.close(extra.id);

return results;
