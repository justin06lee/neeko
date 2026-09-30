// Checks for containers (NeekoContainers), run by tools/test_api.py inside a
// browser launched with the test's containers: personal (the default), work,
// and private (ephemeral). Like test_api.js, it runs in a browser window and
// returns one line per check.

const BASE = "__BASE__";

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

let { SessionStore } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/SessionStore.sys.mjs");
let system = Services.scriptSecurityManager.getSystemPrincipal();
let uiOf = win => win.document.getElementById("neeko-ui")?.contentWindow;
let neekoOf = (win, what) => waitFor(() => uiOf(win)?.neeko, what);
let urls = win => win.gBrowser.tabs.map(t => t.linkedBrowser.currentURI.spec);

// Resolves with the next browser window to finish starting, once open()
// has opened it.
function opened(open) {
  let window = new Promise(resolve => {
    let observer = subject => {
      Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
      resolve(subject);
    };
    Services.obs.addObserver(observer, "browser-delayed-startup-finished");
  });
  open();
  return window;
}

function closed(win) {
  if (win.closed) {
    return Promise.resolve();
  }
  let done = new Promise(r => win.addEventListener("unload", r, { once: true }));
  win.close();
  return done;
}

let neeko = await neekoOf(window, "the UI's neeko");
if (!neeko) {
  return results;
}
await waitFor(() => window.gBrowserInit?.delayedStartupFinished, "startup");
window.focus();
await waitFor(() => Services.focus.activeWindow == window, "the window to be active", 30000);

// The first window has no container: it loads nothing, and what it's asked
// to open waits for the UI to pick one.
check(neeko.window.container === null, "a new window has no container");
let list = await neeko.containers.list();
check(
  JSON.stringify(list.map(c => [c.id, c.default, c.ephemeral])) ==
    '[["personal",true,false],["work",false,false],["private",false,true]]',
  `the app's containers, the default one Firefox's default context (${JSON.stringify(list)})`
);
check(urls(window).every(url => url == "about:blank"), `and loads nothing (${urls(window)})`);
gBrowser.addTrustedTab(`${BASE}/two`);
await new Promise(r => setTimeout(r, 300));
check(!urls(window).includes(`${BASE}/two`), "what it's asked to open waits");

let heard = [];
neeko.window.on("container", ({ container }) => heard.push(container));
await neeko.window.setContainer("work");
await waitFor(
  () => neeko.window.container == "work" && heard.includes("work"),
  "setContainer() puts the window in a container, and says so"
);
await waitFor(
  () => urls(window).join() == `${BASE}/two`,
  `what waited opens in it, and the blank tabs go (${urls(window)})`
);
let workContext = gBrowser.selectedTab.userContextId;
check(workContext >= 1000, `in a user context of Neeko's own (${workContext})`);
let tab = await neeko.tabs.open(`${BASE}/one`);
check(
  gBrowser.selectedTab.userContextId == workContext,
  "tabs opened in the window are in its container"
);
await rejects(neeko.window.setContainer("personal"), /already has a container/, "a window keeps its container");

// "Open Link in New Window" keeps the container.
let linked = await opened(() =>
  openLinkIn(`${BASE}/one`, "window", { userContextId: workContext, triggeringPrincipal: system })
);
await waitFor(
  () => uiOf(linked)?.neeko?.window.container == "work",
  "a link opened in a new window keeps the window's container"
);
check(linked.gBrowser.selectedTab.userContextId == workContext, "and so does its tab");
await closed(linked);

// A plain new window (Cmd+N) waits for a pick; the default container is
// Firefox's default context.
let plain = await opened(() => OpenBrowserWindow());
let plainNeeko = await neekoOf(plain, "a plain new window's UI");
check(plainNeeko?.window.container === null, "a plain new window has no container");
await rejects(plainNeeko.window.setContainer("nope"), /No container/, "an unknown container is refused");
await plainNeeko?.window.setContainer("personal");
await waitFor(
  () => plainNeeko.window.container == "personal" && plain.gBrowser.selectedTab.userContextId == 0,
  "the default container is Firefox's default context"
);
await closed(plain);

// A private window is in the ephemeral container.
let privateWin = await opened(() => OpenBrowserWindow({ private: true }));
await waitFor(
  () => uiOf(privateWin)?.neeko?.window.container == "private",
  "a private window is in the ephemeral container"
);
let privateContext = privateWin.gBrowser.selectedTab.userContextId;
check(privateContext >= 1000 && privateContext != workContext, `with a user context of its own (${privateContext})`);
await closed(privateWin);

// Picking an ephemeral container in a normal window replaces it with a
// private one, at the same place.
let normal = await opened(() => OpenBrowserWindow());
let normalNeeko = await neekoOf(normal, "another new window's UI");
let place = [normal.screenX, normal.screenY, normal.outerWidth, normal.outerHeight].join();
let replacement = await opened(() => normalNeeko.window.setContainer("private"));
await waitFor(() => normal.closed, "picking an ephemeral container replaces a normal window");
check(
  PrivateBrowsingUtils.isWindowPrivate(replacement) &&
    uiOf(replacement)?.neeko?.window.container == "private",
  "with a private one, in that container"
);
// (The window manager may take a moment to follow.)
let replacedAt = () => [replacement.screenX, replacement.screenY, replacement.outerWidth, replacement.outerHeight].join();
await waitFor(() => replacedAt() == place, `at the same place and size (${place})`, 5000);
if (replacedAt() != place) {
  check(false, `(it's at ${replacedAt()})`);
}
await closed(replacement);

