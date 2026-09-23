/**
 * Neeko's hook into every Firefox browser window. It runs before the window's
 * first layout, so Firefox's own UI never flashes on screen:
 *
 * 1. Hides Firefox's UI with neeko.css. Firefox's logic keeps running.
 * 2. Mounts the custom UI (index.html, from the folder in the `neeko.ui.path`
 *    pref, or else the UI bundled inside the app) in a frame that fills the
 *    window.
 * 3. Keeps the web page area on top of the UI, exactly over the element the
 *    UI marks with the `data-neeko-content` attribute.
 * 4. Gives the UI page the Neeko API, as its global `neeko` object.
 * 5. Sends Cmd+L to the UI's address bar, or shows Firefox's own address bar
 *    if the UI doesn't have one.
 *
 * With no custom UI configured, it does nothing and Firefox looks as usual.
 */

import { NeekoAPI } from "moz-src:///browser/neeko/NeekoAPI.sys.mjs";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const UI_ORIGIN = "chrome://neeko-ui/";
const UI_URL = `${UI_ORIGIN}content/index.html`;
const UI_FRAME_ID = "neeko-ui";
const SLOT_SELECTOR = "[data-neeko-content]";
const API_CLIENT_URL = "chrome://neeko/content/neeko-api.js";
// Set on the window's root while Firefox's own address bar is showing.
const ADDRESS_BAR_FALLBACK = "neeko-firefox-address-bar";

// Whether there's a custom UI, decided once per session: null until then.
let hasUI = null;

// Keeps a UI folder registered at chrome://neeko-ui/ for the whole session.
let uiRegistration = null;

// The NeekoAPI of each window's current UI page.
const apis = new WeakMap();

/**
 * Finds the custom UI, once per session, and starts watching for UI
 * documents (see onDocumentCreated). Browser windows only allow frames from
 * chrome: URLs, so the UI is always served at chrome://neeko-ui/content/,
 * which is also how it gets its privileges:
 *
 * - With the `neeko.ui.path` pref set (dev launches), from that folder.
 * - Otherwise from inside the app, where the build bundles the app's ui/
 *   folder (packaged browsers).
 *
 * @returns {boolean} false if there is no usable UI.
 */
function findUI() {
  if (hasUI === null) {
    let path = Services.prefs.getStringPref("neeko.ui.path", "");
    hasUI = path ? registerUIFolder(path) : hasBundledUI();
    if (hasUI) {
      Services.obs.addObserver(onDocumentCreated, "document-element-inserted");
    }
  }
  return hasUI;
}

/**
 * Whether the build bundled a UI (tools/app.ts puts the app's ui/ folder in
 * browser.jar as the neeko-ui chrome package).
 */
