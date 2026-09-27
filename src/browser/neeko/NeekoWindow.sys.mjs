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
 * 6. Hangs Firefox's own panels (permission prompts and the like) from the
 *    top of the web page, since their toolbar icons are hidden (NeekoPanels),
 *    and shows its notification bars across the top of the page.
 *
 * With no custom UI configured, it does nothing and Firefox looks as usual.
 */

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";
import { NeekoAPI } from "moz-src:///browser/neeko/NeekoAPI.sys.mjs";
import { NeekoBookmarks } from "moz-src:///browser/neeko/NeekoBookmarks.sys.mjs";
import { NeekoPanels } from "moz-src:///browser/neeko/NeekoPanels.sys.mjs";
import { NeekoSettings } from "moz-src:///browser/neeko/NeekoSettings.sys.mjs";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const UI_ORIGIN = "chrome://neeko-ui/";
const UI_URL = `${UI_ORIGIN}content/index.html`;
const UI_FRAME_ID = "neeko-ui";
const SLOT_SELECTOR = "[data-neeko-content]";
const OVERLAY_SELECTOR = "[data-neeko-overlay]";
// Set on the window's root while the UI is above the page (overlayPage).
const UI_OVER_PAGE = "neeko-ui-over-page";
const API_CLIENT_URL = "chrome://neeko/content/neeko-api.js";
// `neeko.platform`, from Firefox's names for them.
const PLATFORMS = { macosx: "macos", win: "windows", linux: "linux" };
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
  // What the UI can read without waiting: its settings and the color scheme
  // are there before its first paint, and change events keep them current.
  install(port2, {
    platform: PLATFORMS[AppConstants.platform] ?? AppConstants.platform,
    settings: NeekoSettings.all(),
    colorScheme: NeekoSettings.colorScheme(),
    bookmarkFolders: NeekoBookmarks.folders,
  });

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
    api = new NeekoAPI(win, message => port1.postMessage(message), uiWin);
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
        // Settings may have changed since the UI got them.
        api?.resync();
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
 * Cmd+D (Bookmarks > Bookmark Current Tab) asks to bookmark the page. A UI
 * that listens for the "bookmarks.request" event gets it instead of
 * Firefox, whose own bookmark panel otherwise opens at the top of the page
 * (NeekoPanels).
 */
function handleBookmarkPage(win) {
  let command = win.document.getElementById("Browser:AddBookmarkAs");
  command?.addEventListener("command", event => {
    if (apis.get(win)?.requestBookmark()) {
      // Firefox's own handler listens further up; it never hears this one.
      event.stopPropagation();
    }
  });
}

// The menu items for Firefox's settings: on macOS, the app menu's Settings...
// (Cmd+,), which nsMenuBarX makes from one of them.
const SETTINGS_ITEMS = ["menu_preferences", "menu_settings"];

/**
 * Cmd+, (Settings... in the app menu, or Tools > Settings) asks for the
 * browser's settings. A UI that listens for the "settings.request" event gets
 * it instead of Firefox, whose own settings (about:preferences) otherwise
 * open. Firefox handles these on the menu bar, further up, so a capturing
 * listener there hears them first.
 */
function handleSettings(win) {
  win.document.getElementById("main-menubar")?.addEventListener(
    "command",
    event => {
      if (
        SETTINGS_ITEMS.includes(event.target.id) &&
        apis.get(win)?.requestSettings()
      ) {
        event.stopPropagation();
      }
    },
    true
  );
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
 * Firefox's notification bars (a blocked pop-up, a page slowing Firefox
 * down) show over the top of the page (neeko.css), and push the page down
 * by their height, as they do in Firefox, rather than cover it.
 */
function followNotificationBars(win) {
  let root = win.document.documentElement;
  let bars = win.document.getElementById("notifications-toolbar");
  new win.ResizeObserver(() => {
    let height = Math.ceil(bars.getBoundingClientRect().height);
    root.style.setProperty("--neeko-notifications-height", `${height}px`);
  }).observe(bars);
}

/**
 * How far an element's box-shadows reach outside its box, on each side.
 */
