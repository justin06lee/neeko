/**
 * Firefox's menu bar and the page's context menu, trimmed to what the app
 * keeps: browser.json's "menus", which tools/app.ts puts in the neeko.menus
 * pref, in Neeko's names (NeekoMenuNames).
 *
 *   { "menubar": { "file": ["newTab", "closeTab"], "edit": true, ... },
 *     "context": ["back", "forward", "reload", "copy", "copyLink", ...] }
 *
 * Menus the menu bar doesn't list are hidden, and so are the items a menu's
 * list leaves out (true keeps a menu whole). In the context menu, Firefox
 * shows what fits what was clicked, minus what the list leaves out. The
 * separators are tidied: never first, last or two in a row. Without
 * "menus", or without either part, Firefox's own menus are the fallback.
 *
 * Items are only ever hidden, with Firefox's own `hidden` attribute (which
 * macOS's native menus follow), never removed or moved, and hidden again
 * each time a menu opens, since Firefox shows and hides items as it goes.
 */

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";
import {
  CONTEXT,
  MENUBAR,
  MENUBAR_ALWAYS,
} from "moz-src:///browser/neeko/NeekoMenuNames.sys.mjs";

const PREF = "neeko.menus";
const CONTEXT_MENU = "contentAreaContextMenu";
// Where Firefox's context menu puts extensions' items (ext-menus.js).
const EXTENSION_ITEM = /-menuitem-/;

// Firefox's element ids, by the names they have in each part.
const contextIds = new Map();
for (let [name, ids] of Object.entries(CONTEXT)) {
  for (let id of ids) {
    contextIds.set(id, name);
  }
}

/**
 * What the app keeps, from the pref: { menubar, context }, each null for
 * Firefox's own. Read once per window.
 */
function readConfig() {
  let json = Services.prefs.getStringPref(PREF, "");
  if (!json) {
    return { menubar: null, context: null };
  }
  try {
    let { menubar = null, context = null } = JSON.parse(json);
    return { menubar, context: context && new Set(context) };
  } catch (e) {
    console.error(`Neeko: ${PREF} isn't valid JSON, so Firefox's menus stay.`, e);
    return { menubar: null, context: null };
  }
}

// The separators Neeko hid, so it can show them again when what's around
// them changes.
const hiddenSeparators = new WeakSet();

function isShown(item) {
  if (item.hidden || item.collapsed) {
    return false;
  }
  if (item.localName == "menugroup") {
    return [...item.children].some(isShown);
  }
  return ["menu", "menuitem", "menuseparator"].includes(item.localName);
}

/**
 * Separators only between shown items: none first, none last, none doubled.
 * Separators Firefox hid stay hidden.
 */
function tidySeparators(popup) {
  for (let item of popup.children) {
    if (hiddenSeparators.has(item)) {
      hiddenSeparators.delete(item);
      item.hidden = false;
    }
  }
  let last = null;
  for (let item of popup.children) {
    if (item.localName == "menugroup") {
      tidySeparators(item);
    }
    if (!isShown(item)) {
      continue;
    }
    if (item.localName == "menuseparator" && (!last || last.localName == "menuseparator")) {
      item.hidden = true;
      hiddenSeparators.add(item);
      continue;
    }
    last = item;
  }
  if (last?.localName == "menuseparator") {
    last.hidden = true;
    hiddenSeparators.add(last);
  }
}

function hide(item) {
  if (!item.hidden) {
    item.hidden = true;
  }
}

/**
 * Hides a menu bar menu's items that the app leaves out.
 */
function trimMenu(popup, keep, items) {
  let kept = new Set(keep.flatMap(name => items[name] ?? []));
  for (let item of popup.children) {
    if (
      item.localName != "menuseparator" &&
      !MENUBAR_ALWAYS.includes(item.id) &&
      !kept.has(item.id)
    ) {
      hide(item);
    }
  }
  tidySeparators(popup);
}

function trimMenubar(doc, menubar) {
  for (let [name, { menu, popup, items }] of Object.entries(MENUBAR)) {
    let element = doc.getElementById(menu);
    if (!element) {
      continue;
    }
    let keep = menubar[name];
    if (!keep) {
      hide(element);
      continue;
    }
    if (keep === true || !items) {
      continue;
    }
    let menupopup = doc.getElementById(popup);
    if (!menupopup) {
      continue;
    }
    trimMenu(menupopup, keep, items);
    // Firefox shows items as it goes (full screen, containers...), some in
    // its own popupshowing listeners on the menu, so the menu is trimmed
    // again whenever it opens, from further up, after them.
    doc.addEventListener("popupshowing", event => {
      if (event.target == menupopup) {
        trimMenu(menupopup, keep, items);
      }
    });
  }
}

/**
 * Hides the context menu's items that the app leaves out, of those Firefox
 * shows for what was clicked.
 */
function trimContextMenu(popup, keep) {
  let trim = parent => {
    for (let item of parent.children) {
      if (item.localName == "menuseparator") {
        continue;
      }
      if (item.localName == "menugroup") {
        trim(item);
        continue;
      }
      let name = EXTENSION_ITEM.test(item.id)
        ? "extensions"
        : item.classList.contains("spell-suggestion")
          ? "spelling"
          : contextIds.get(item.id);
      if (!keep.has(name)) {
        hide(item);
      }
    }
  };
  trim(popup);
  tidySeparators(popup);
}

function watchContextMenu(doc, keep) {
  let popup = doc.getElementById(CONTEXT_MENU);
  if (!popup) {
    return;
  }
  // Firefox fills the menu in its own popupshowing listener on the menu;
  // this one, further up, runs after it. Some items appear a moment later
  // (a link to a highlight, translations), so the menu is watched while
  // it's open.
  let observer = new doc.defaultView.MutationObserver(() => {
    observer.disconnect();
    trimContextMenu(popup, keep);
    observe();
  });
  let observe = () =>
    observer.observe(popup, {
      childList: true,
      subtree: true,
      attributeFilter: ["hidden"],
    });
  doc.addEventListener("popupshowing", event => {
    if (event.target == popup && !event.defaultPrevented) {
      trimContextMenu(popup, keep);
      observe();
    }
  });
  doc.addEventListener("popuphidden", event => {
    if (event.target == popup) {
      observer.disconnect();
    }
  });
}

// Whether macOS's hidden window got the app's menu bar.
let hiddenWindowDone = false;

/**
 * On macOS, the menu bar with no window open is the hidden window's, a menu
 * bar of its own (hiddenWindowMac.xhtml): it gets the same menus.
 */
function trimHiddenWindow(menubar) {
  if (hiddenWindowDone || AppConstants.platform != "macosx") {
    return;
  }
  hiddenWindowDone = true;
  let hidden;
  try {
    hidden = Services.appShell.hiddenDOMWindow;
  } catch (e) {
    return;
  }
  let trim = () => trimMenubar(hidden.document, menubar);
  if (hidden.document.readyState == "complete") {
    trim();
  } else {
    hidden.addEventListener("load", trim, { once: true });
  }
}

export const NeekoMenus = {
  /**
   * Called by Firefox for each browser window, before its first layout.
   *
   * @param {Window} win
   */
  init(win) {
    let { menubar, context } = readConfig();
    if (menubar) {
      trimMenubar(win.document, menubar);
      trimHiddenWindow(menubar);
    }
    if (context) {
      watchContextMenu(win.document, context);
    }
  },
};
