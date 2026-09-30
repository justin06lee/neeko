// Checks for what a profile keeps across launches (NeekoContainers with
// session restore, and Firefox's startup bars), run by tools/test_api.py in
// three launches of one profile with the test's containers, quitting
// normally between them, as a user would. __LAUNCH__ is which one this is.
// Like test_api.js, it runs in a browser window and returns one line per
// check.

const BASE = "__BASE__";
const LAUNCH = __LAUNCH__;

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

let { SessionStore } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/SessionStore.sys.mjs");
let urls = () => gBrowser.tabs.map(t => t.linkedBrowser.currentURI.spec);
let neeko = await waitFor(
  () => document.getElementById("neeko-ui")?.contentWindow?.neeko,
  `launch ${LAUNCH}: the UI's neeko`
);
if (!neeko) {
  return results;
}
await waitFor(() => window.gBrowserInit?.delayedStartupFinished, "startup");
await SessionStore.promiseAllWindowsRestored;
// Firefox shows its startup bars once windows are restored.
await new Promise(r => setTimeout(r, 1000));

let browse = async (container, page) => {
  await neeko.window.setContainer(container);
  await waitFor(
    () => neeko.window.container == container && urls().join() == BROWSER_NEW_TAB_URL,
    `picking ${container} opens the New Tab page`
  );
  openTrustedLinkIn(`${BASE}/${page}`, "current");
  await waitFor(() => urls().join() == `${BASE}/${page}`, `a page in ${container}`);
};

if (LAUNCH == 1) {
  await browse("work", "one");
} else if (LAUNCH == 2) {
  // Without session restore (Firefox's default), the first window is new:
  // the UI picks its container, whatever the last one was in.
  check(
    neeko.window.container === null && urls().every(url => url == "about:blank"),
    `a relaunch's first window waits for the UI to pick (${neeko.window.container}, ${urls()})`
  );
  check(
    !gBrowser.getNotificationBox().getNotificationWithValue("startup-restore-session-suggestion"),
    "and Firefox doesn't offer to restore the session from its hidden menu"
  );
  await browse("personal", "two");
  Services.prefs.setIntPref("browser.startup.page", 3);
} else {
  // With it, the window comes back in its container, with its tab.
  await waitFor(
    () => neeko.window.container == "personal" && urls().join() == `${BASE}/two`,
    `with session restore, a relaunch brings the window back in its container (${neeko.window.container}, ${urls()})`
  );
  check(gBrowser.selectedTab.userContextId == 0, "with its tab in it");
}

return results;