function hasBundledUI() {
  try {
    Cc["@mozilla.org/chrome/chrome-registry;1"]
      .getService(Ci.nsIChromeRegistry)
      .convertChromeURL(Services.io.newURI(UI_URL));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Serves a UI folder at chrome://neeko-ui/content/, in place of any bundled
 * UI, so dev launches pick up UI changes without a rebuild.
 *
 * @returns {boolean} false if the folder has no index.html.
 */
function registerUIFolder(path) {
  let dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  try {
    dir.initWithPath(path);
  } catch (e) {
    console.error(`Neeko: neeko.ui.path "${path}" is not a valid path.`, e);
    return false;
  }
  let index = dir.clone();
  index.append("index.html");
  if (!index.exists()) {
    console.error(`Neeko: no index.html in ${path}. Showing Firefox's UI.`);
    return false;
  }
  let aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(
    Ci.amIAddonManagerStartup
  );
  let manifestURI = Services.io.newURI(
    "manifest.json",
    null,
    Services.io.newFileURI(dir)
  );
  uiRegistration = aomStartup.registerChrome(manifestURI, [
    ["content", "neeko-ui", "./"],
  ]);
  return true;
}

/**
 * Runs as soon as any document gets its root element, before its scripts or
 * first paint. For UI documents (every load, including reloads) it adds
 * Neeko's UI helper styles, connects the API, and starts tracking the content
 * slot once the page is parsed. The frame's own "load" event never reaches
 * the browser window for chrome frames, which is why this hooks the document
 * instead.
 */
function onDocumentCreated(doc) {
  if (!doc.URL?.startsWith(UI_ORIGIN)) {
    return;
  }
  let uiWin = doc.defaultView;
  let frame = uiWin?.frameElement;
  if (frame?.id != UI_FRAME_ID) {
    return;
  }
  uiWin.windowUtils.loadSheetUsingURIString(
    "chrome://neeko/content/neeko-ui.css",
    uiWin.windowUtils.AGENT_SHEET
  );
  let win = frame.ownerDocument.defaultView;
  connectAPI(win, uiWin);
  doc.addEventListener("DOMContentLoaded", () => trackContentSlot(win, frame), {
    once: true,
  });
}

/**
 * Gives the UI page its `neeko` object before any of the page's scripts run,
 * and connects it to a NeekoAPI for this window until the page unloads.
 *
 * The UI runs in Firefox's own process here ("Become" mode), so the messages
 * go over a MessageChannel. A sandboxed UI would carry the same messages over
 * a different channel, with the same neeko-api.js on its end.
 */
function connectAPI(win, uiWin) {
  let { port1, port2 } = new uiWin.MessageChannel();
  let install = Services.scriptloader.loadSubScriptWithOptions(API_CLIENT_URL, {
    target: uiWin,
    wantReturnValue: true,
  });
  install(port2);

  let api = null;
  let unloaded = false;
  uiWin.addEventListener(
    "unload",
    () => {
      unloaded = true;
      if (api) {
        api.destroy();
        if (apis.get(win) == api) {
          apis.delete(win);
        }
      }
      port1.close();
    },
    { once: true }
  );

  // gBrowser appears at the window's DOMContentLoaded. So far the UI page has
  // always started after that, but if it ever starts first, its calls wait
  // in the port until gBrowser exists.
  let start = () => {
    if (unloaded || api) {
      return;
    }
    api = new NeekoAPI(win, message => port1.postMessage(message));
    apis.set(win, api);
    port1.onmessage = event => api.receive(event.data);
  };
  if (win.gBrowser) {
    start();
  } else {
    win.addEventListener("DOMContentLoaded", function onLoaded() {
      if (win.gBrowser) {
        win.removeEventListener("DOMContentLoaded", onLoaded);
        start();
      }
    });
  }
}

/**
 * Cmd+L (and File > Open Location) asks for the address bar. A UI that
 * listens for the "addressbar" event gets it instead of Firefox. Otherwise
 * Firefox's own address bar appears, so every UI can still go places.
 */
function handleOpenLocation(win) {
  let command = win.document.getElementById("Browser:OpenLocation");
  command?.addEventListener("command", event => {
    if (apis.get(win)?.requestAddressBar()) {
      // Firefox's own handler listens further up; it never hears this one.
      event.stopPropagation();
      return;
    }
    showFirefoxAddressBar(win);
  });
}

/**
 * The fallback for UIs without an address bar: shows Firefox's navigation
 * toolbar across the top of the window (neeko.css) until it loses focus.
 * Firefox's own Cmd+L handling runs right after and focuses it.
 */
function showFirefoxAddressBar(win) {
  let root = win.document.documentElement;
  if (root.hasAttribute(ADDRESS_BAR_FALLBACK)) {
    return;
  }
  root.setAttribute(ADDRESS_BAR_FALLBACK, "");
  let { gURLBar, gBrowser } = win;
  let input = gURLBar.inputField;
  let hide = () => {
    root.removeAttribute(ADDRESS_BAR_FALLBACK);
    input.removeEventListener("blur", hide);
    input.removeEventListener("keydown", onKeyDown);
  };
  // Escape puts focus back on the page, which hides the bar.
  let onKeyDown = event => {
    if (event.key == "Escape" && !gURLBar.view.isOpen) {
      gBrowser.selectedBrowser.focus();
    }
  };
  input.addEventListener("blur", hide);
  input.addEventListener("keydown", onKeyDown);
  // If Firefox didn't manage to focus it, don't leave it showing.
  win.setTimeout(() => {
    if (!gURLBar.focused) {
      hide();
    }
  });
}

/**
 * Keeps the page area (#tabbrowser-tabbox) over the UI's content slot. The UI
 * can move, resize, round or animate the slot and the page follows. Updates
 * are batched to at most one per frame.
 */
function trackContentSlot(win, frame) {
  let uiWin = frame.contentWindow;
  let uiDoc = frame.contentDocument;
  let tabbox = win.document.getElementById("tabbrowser-tabbox");
  let slot = null;
  let resizeObserver = new uiWin.ResizeObserver(schedule);
  let pending = false;
  let animating = 0;

  function place() {
    let current = uiDoc.querySelector(SLOT_SELECTOR);
    if (current != slot) {
      if (slot) {
        resizeObserver.unobserve(slot);
      }
      slot = current;
      if (slot) {
        resizeObserver.observe(slot);
      }
    }
    let style = tabbox.style;
    if (!slot) {
      style.width = style.height = "0";
      return;
    }
    let slotRect = slot.getBoundingClientRect();
    let frameRect = frame.getBoundingClientRect();
    style.left = `${frameRect.left + slotRect.left}px`;
    style.top = `${frameRect.top + slotRect.top}px`;
    style.width = `${slotRect.width}px`;
    style.height = `${slotRect.height}px`;
    style.borderRadius = uiWin.getComputedStyle(slot).borderRadius;
  }

  function schedule() {
    if (pending) {
      return;
    }
    pending = true;
    uiWin.requestAnimationFrame(() => {
      pending = false;
      place();
      // Positions can change every frame during a CSS transition or
      // animation without any other signal, so follow along until it ends.
      if (animating > 0) {
        schedule();
      }
    });
  }

  resizeObserver.observe(uiDoc.documentElement);
  new uiWin.MutationObserver(schedule).observe(uiDoc, {
    subtree: true,
    childList: true,
    attributes: true,
  });
  // Stylesheets and images can still move things after parsing.
  uiWin.addEventListener("load", schedule);
  uiWin.addEventListener("resize", schedule);
  uiDoc.addEventListener("scroll", schedule, { capture: true });
  for (let type of ["transitionrun", "animationstart"]) {
    uiDoc.addEventListener(type, () => {
      animating++;
      schedule();
    });
  }
  for (let type of [
    "transitionend",
    "transitioncancel",
    "animationend",
    "animationcancel",
  ]) {
    uiDoc.addEventListener(type, () => {
      animating = Math.max(0, animating - 1);
      schedule();
    });
  }
  place();
}

export const NeekoWindow = {
  /**
   * Called by Firefox for each browser window, before its first layout.
   *
   * @param {Window} win
   */
  init(win) {
    // Popup windows (sign-in popups and the like) keep Firefox's minimal UI,
    // including its read-only address bar.
    if (!win.toolbar.visible) {
      return;
    }
    if (!findUI()) {
      return;
    }

    let doc = win.document;
    doc.documentElement.setAttribute("neeko", "");
    win.windowUtils.loadSheetUsingURIString(
      "chrome://neeko/content/neeko.css",
      win.windowUtils.AUTHOR_SHEET
    );

    let frame = doc.createElementNS(HTML_NS, "iframe");
    frame.id = UI_FRAME_ID;
    frame.setAttribute("src", UI_URL);
    doc.body.prepend(frame);

    handleOpenLocation(win);
  },
};