// Tabs of another container can't move in.
let personal = await opened(() => OpenBrowserWindow());
let personalNeeko = await neekoOf(personal, "a window for the default container");
await personalNeeko.window.setContainer("personal");
check(personal.gBrowser.adoptTab(gBrowser.selectedTab) === null, "a tab of another container can't move into a window");
await closed(personal);

// A window closed and reopened comes back in its container.
let reopen = await opened(() => OpenBrowserWindow());
let reopenNeeko = await neekoOf(reopen, "a window to close and reopen");
await reopenNeeko.window.setContainer("work");
reopen.openTrustedLinkIn(`${BASE}/one`, "current");
await waitFor(() => urls(reopen).join() == `${BASE}/one`, "a page in it");
await closed(reopen);
await new Promise(r => setTimeout(r, 500));
let reopened = await opened(() => SessionStore.undoCloseWindow(0));
await waitFor(
  () => uiOf(reopened)?.neeko?.window.container == "work",
  "a reopened window comes back in its container"
);
check(reopened.gBrowser.selectedTab.userContextId == workContext, "with its tab in it");
await closed(reopened);

// Managing containers.
let changes = [];
neeko.containers.on("change", ({ containers }) => changes.push(containers));
let created = await neeko.containers.create({ name: "Test One", color: "#ff0000" });
check(
  created.id == "test-one" && !created.default && !created.ephemeral && changes.at(-1)?.length == 4,
  `create() makes one, and says so (${JSON.stringify(created)})`
);
let renamed = await neeko.containers.update("test-one", { name: "Renamed", picture: "pictures/test.svg" });
check(renamed.name == "Renamed" && renamed.picture == "pictures/test.svg", "update() renames one");
// Ephemeral or not, only while none of its windows is open, and its closed
// windows are forgotten.
async function closeOneIn(id) {
  let win = await opened(() => OpenBrowserWindow());
  let winNeeko = await neekoOf(win, `a window in ${id}`);
  await winNeeko.window.setContainer(id);
  win.openTrustedLinkIn(`${BASE}/one`, "current");
  await waitFor(() => urls(win).join() == `${BASE}/one`, "a page in it");
  await closed(win);
}
let closedIn = id =>
  SessionStore.getClosedWindowData().filter(data => data.extData?.["neeko-container"] == id).length;
await rejects(neeko.containers.update("work", { ephemeral: true }), /windows is open/, "a container with open windows can't become ephemeral");
await rejects(neeko.containers.update("personal", { ephemeral: true }), /default/, "the default container can't be ephemeral");
await closeOneIn("test-one");
await waitFor(() => closedIn("test-one") == 1, "a closed window of it to reopen");
let madeEphemeral = await neeko.containers.update("test-one", { ephemeral: true });
check(madeEphemeral.ephemeral, "a container without open windows can become ephemeral");
check(closedIn("test-one") == 0, "and its closed windows are forgotten");
let madeNormal = await neeko.containers.update("test-one", { ephemeral: false });
check(!madeNormal.ephemeral, "and stop being");
await rejects(neeko.containers.create({ name: "" }), /name/, "create() without a name");
await rejects(neeko.containers.create({ name: "x", color: "red; }" }), /color/, "create() with a bad color");
await rejects(neeko.containers.remove("personal"), /default/, "the default container can't be removed");

await closeOneIn("test-one");
let doomed = await opened(() => OpenBrowserWindow());
let doomedNeeko = await neekoOf(doomed, "a window in the new container");
await doomedNeeko.window.setContainer("test-one");
await waitFor(() => doomedNeeko.window.container == "test-one", "the window is in it");
await neeko.containers.remove("test-one");
await waitFor(
  () => doomedNeeko.window.container === null,
  "removing a container sends its windows back to the picker"
);
check(!(await neeko.containers.list()).some(c => c.id == "test-one"), "and it's gone");
check(closedIn("test-one") == 0, "with its closed windows");
await closed(doomed);

// Clearing one wipes what it keeps.
let cookieHost = "neeko-test.example";
Services.cookies.add(
  cookieHost, "/", "neeko", "1", false, false, true, Date.now() + 3600000,
  { userContextId: workContext }, Ci.nsICookie.SAMESITE_UNSET, Ci.nsICookie.SCHEME_HTTP
);
let cookiesIn = context =>
  Services.cookies.getCookiesWithOriginAttributes(JSON.stringify({ userContextId: context }), cookieHost).length;
check(cookiesIn(workContext) == 1, "a cookie in a container");
await neeko.containers.clear("work");
await waitFor(() => cookiesIn(workContext) == 0, "clear() wipes what the container keeps");

// The browser's own pages know their tab's container.
let pageTab = await neeko.tabs.open("about:start?test=container");
await waitFor(
  () => gBrowser.selectedTab.label == "container work",
  "a page knows its tab's container (neekoPage.container)"
);
await neeko.tabs.close(pageTab.id);
// Making one ephemeral, or not, wipes it: a page needs a click for that.
let ephemeralTab = await neeko.tabs.open("about:start?test=ephemeral-now&id=private");
let ephemeralTitle = await waitFor(
  () => /^(updated|refused)/.test(gBrowser.selectedTab.label) && gBrowser.selectedTab.label,
  "a page making a container ephemeral without a click"
);
check(/refused.*click/.test(ephemeralTitle), `is refused (${ephemeralTitle})`);
await neeko.tabs.close(ephemeralTab.id);
await neeko.tabs.close(tab.id);

return results;