function shadowReach(boxShadow) {
  let reach = { top: 0, right: 0, bottom: 0, left: 0 };
  if (!boxShadow || boxShadow == "none") {
    return reach;
  }
  // One shadow per comma, except commas inside colors like rgb(0, 0, 0).
  for (let shadow of boxShadow.split(/,(?![^(]*\))/)) {
    if (/\binset\b/.test(shadow)) {
      continue;
    }
    let lengths = shadow.replace(/[\w-]+\([^)]*\)/g, "").match(/-?[\d.]+px/g);
    let [x = 0, y = 0, blur = 0, spread = 0] = (lengths ?? []).map(parseFloat);
    // Gecko draws a blur's fading edge out to about 1.41 times the blur
    // radius (nsContextBoxBlur::GetBlurRadiusMargin), plus rounding.
    let grow = Math.max(0, blur * 1.5 + spread + (blur ? 1 : 0));
    reach.left = Math.max(reach.left, grow - x);
    reach.right = Math.max(reach.right, grow + x);
    reach.top = Math.max(reach.top, grow - y);
    reach.bottom = Math.max(reach.bottom, grow + y);
  }
  return reach;
}

/**
 * The horizontal and vertical radius of each corner of an element's box, in
 * pixels, scaled down the way CSS does when they don't fit.
 */
function cornerRadii(style, width, height) {
  let corners = ["TopLeft", "TopRight", "BottomRight", "BottomLeft"].map(
    corner => {
      let [x, y = x] = style[`border${corner}Radius`].split(" ");
      let px = (value, size) =>
        value.endsWith("%")
          ? (parseFloat(value) / 100) * size
          : parseFloat(value) || 0;
      return [px(x, width), px(y, height)];
    }
  );
  let [tl, tr, br, bl] = corners;
  let fit = Math.min(
    1,
    width / (tl[0] + tr[0] || 1),
    width / (bl[0] + br[0] || 1),
    height / (tl[1] + bl[1] || 1),
    height / (tr[1] + br[1] || 1)
  );
  return corners.map(([x, y]) => [x * fit, y * fit]);
}

/**
 * The clip for the UI while it's above the page: everything, minus the page
 * (with its rounded corners), plus the overlays. The page is drawn
 * counterclockwise so its winding cancels the window's; the overlays are
 * drawn clockwise again. Coordinates are the UI frame's.
 */
function overlayClipPath(width, height, page, radii, overlays) {
  let n = value => Math.round(value * 100) / 100;
  let { left: l, top: t, right: r, bottom: b } = page;
  let [tl, tr, br, bl] = radii;
  let d = [
    `M0 0 H${n(width)} V${n(height)} H0 Z`,
    `M${n(l)} ${n(t + tl[1])} V${n(b - bl[1])}`,
    `A${n(bl[0])} ${n(bl[1])} 0 0 0 ${n(l + bl[0])} ${n(b)}`,
    `H${n(r - br[0])}`,
    `A${n(br[0])} ${n(br[1])} 0 0 0 ${n(r)} ${n(b - br[1])}`,
    `V${n(t + tr[1])}`,
    `A${n(tr[0])} ${n(tr[1])} 0 0 0 ${n(r - tr[0])} ${n(t)}`,
    `H${n(l + tl[0])}`,
    `A${n(tl[0])} ${n(tl[1])} 0 0 0 ${n(l)} ${n(t + tl[1])} Z`,
  ];
  for (let o of overlays) {
    d.push(`M${n(o.left)} ${n(o.top)} H${n(o.right)} V${n(o.bottom)} H${n(o.left)} Z`);
  }
  return `path(nonzero, "${d.join(" ")}")`;
}

/**
 * Lets the UI draw over the page where it marks elements with
 * data-neeko-overlay: menus, a sidebar sliding out, its own error page.
 * While one that's showing overlaps the page, the UI goes above the page
 * (neeko.css), clipped to everything but the page plus those elements and
 * their shadows. So they're drawn over the page, shadows, rounded corners
 * and all (where the UI is transparent, the page shows through), and take
 * the pointer there, while the rest of the page stays visible and live.
 */
