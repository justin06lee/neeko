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

check(Object.isFrozen(neeko) && Object.isFrozen(neeko.tabs), "neeko is frozen");

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