function overlayPage(frame, tabbox) {
  let uiDoc = frame.contentDocument;
  let uiWin = frame.contentWindow;
  let root = frame.ownerDocument.documentElement;
  let frameRect = frame.getBoundingClientRect();
  let pageRect = tabbox.getBoundingClientRect();
  // The page, in the UI frame's coordinates.
  let page = {
    left: pageRect.left - frameRect.left,
    top: pageRect.top - frameRect.top,
    right: pageRect.right - frameRect.left,
    bottom: pageRect.bottom - frameRect.top,
  };
  let over = [];
  for (let element of uiDoc.querySelectorAll(OVERLAY_SELECTOR)) {
    if (
      !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    ) {
      continue;
    }
    let box = element.getBoundingClientRect();
    let reach = shadowReach(uiWin.getComputedStyle(element).boxShadow);
    let ink = {
      left: box.left - reach.left,
      top: box.top - reach.top,
      right: box.right + reach.right,
      bottom: box.bottom + reach.bottom,
    };
    if (
      box.width &&
      box.height &&
      ink.left < page.right &&
      ink.right > page.left &&
      ink.top < page.bottom &&
      ink.bottom > page.top
    ) {
      over.push(ink);
    }
  }
  if (!over.length || !pageRect.width || !pageRect.height) {
    root.removeAttribute(UI_OVER_PAGE);
    frame.style.removeProperty("clip-path");
    return;
  }
  let radii = cornerRadii(
    tabbox.ownerDocument.defaultView.getComputedStyle(tabbox),
    pageRect.width,
    pageRect.height
  );
  frame.style.clipPath = overlayClipPath(
    frameRect.width,
    frameRect.height,
    page,
    radii,
    over
  );
  root.setAttribute(UI_OVER_PAGE, "");
}

/**
 * Keeps the page area (#tabbrowser-tabbox) over the UI's content slot, and
 * the UI's overlays over the page (overlayPage). The UI can move, resize,
 * round or animate the slot and its overlays, and the page follows. Updates
 * are batched to at most one per frame.
 */
function trackContentSlot(win, frame) {
  let uiWin = frame.contentWindow;
  let uiDoc = frame.contentDocument;
  let tabbox = win.document.getElementById("tabbrowser-tabbox");
  let slot = null;
  let overlays = new Set();
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
    if (slot) {
      let slotRect = slot.getBoundingClientRect();
      let frameRect = frame.getBoundingClientRect();
      style.left = `${frameRect.left + slotRect.left}px`;
      style.top = `${frameRect.top + slotRect.top}px`;
      style.width = `${slotRect.width}px`;
      style.height = `${slotRect.height}px`;
      style.borderRadius = uiWin.getComputedStyle(slot).borderRadius;
    } else {
      style.width = style.height = "0";
    }
    // Where Firefox's notification bars go (neeko.css), which can't follow
    // the page by CSS anchor positioning: they're before it in the document.
    let rootStyle = win.document.documentElement.style;
    rootStyle.setProperty("--neeko-page-left", style.left || "0");
    rootStyle.setProperty("--neeko-page-top", style.top || "0");
    rootStyle.setProperty("--neeko-page-width", style.width);
    overlayPage(frame, tabbox);
    // Overlays shown or hidden with `display` change size, which the resize
    // observer reports even when nothing else changed (a :hover rule, say).
    for (let element of uiDoc.querySelectorAll(OVERLAY_SELECTOR)) {
      if (!overlays.has(element)) {
        overlays.add(element);
        resizeObserver.observe(element);
      }
    }
    for (let element of overlays) {
      if (!element.isConnected) {
        overlays.delete(element);
        resizeObserver.unobserve(element);
      }
    }
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
  // :hover and :focus rules can show or move overlays with no other signal.
  for (let type of ["mouseover", "mouseout", "focusin", "focusout"]) {
    uiDoc.addEventListener(type, schedule);
  }
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
    handleBookmarkPage(win);
    handleSettings(win);
    NeekoPanels.init(win, () => apis.get(win));
    followNotificationBars(win);
  },
};
