/**
 * The Neeko API, Firefox's side: what a custom UI can ask its window to do,
 * and the events it hears back. Each UI page gets its own NeekoAPI, which
 * lives exactly as long as the page does.
 *
 * Everything crosses as messages of plain data, never live Firefox objects,
 * so a UI running in a sandbox later ("Trick" mode) can use the same API over
 * a different channel. The UI's side is neeko-api.js; docs/api.md documents
 * both.
 *
 *   UI to Neeko:   { id, method: "tabs.open", params: [...] }
 *   Neeko to UI:   { id, result }  or  { id, error: { message } }
 *   Neeko to UI:   { event: "tabs.update", data }
 *
 * The UI tells Neeko which events it listens for ("events.listen"), and
 * only those are sent. Listening is also how a UI says it handles something
 * itself: for events with a fallback, nobody listening means Firefox's own
 * UI steps in.
 */

import { NeekoBookmarks } from "moz-src:///browser/neeko/NeekoBookmarks.sys.mjs";
import { NeekoDownloads } from "moz-src:///browser/neeko/NeekoDownloads.sys.mjs";
import { NeekoPanels } from "moz-src:///browser/neeko/NeekoPanels.sys.mjs";
import { NeekoSettings } from "moz-src:///browser/neeko/NeekoSettings.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AboutNewTab: "resource:///modules/AboutNewTab.sys.mjs",
  NetUtil: "resource://gre/modules/NetUtil.sys.mjs",
  SessionStore:
    "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
});

// Tab ids are small numbers, unique for the whole session, so they stay the
// same when the UI reloads.
let nextTabId = 1;
const tabIds = new WeakMap();

function tabId(tab) {
  let id = tabIds.get(tab);
  if (!id) {
    id = nextTabId++;
    tabIds.set(tab, id);
  }
  return id;
}

// The error pages Firefox shows in place of a page that didn't load
// (nsDocShell::DisplayLoadError), as about:<page>?e=<code>&u=<url>... The
// tab crashed page isn't one of them: tabs report that as `crashed`.
const ERROR_PAGE = /^about:(neterror|certerror|blocked|httpsonlyerror|restricted)\?/;

/**
 * The error page a tab's browser shows, if any: which one, and its error
 * code (such as "connectionFailure").
 */
function errorPage(browser) {
  let spec = browser.documentURI?.spec ?? "";
  let match = ERROR_PAGE.exec(spec);
  if (!match) {
    return null;
  }
  let query = spec.slice(spec.indexOf("?") + 1).split("#")[0];
  return { page: match[1], code: new URLSearchParams(query).get("e") ?? "" };
}

/**
 * What the UI knows about a tab. Tabs that are asleep (restored but never
 * shown, or unloaded to save memory) have no page yet, and asking about their
 * history would wake them, so they report no back or forward.
 *
 * @param {string|null} icon The tab's icon as the UI should get it (see
 *   NeekoAPI's #icon).
 */
function describeTab(tab, icon) {
  let browser = tab.linkedBrowser;
  let asleep = !tab.linkedPanel;
  let uri = browser.currentURI;
  return {
    id: tabId(tab),
    // Without any user:password@ part.
    url: uri ? Services.io.createExposableURI(uri).spec : "",
    title: tab.label,
    icon,
    loading: tab.hasAttribute("busy"),
    canGoBack: !asleep && browser.canGoBack,
    canGoForward: !asleep && browser.canGoForward,
    selected: tab.selected,
    audible: tab.hasAttribute("soundplaying"),
    muted: tab.hasAttribute("muted"),
    crashed: tab.hasAttribute("crashed"),
    error: asleep ? null : errorPage(browser),
    groupId: tab.group?.id ?? null,
  };
}

/**
 * What the UI knows about a tab group, one of Firefox's own. Its tabs are
 * the ones whose groupId is its id, next to each other in the window's
 * tabs.
 */
function describeGroup(group) {
  return {
    id: group.id,
    name: group.label,
    color: group.color,
    collapsed: group.collapsed,
  };
}

// Firefox's tab group colors (MozTabbrowserTabGroupMenu.COLORS in
// tabgroup-menu.js), for when that element isn't defined yet.
const GROUP_COLORS = [
  "blue",
  "purple",
  "cyan",
  "orange",
  "yellow",
  "pink",
  "green",
  "gray",
  "red",
];

/**
 * Makes a blob: URL in the UI page for an icon Firefox keeps as a data: URL,
 * or returns null if it can't be read.
 */
function blobURL(ui, dataURL) {
  try {
    let comma = dataURL.indexOf(",");
    let meta = dataURL.slice("data:".length, comma);
    let data = dataURL.slice(comma + 1);
    let bytes = /;base64$/i.test(meta)
      ? Uint8Array.fromBase64(data)
      : new TextEncoder().encode(decodeURIComponent(data));
    let type = meta.split(";")[0];
    return ui.URL.createObjectURL(new ui.Blob([bytes], { type }));
  } catch (e) {
    console.error("Neeko: couldn't read a tab's icon.", e);
    return null;
  }
}

/**
 * Loads a moz-remote-image: URL, which Firefox renders in a page's own
 * content process (untrusted SVG never decoded here), as the PNG bytes it
 * comes back as.
 */
function fetchRemoteImage(url) {
  return new Promise((resolve, reject) => {
    let channel = lazy.NetUtil.newChannel({
      uri: url,
      loadUsingSystemPrincipal: true,
      contentPolicyType: Ci.nsIContentPolicy.TYPE_INTERNAL_IMAGE,
    });
    lazy.NetUtil.asyncFetch(channel, (stream, status) => {
      if (!Components.isSuccessCode(status)) {
        reject(new Error(`Couldn't load a tab's icon (${status}).`));
        return;
      }
      try {
        let bytes = lazy.NetUtil.readInputStream(stream, stream.available());
        resolve(new Uint8Array(bytes));
      } catch (e) {
        reject(e);
      } finally {
        stream.close();
      }
    });
  });
}

/**
 * Checks the options object a method takes: every option has to be one the
 * method knows, of the right kind ("boolean", or "index" for a whole number
 * from 0).
 */
function checkOptions(options, kinds) {
  if (options === undefined || options === null) {
    return {};
  }
  if (typeof options != "object" || Array.isArray(options)) {
    throw new TypeError("Expected an options object.");
  }
  for (let [name, value] of Object.entries(options)) {
    let kind = kinds[name];
    if (!kind) {
      throw new TypeError(`Unknown option "${name}".`);
    }
    let ok =
      value === undefined ||
      (kind == "index"
        ? Number.isInteger(value) && value >= 0
        : typeof value == kind);
    if (!ok) {
      let expected = kind == "index" ? "a whole number from 0" : kind;
      throw new TypeError(`Option "${name}" must be ${expected}.`);
    }
  }
  return options;
}

// Every event the UI can listen for.
const EVENTS = [
  "tabs.open",
  "tabs.close",
  "tabs.select",
  "tabs.move",
  "tabs.update",
  "nav.addressbar",
  "prompts.open",
  "prompts.close",
  "fullscreen.page",
  "fullscreen.window",
  "downloads.start",
  "downloads.update",
  "downloads.remove",
  "settings.change",
  "settings.request",
  "colorScheme.change",
  "bookmarks.add",
  "bookmarks.remove",
  "bookmarks.move",
  "bookmarks.update",
  "bookmarks.request",
  "pointer.edge",
  "groups.create",
  "groups.remove",
  "groups.update",
  "find.request",
];

// What Firefox's find reports (nsITypeAheadFind), as the API says it.
const FIND_RESULTS = new Map([
  [Ci.nsITypeAheadFind.FIND_FOUND, "found"],
  [Ci.nsITypeAheadFind.FIND_NOTFOUND, "notFound"],
  [Ci.nsITypeAheadFind.FIND_WRAPPED, "wrapped"],
]);
// How long a search may take to report its matches before find() settles
// for what it has.
const FIND_TIMEOUT = 5000;

// The page's edges, in the order a corner counts as one of them.
const EDGES = ["top", "left", "right", "bottom"];
// How deep an edge's band can be, in CSS pixels.
const MAX_EDGE = 200;

// Events sent whether or not the UI listens: neeko-api.js keeps its copy of
// the settings and color scheme (read without waiting) up to date with them.
const ALWAYS_SENT = ["settings.change", "colorScheme.change"];

// Set on the window's root while the UI lays out page fullscreen itself, which
// turns off neeko.css's fallback (the page filling the window over the UI).
const UI_FULLSCREEN = "neeko-ui-fullscreen";

// Window events for fullscreen: a web page entering or leaving it, and the
// window itself ("fullscreen" fires once window.fullScreen has changed).
const FULLSCREEN_EVENTS = [
  "MozDOMFullscreen:Entered",
  "MozDOMFullscreen:Exited",
  "fullscreen",
];

// Fields whose changes arrive as "update" events. Selection has its own
// "select" event instead.
const UPDATE_FIELDS = [
  "url",
  "title",
  "icon",
  "loading",
  "canGoBack",
  "canGoForward",
  "audible",
  "muted",
  "crashed",
  "error",
  "groupId",
];

// Tab attributes Firefox reports changing (TabAttrModified) that affect a
// tab's description. "crashed" changes without that event (see
// ContentCrashHandlers.sys.mjs), so NeekoAPI watches it itself.
const WATCHED_ATTRIBUTES = ["label", "busy", "image", "soundplaying", "muted"];

/**
 * Whether a field of a tab's description still has the same value. Most are
 * strings, numbers or booleans; `error` is null or a small object.
 */
function sameValue(a, b) {
  return (
    a === b ||
    (typeof a == "object" &&
      typeof b == "object" &&
      JSON.stringify(a) == JSON.stringify(b))
  );
}

const TAB_EVENTS = [
  "TabOpen",
  "TabClose",
  "TabSelect",
  "TabMove",
  "TabAttrModified",
  "TabBrowserInserted",
  "TabBrowserDiscarded",
  // Tab groups: these come from the group, even TabGrouped and TabUngrouped
  // (their detail is the tab).
  "TabGrouped",
  "TabUngrouped",
  "TabGroupCreate",
  "TabGroupRemoved",
  "TabGroupUpdate",
  "TabGroupCollapse",
  "TabGroupExpand",
];

/**
 * Takes what a user typed into an address bar.
 */
function addressInput(input) {
  if (typeof input != "string" || !input.trim()) {
    throw new TypeError("Expected a URL or search terms.");
  }
  return input.trim();
}

/**
 * Loads what a user typed into an address bar in a tab's browser: a URL, or
 * anything Firefox can turn into one ("example.com"), or else search terms
 * for the default search engine. For the UI (nav.go) and the browser's own
 * pages (neekoPage.go).
 */
export function goTo(win, browser, input) {
  win.openTrustedLinkIn(addressInput(input), "current", {
    targetBrowser: browser,
    allowThirdPartyFixup: true,
    allowInheritPrincipal: false,
    allowPinnedTabHostChange: true,
    indicateErrorPageLoad: true,
  });
}

/**
 * Opens a tab the way the address bar or Cmd+T would: what Firefox's
 * openLinkIn() does for a new tab (URILoadingHelper), with a position,
 * which openLinkIn() can't take. With no input, the New Tab page.
 *
 * @param {object} options { background, index, addressbar }, as tabs.open
 *   takes them.
 */
export function openTab(win, input, { background = false, index, addressbar = true } = {}) {
  let url =
    input === undefined || input === null
      ? win.BROWSER_NEW_TAB_URL
      : addressInput(input);
  let blank = win.isBlankPageURL(url);
  let focusUrlBar =
    !background && blank && addressbar && !lazy.AboutNewTab.willNotifyUser;
  let tab = win.gBrowser.addTab(url, {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    allowThirdPartyFixup: true,
    inBackground: background,
    tabIndex: index,
    focusUrlBar,
  });
  // The page gets the keys, unless a New Tab page asks for the address bar,
  // or the UI keeps them (addressbar: false).
  if (!background && !focusUrlBar && (addressbar || !blank)) {
    tab.linkedBrowser.focus();
  }
  return tab;
}

/**
 * The API's methods, by the name the UI calls them with. They run with the
 * NeekoAPI as `this`, take and return plain data, and throw to reject the
 * UI's call.
 */
const METHODS = {
  /**
   * Starts or stops sending an event. neeko-api.js calls this when the UI
   * adds its first listener for an event or removes its last one.
   */
  "events.listen"(event, listening) {
    if (!EVENTS.includes(event) || typeof listening != "boolean") {
      throw new TypeError("Expected an event name and true or false.");
    }
    if (listening == this.listening.has(event)) {
      return;
    }
    if (listening) {
      this.listening.add(event);
    } else {
      this.listening.delete(event);
    }
    if (event.startsWith("downloads.")) {
      // Download events come from following the window's list.
      this.downloads();
    } else if (event.startsWith("bookmarks.") && event != "bookmarks.request") {
      this.watchBookmarks();
    } else if (event == "prompts.open") {
      NeekoPanels.setUIShowsPrompts(this.win, listening);
    } else if (event == "fullscreen.page") {
      let root = this.win.document.documentElement;
      root.toggleAttribute(UI_FULLSCREEN, listening);
    }
  },

  "tabs.list"() {
    return this.gBrowser.tabs
      .filter(tab => !tab.closing)
      .map(tab => this.describe(tab));
  },

  "tabs.current"() {
    return this.describe(this.gBrowser.selectedTab);
  },

  /**
   * Opens a tab, the way the address bar or Cmd+T would. With no input it
   * shows the New Tab page. Options: `background` (don't select it), `index`
   * (where it goes; the end by default) and `addressbar` (false: a New Tab
   * page doesn't ask for the address bar).
   */
  "tabs.open"(input, options) {
    let checked = checkOptions(options, {
      background: "boolean",
      index: "index",
      addressbar: "boolean",
    });
    return this.describe(openTab(this.win, input, checked));
  },

  /**
   * Opens a copy of a tab next to it, with its history, as Firefox's
   * Duplicate Tab does, and selects it unless `background` is set.
   */
  "tabs.duplicate"(id, options) {
    let { background = false } = checkOptions(options, {
      background: "boolean",
    });
    let tab = this.findTab(id);
    let copy = lazy.SessionStore.duplicateTab(this.win, tab, 0, true, {
      tabIndex: tab.index + 1,
    });
    if (!background) {
      this.gBrowser.selectedTab = copy;
    }
    return this.describe(copy);
  },

  /**
   * Moves a tab to a position in the window's tabs. Firefox keeps pinned
   * tabs before the others, and a position past the end means the end.
   */
  "tabs.move"(index, id) {
    if (!Number.isInteger(index) || index < 0) {
      throw new TypeError("Expected a position, a whole number from 0.");
    }
    this.gBrowser.moveTabTo(this.findTab(id), { tabIndex: index });
  },

  "tabs.setMuted"(muted, id) {
    if (typeof muted != "boolean") {
      throw new TypeError("Expected true or false.");
    }
    let tab = this.findTab(id);
    if (tab.hasAttribute("muted") != muted) {
      tab.toggleMuteAudio();
    }
  },

  /**
   * Puts a tab in one of the window's tab groups, at its end, or with null
   * takes it out of its group, to just after it.
   */
  "tabs.setGroup"(groupId, id) {
    let tab = this.findTab(id);
    if (groupId === null) {
      this.gBrowser.ungroupTab(tab);
      return;
    }
    let group = this.findGroup(groupId);
    if (tab.pinned) {
      throw new Error("Pinned tabs can't be in a group.");
    }
    this.gBrowser.moveTabToExistingGroup(tab, group);
  },

  /**
   * Puts keyboard focus in the selected tab's page, as clicking it would.
   */
  "tabs.focus"() {
    this.gBrowser.selectedBrowser.focus();
  },

  "tabs.close"(id) {
    this.gBrowser.removeTab(this.findTab(id));
  },

  "tabs.select"(id) {
    if (id === undefined) {
      throw new TypeError("Expected a tab id.");
    }
    this.gBrowser.selectedTab = this.findTab(id);
  },

  /**
   * Loads what a user typed into an address bar: a URL, or anything Firefox
   * can turn into one ("example.com"), or else search terms for the default
   * search engine.
   */
  "nav.go"(input, id) {
    goTo(this.win, this.findTab(id).linkedBrowser, input);
  },

  "nav.back"(id) {
    this.findTab(id).linkedBrowser.goBack();
  },

  "nav.forward"(id) {
    this.findTab(id).linkedBrowser.goForward();
  },

  /**
   * Reloads a tab's page. A crashed tab comes back the way the crashed tab
   * page's "Restore This Tab" does it.
   */
  "nav.reload"(id) {
    let tab = this.findTab(id);
    if (tab.hasAttribute("crashed")) {
      lazy.SessionStore.reviveCrashedTab(tab);
    } else {
      this.gBrowser.reloadTab(tab);
    }
  },

  /**
   * The permission prompts waiting for an answer in this window, in every
   * tab, oldest first.
   */
  "prompts.list"() {
    return NeekoPanels.prompts(this.win).map(prompt =>
      this.describePrompt(prompt)
    );
  },

  /**
   * Answers a permission prompt with one of its actions (an index into its
   * actions), optionally checking its "remember" checkbox.
   */
  "prompts.answer"(id, action, options = {}) {
    if (!Number.isInteger(id) || !Number.isInteger(action)) {
      throw new TypeError("Expected a prompt id and an action index.");
    }
    NeekoPanels.answerPrompt(this.win, id, action, !!options?.remember);
  },

  "fullscreen.state"() {
    return this.fullscreenState();
  },

  /**
   * Ends web page fullscreen, as Escape does. Resolves once it has ended.
   */
  async "fullscreen.exit"() {
    if (this.win.document.fullscreenElement) {
      await this.win.document.exitFullscreen();
    }
  },

  /**
   * Makes the window fullscreen, or not, like View > Enter Full Screen.
   */
  "fullscreen.setWindow"(fullscreen) {
    if (typeof fullscreen != "boolean") {
      throw new TypeError("Expected true or false.");
    }
    this.win.fullScreen = fullscreen;
  },

  "downloads.list"() {
    return this.downloads().list();
  },

  "downloads.open"(id) {
    return this.downloads().open(id);
  },

  "downloads.show"(id) {
    return this.downloads().show(id);
  },

  "downloads.cancel"(id) {
    return this.downloads().cancel(id);
  },

  "downloads.retry"(id) {
    return this.downloads().retry(id);
  },

  "downloads.remove"(id) {
    return this.downloads().remove(id);
  },

  /**
   * Saves one of the UI's settings, for every window. null removes it.
   */
  "settings.set"(key, value) {
    NeekoSettings.set(key, value);
  },

  "settings.all"() {
    return NeekoSettings.all();
  },

  /**
   * Makes web pages, Firefox's own pages and panels, and the UI's own
   * prefers-color-scheme light or dark, or follow the system again.
   */
  "colorScheme.set"(scheme) {
    NeekoSettings.setColorScheme(scheme);
  },

  "bookmarks.list"(folderId) {
    return NeekoBookmarks.list(folderId);
  },

  "bookmarks.get"(id) {
    return NeekoBookmarks.get(id);
  },

  "bookmarks.find"(url) {
    return NeekoBookmarks.find(url);
  },

  "bookmarks.add"(item) {
    return NeekoBookmarks.add(item);
  },

  "bookmarks.update"(id, changes) {
    return NeekoBookmarks.update(id, changes);
  },

  "bookmarks.remove"(id) {
    return NeekoBookmarks.remove(id);
  },

  "groups.list"() {
    return this.gBrowser.tabGroups.map(describeGroup);
  },

  /**
   * Makes a tab group of some tabs, where the first of them is. Options:
   * `name`, and `color` (by default one no other group uses).
   */
  "groups.create"(tabIds, options) {
    if (!Array.isArray(tabIds) || !tabIds.length) {
      throw new TypeError("Expected the ids of the tabs to group.");
    }
    let { name = "", color } = checkOptions(options, {
      name: "string",
      color: "string",
    });
    if (color !== undefined) {
      this.checkGroupColor(color);
    }
    let tabs = tabIds
      .map(id => this.findTab(id))
      .sort((a, b) => a.index - b.index);
    if (tabs.some(tab => tab.pinned)) {
      throw new Error("Pinned tabs can't be in a group.");
    }
    let group = this.gBrowser.addTabGroup(tabs, {
      label: name,
      color,
      insertBefore: tabs[0],
    });
    return describeGroup(group);
  },

  /**
   * Renames a group, changes its color, or collapses or expands it.
   */
  "groups.update"(id, changes) {
    let group = this.findGroup(id);
    let { name, color, collapsed } = checkOptions(changes, {
      name: "string",
      color: "string",
      collapsed: "boolean",
    });
    if (color !== undefined) {
      group.color = this.checkGroupColor(color);
    }
    if (name !== undefined) {
      group.label = name;
    }
    if (collapsed !== undefined) {
      group.collapsed = collapsed;
    }
    return describeGroup(group);
  },

  /**
   * Ends a group. Its tabs stay where they are, in no group.
   */
  "groups.ungroup"(id) {
    this.findGroup(id).ungroupTabs();
  },

  /**
   * Finds text in a tab's page, as typing in Firefox's find bar does: the
   * first match from where the page's selection is, selected and scrolled
   * to. Options: caseSensitive, wholeWord, matchDiacritics (all false by
   * default). Resolves to { result, current, total, limit }. "" clears the
   * search.
   */
  async "find.find"(text, options, id) {
    if (typeof text != "string") {
      throw new TypeError("Expected the text to find.");
    }
    let { caseSensitive = false, wholeWord = false, matchDiacritics = false } =
      checkOptions(options, {
        caseSensitive: "boolean",
        wholeWord: "boolean",
        matchDiacritics: "boolean",
      });
    let finder = this.finder(id);
    if (!text) {
      finder.removeSelection();
      finder.highlight(false, "", false);
      return { result: "notFound", current: 0, total: 0, limit: 0 };
    }
    finder.caseSensitive = caseSensitive;
    finder.entireWord = wholeWord;
    finder.matchDiacritics = matchDiacritics;
    return this.runFind(finder, text, () => finder.fastFind(text, false, false));
  },

  /**
   * The next match of what was last found in a tab's page, wrapping around
   * at the end, as Cmd+G does.
   */
  "find.next"(id) {
    return this.findAgain(id, false);
  },

  "find.previous"(id) {
    return this.findAgain(id, true);
  },

  /**
   * Highlights every match of what's being found in a tab's page, or stops.
   * Later searches in the tab follow it until the tab's find is closed.
   */
  "find.highlight"(highlight, id) {
    if (typeof highlight != "boolean") {
      throw new TypeError("Expected true or false.");
    }
    let finder = this.finder(id);
    finder.onHighlightAllChange(highlight);
    finder.highlight(highlight, finder.searchString ?? "", false);
  },

  /**
   * Done finding in a tab's page: its highlights go, and the match found
   * stays selected, as when Firefox's find bar closes.
   */
  "find.close"(id) {
    let finder = this.finder(id);
    finder.onHighlightAllChange(false);
    finder.onFindbarClose();
  },

  /**
   * Which of the page's edges to watch the pointer at, and how deep a band
   * along each, in CSS pixels: { top: 10, left: 4 }. Edges left out aren't
   * watched. Replaces what was set before.
   */
  "pointer.setEdges"(edges) {
    if (!edges || typeof edges != "object" || Array.isArray(edges)) {
      throw new TypeError("Expected the edges to watch, like { top: 10 }.");
    }
    let depths = {};
    for (let [edge, depth] of Object.entries(edges)) {
      if (!EDGES.includes(edge)) {
        throw new TypeError(`Unknown edge "${edge}": top, right, bottom or left.`);
      }
      if (!Number.isInteger(depth) || depth < 0 || depth > MAX_EDGE) {
        throw new TypeError(`An edge's depth is a whole number from 0 to ${MAX_EDGE}.`);
      }
      if (depth) {
        depths[edge] = depth;
      }
    }
    this.watchEdges(depths);
  },
};

export class NeekoAPI {
  /** What each tab looked like when the UI last heard about it. */
  #lastSent = new WeakMap();
  /** The events the UI listens for. */
  listening = new Set();
  /** The fullscreen state the UI last heard about. */
  #fullscreen;
  /** The window's downloads, once the UI asks about them. */
  #downloads = null;
  /**
   * The blob: URLs made for tab icons that are data: URLs (#icon), by data:
   * URL, each with how many tabs show it.
   */
  #icons = new Map();
  /** The data: URL icon each tab was last described with. */
  #tabIcons = new WeakMap();
  /** Follows the "crashed" attribute of the window's tabs. */
  #crashes;
  /** Stop following the settings and the color scheme. */
  #unwatch = [];
  /** Stops following the bookmarks, once the UI listens for their events. */
  #unwatchBookmarks = null;
  /** What each tab group looked like when the UI last heard about it. */
  #groupsSent = new WeakMap();
  /** The page edges watched for the pointer, by edge: their depth. */
  #edges = {};
  /** The edge the UI last heard the pointer is at, and whether outside. */
  #edge = { edge: null, outside: false };
  /** Find requests on their way to the UI, which arrive in order. */
  #findRequests = Promise.resolve();
  #ui;
  #send;
  #destroyed = false;

  /**
   * @param {Window} win The browser window whose tabs the UI controls. Its
   *   gBrowser must already exist.
   * @param {Function} send Delivers a message to the UI.
   * @param {Window} ui The UI page, where tab icon URLs are made.
   */
  constructor(win, send, ui) {
    this.win = win;
    this.gBrowser = win.gBrowser;
    this.#send = send;
    this.#ui = ui;
    for (let type of TAB_EVENTS) {
      this.gBrowser.tabContainer.addEventListener(type, this);
    }
    this.gBrowser.addTabsProgressListener(this);
    this.#crashes = new win.MutationObserver(records => {
      for (let { target } of records) {
        if (this.gBrowser.isTab(target)) {
          this.#update(target);
        }
      }
    });
    this.#crashes.observe(win.document, {
      subtree: true,
      attributeFilter: ["crashed"],
    });
    this.#fullscreen = this.fullscreenState();
    for (let type of FULLSCREEN_EVENTS) {
      win.addEventListener(type, this, true);
    }
    this.#unwatch.push(
      NeekoSettings.watch((key, value) =>
        this.#emit("settings.change", { key, value })
      ),
      NeekoSettings.watchColorScheme(colorScheme =>
        this.#emit("colorScheme.change", { colorScheme })
      )
    );
  }

  /**
   * Sends every setting and the color scheme as change events, for a UI page
   * whose API started after its `neeko` object took their values.
   */
  resync() {
    for (let [key, value] of Object.entries(NeekoSettings.all())) {
      this.#emit("settings.change", { key, value });
    }
    this.#emit("colorScheme.change", {
      colorScheme: NeekoSettings.colorScheme(),
    });
  }

  destroy() {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    // Firefox's own panel shows the prompts again.
    if (this.listening.has("prompts.open")) {
      NeekoPanels.setUIShowsPrompts(this.win, false);
    }
    // And neeko.css lays out page fullscreen again.
    if (this.listening.has("fullscreen.page")) {
      this.win.document.documentElement.removeAttribute(UI_FULLSCREEN);
    }
    for (let type of FULLSCREEN_EVENTS) {
      this.win.removeEventListener(type, this, true);
    }
    this.#downloads?.destroy();
    for (let type of TAB_EVENTS) {
      this.gBrowser.tabContainer.removeEventListener(type, this);
    }
    this.gBrowser.removeTabsProgressListener(this);
    this.#crashes.disconnect();
    for (let unwatch of this.#unwatch) {
      unwatch();
    }
    this.#unwatchBookmarks?.();
    this.watchEdges({});
    // The icons' blob: URLs go with the UI page.
    this.#icons.clear();
  }

  /**
   * Handles a message from the UI and sends back the result or the error.
   */
  async receive(message) {
    let { id, method, params } = message ?? {};
    try {
      if (!Object.hasOwn(METHODS, method)) {
        throw new TypeError(`Unknown method "${method}".`);
      }
      if (!Array.isArray(params)) {
        throw new TypeError("params must be an array.");
      }
      let result = await METHODS[method].apply(this, params);
      this.#reply({ id, result });
    } catch (e) {
      this.#reply({ id, error: { message: e.message } });
    }
  }

  #reply(message) {
    if (!this.#destroyed) {
      this.#send(message);
    }
  }

  #emit(event, data) {
    if (
      !this.#destroyed &&
      (this.listening.has(event) || ALWAYS_SENT.includes(event))
    ) {
      this.#send({ event, data });
    }
  }

  /**
   * Tells the UI that the user wants the address bar, if the UI has one.
   *
   * @returns {boolean} false if the UI doesn't listen for that, so Firefox's
   *   own address bar should appear instead.
   */
  requestAddressBar() {
    if (!this.listening.has("nav.addressbar")) {
      return false;
    }
    this.#emit("nav.addressbar", {});
    return true;
  }

  /**
   * Follows Firefox's bookmarks for the API's events, from the first time the
   * UI listens for one.
   */
  watchBookmarks() {
    this.#unwatchBookmarks ??= NeekoBookmarks.watch((name, data) =>
      this.#emit(name, data)
    );
  }

  /**
   * Starts or stops following the pointer over the page for the edges the
   * UI watches (pointer.setEdges). The pointer over a web page never reaches
   * the UI, but the browser window hears its moves first (their target is
   * the page's <browser>), so nothing runs in the page for this.
   */
  watchEdges(depths) {
    let watching = Object.keys(this.#edges).length > 0;
    this.#edges = depths;
    let watch = Object.keys(depths).length > 0;
    if (watch && !watching) {
      this.win.addEventListener("mousemove", this, {
        capture: true,
        passive: true,
      });
      this.win.addEventListener("mouseout", this, {
        capture: true,
        passive: true,
      });
    } else if (!watch && watching) {
      this.win.removeEventListener("mousemove", this, { capture: true });
      this.win.removeEventListener("mouseout", this, { capture: true });
      this.#pointerAt(null, false);
    }
  }

  /**
   * Works out which watched edge of the page the pointer is at, from a
   * mouse event in the browser window.
   */
  #pointerMoved(event) {
    let tabbox = this.gBrowser.tabbox;
    let overPage = tabbox.contains(event.target);
    let leftWindow = event.type == "mouseout" && !event.relatedTarget;
    if (event.type == "mouseout" && !leftWindow) {
      // Moving within the window: the next mousemove says where to.
      return;
    }
    let edge = null;
    if (overPage) {
      let page = tabbox.getBoundingClientRect();
      let { clientX: x, clientY: y } = event;
      let distance = {
        top: y - page.top,
        left: x - page.left,
        right: page.right - 1 - x,
        bottom: page.bottom - 1 - y,
      };
      edge =
        EDGES.find(e => this.#edges[e] && distance[e] < this.#edges[e]) ??
        null;
    }
    this.#pointerAt(edge, leftWindow && !!edge);
  }

  /**
   * Tells the UI which edge the pointer is at, if that changed.
   */
  #pointerAt(edge, outside) {
    if (edge == this.#edge.edge && outside == this.#edge.outside) {
      return;
    }
    this.#edge = { edge, outside };
    this.#emit("pointer.edge", { edge, outside });
  }

  /**
   * Tells the UI that the user wants the browser's settings (Cmd+, or
   * Settings... in the app menu), if it has settings of its own.
   *
   * @returns {boolean} false if the UI doesn't listen for that, so Firefox's
   *   own settings should open instead.
   */
  requestSettings() {
    if (!this.listening.has("settings.request")) {
      return false;
    }
    this.#emit("settings.request", {});
    return true;
  }

  /**
   * Tells the UI that the user wants to bookmark the page (Cmd+D), if it
   * bookmarks pages itself.
   *
   * @returns {boolean} false if the UI doesn't listen for that, so Firefox's
   *   own bookmark panel should open instead.
   */
  requestBookmark() {
    if (!this.listening.has("bookmarks.request")) {
      return false;
    }
    this.#emit("bookmarks.request", {
      tabId: tabId(this.gBrowser.selectedTab),
    });
    return true;
  }

  /**
   * The window's downloads (NeekoDownloads), followed from the first time
   * the UI asks about them.
   */
  downloads() {
    this.#downloads ??= new NeekoDownloads(this.win, (event, data) =>
      this.#emit(event, data)
    );
    return this.#downloads;
  }

  /**
   * Whether a web page is fullscreen, and whether the window is.
   */
  fullscreenState() {
    return {
      page: !!this.win.document.fullscreenElement,
      window: !!this.win.fullScreen,
    };
  }

  /**
   * Tells the UI what changed about fullscreen, if anything did.
   */
  #fullscreenChanged(page) {
    let now = { ...this.fullscreenState(), page };
    for (let kind of ["page", "window"]) {
      if (now[kind] != this.#fullscreen[kind]) {
        this.#fullscreen[kind] = now[kind];
        this.#emit(`fullscreen.${kind}`, { fullscreen: now[kind] });
      }
    }
  }

  /**
   * Tells the UI about a new permission prompt (NeekoPanels).
   */
  promptOpened(prompt) {
    this.#emit("prompts.open", { prompt: this.describePrompt(prompt) });
  }

  /**
   * Tells the UI a permission prompt is gone (NeekoPanels).
   */
  promptClosed(id) {
    this.#emit("prompts.close", { id });
  }

  /**
   * NeekoPanels' description of a prompt, with the tab it's for.
   */
  describePrompt({ browser, ...prompt }) {
    let tab = this.gBrowser.getTabForBrowser(browser);
    return { ...prompt, tabId: tab ? tabId(tab) : null };
  }

  /**
   * Describes a tab for the UI and remembers what it was told.
   */
  describe(tab) {
    let description = describeTab(tab, this.#icon(tab));
    this.#lastSent.set(tab, description);
    return description;
  }

  /**
   * A tab's icon as a URL the UI can put in an <img>, or null. Firefox keeps
   * most icons as data: URLs, the image itself, often many kilobytes. The UI
   * gets a short blob: URL for it instead, made in the UI page and shared by
   * every tab with the same icon, so image data never goes through the API
   * and each icon is decoded once.
   *
   * SVG icons Firefox wraps in a moz-remote-image: URL (with the whole SVG
   * inside), so the page's own content process draws them, never this one.
   * Neeko loads that URL the way Firefox's tab strip would, and the UI gets a
   * blob: URL of the PNG that comes back: null until it's ready, then an
   * update. Other icons (chrome:, about:) are URLs already.
   */
  #icon(tab) {
    let image = tab.getAttribute("image") || null;
    let before = this.#tabIcons.get(tab);
    if (before !== image) {
      this.#releaseIcon(tab);
    }
    let remote = image?.startsWith("moz-remote-image:");
    if (!image?.startsWith("data:") && !remote) {
      return image;
    }
    let icon = this.#icons.get(image);
    if (!icon) {
      icon = { url: null, tabs: 0 };
      if (remote) {
        this.#loadRemoteIcon(image, icon);
      } else {
        icon.url = blobURL(this.#ui, image);
        if (!icon.url) {
          return null;
        }
      }
      this.#icons.set(image, icon);
    }
    if (before !== image) {
      icon.tabs++;
      this.#tabIcons.set(tab, image);
    }
    return icon.url;
  }

  /**
   * Turns a moz-remote-image: icon into a blob: URL in the UI page, then
   * tells the UI about the tabs that show it.
   */
  async #loadRemoteIcon(image, icon) {
    let bytes;
    try {
      bytes = await fetchRemoteImage(image);
    } catch (e) {
      console.error("Neeko: couldn't load a tab's icon.", e);
      return;
    }
    if (this.#destroyed || this.#icons.get(image) != icon) {
      return;
    }
    icon.url = this.#ui.URL.createObjectURL(
      new this.#ui.Blob([bytes], { type: "image/png" })
    );
    for (let tab of this.gBrowser.tabs) {
      if (this.#tabIcons.get(tab) === image) {
        this.#update(tab);
      }
    }
  }

  /**
   * A tab no longer shows its data: URL icon; once no tab does, its blob: URL
   * goes.
   */
  #releaseIcon(tab) {
    let image = this.#tabIcons.get(tab);
    this.#tabIcons.delete(tab);
    let icon = image && this.#icons.get(image);
    if (icon && --icon.tabs == 0) {
      this.#icons.delete(image);
      if (icon.url) {
        this.#ui.URL.revokeObjectURL(icon.url);
      }
    }
  }

  /**
   * Firefox's find for a tab's page (FinderParent, or Finder for a page in
   * this process). Asleep, a tab has no page to find in.
   */
  finder(id) {
    let tab = this.findTab(id);
    if (!tab.linkedPanel) {
      throw new Error(`Tab ${tabId(tab)} is asleep: there's no page to find in.`);
    }
    return tab.linkedBrowser.finder;
  }

  /**
   * Finds the next or previous match of what was last found.
   */
  findAgain(id, backwards) {
    let finder = this.finder(id);
    let text = finder.searchString;
    if (!text) {
      throw new Error("Nothing to find yet: call find.find() first.");
    }
    return this.runFind(finder, text, () =>
      finder.findAgain(text, backwards, false, false)
    );
  }

  /**
   * Runs a search and resolves with its outcome and match count, which
   * Firefox reports separately (onFindResult, then onMatchesCountResult).
   */
  runFind(finder, text, search) {
    return new Promise(resolve => {
      let found = null;
      let timer;
      let done = count => {
        this.win.clearTimeout(timer);
        finder.removeResultListener(listener);
        resolve({
          result: FIND_RESULTS.get(found?.result) ?? "notFound",
          current: count?.current ?? 0,
          total: count?.total ?? 0,
          limit: count?.limit ?? 0,
        });
      };
      let listener = {
        onFindResult(data) {
          if (data.searchString == text) {
            found = data;
          }
        },
        onMatchesCountResult(data) {
          if (found && data.searchString == text) {
            done(data);
          }
        },
        onHighlightFinished() {},
        onCurrentSelection() {},
      };
      finder.addResultListener(listener);
      timer = this.win.setTimeout(() => done(null), FIND_TIMEOUT);
      search();
    });
  }

  /**
   * Tells the UI that the user wants to find in the page, if it finds
   * itself: "find" (Cmd+F, or / or ' in a page), "next" (Cmd+G), "previous"
   * (Cmd+Shift+G) or "selection" (Cmd+E, find the selected text), with the
   * page's selected text for the first and last.
   *
   * @returns {boolean} false if the UI doesn't listen for that, so Firefox's
   *   own find bar should open instead.
   */
  requestFind(command) {
    if (!this.listening.has("find.request")) {
      return false;
    }
    let browser = this.gBrowser.selectedBrowser;
    // After Cmd+F in the page, the page passes its keys on to Firefox's find
    // bar until that says it has the focus (FindBarChild): say so for it.
    try {
      browser.sendMessageToActor(
        "Findbar:UpdateState",
        { findMode: 0, isOpenAndFocused: true, hasQuickFindTimeout: false },
        "FindBar",
        "all"
      );
    } catch (e) {
      // A page without Firefox's find helper.
    }
    // Asking the page for its selection takes a moment; requests still reach
    // the UI in the order they came.
    let selected =
      (command == "find" || command == "selection") && browser.isRemoteBrowser
        ? Promise.resolve(browser.finder.getInitialSelection()).catch(() => null)
        : null;
    this.#findRequests = this.#findRequests
      .then(() => selected)
      .then(response =>
        this.#emit("find.request", {
          command,
          selection: response?.selectedText ?? "",
        })
      );
    return true;
  }

  /**
   * The tab group with this id in this window.
   */
  findGroup(id) {
    if (typeof id != "string") {
      throw new TypeError("Expected a group id.");
    }
    let group = this.gBrowser.tabGroups.find(g => g.id === id);
    if (!group) {
      throw new Error(`No tab group with id ${id} in this window.`);
    }
    return group;
  }

  checkGroupColor(color) {
    let colors =
      this.win.customElements.get("tabgroup-menu")?.COLORS ?? GROUP_COLORS;
    if (!colors.includes(color)) {
      throw new TypeError(`A group's color is one of: ${colors.join(", ")}.`);
    }
    return color;
  }

  /**
   * Tells the UI a tab group changed, and how.
   */
  #groupChanged(group) {
    let before = this.#groupsSent.get(group);
    let now = describeGroup(group);
    this.#groupsSent.set(group, now);
    let changed = ["name", "color", "collapsed"].filter(
      field => now[field] !== before?.[field]
    );
    if (changed.length) {
      this.#emit("groups.update", { group: now, changed });
    }
  }

  /**
   * The tab with this id in this window. With no id, the selected tab.
   */
  findTab(id) {
    if (id === undefined) {
      return this.gBrowser.selectedTab;
    }
    let tab = this.gBrowser.tabs.find(t => tabIds.get(t) === id);
    if (!tab || tab.closing) {
      throw new Error(`No tab with id ${id} in this window.`);
    }
    return tab;
  }

  /**
   * Tells the UI what changed about a tab, if anything did.
   */
  #update(tab) {
    if (tab.closing) {
      return;
    }
    let before = this.#lastSent.get(tab);
    let now = this.describe(tab);
    let changed = UPDATE_FIELDS.filter(
      field => !sameValue(now[field], before?.[field])
    );
    if (changed.length) {
      this.#emit("tabs.update", { tab: now, changed });
    }
  }

  handleEvent(event) {
    switch (event.type) {
      case "mousemove":
      case "mouseout":
        this.#pointerMoved(event);
        return;
      case "MozDOMFullscreen:Entered":
        this.#fullscreenChanged(true);
        return;
      case "MozDOMFullscreen:Exited":
        this.#fullscreenChanged(false);
        return;
      case "fullscreen":
        this.#fullscreenChanged(this.#fullscreen.page);
        return;
    }
    switch (event.type) {
      case "TabGrouped":
      case "TabUngrouped": {
        // Tabs leaving for another window close here instead.
        let tab = event.detail;
        if (tab.ownerDocument == this.win.document && tab.isConnected) {
          this.#update(tab);
        }
        return;
      }
      case "TabGroupCreate":
        this.#groupsSent.set(event.target, describeGroup(event.target));
        this.#emit("groups.create", { group: describeGroup(event.target) });
        return;
      case "TabGroupRemoved":
        this.#emit("groups.remove", { id: event.target.id });
        return;
      case "TabGroupUpdate":
      case "TabGroupCollapse":
      case "TabGroupExpand":
        this.#groupChanged(event.target);
        return;
    }
    let tab = event.target;
    switch (event.type) {
      case "TabOpen":
        this.#emit("tabs.open", { tab: this.describe(tab), index: tab.index });
        break;
      case "TabClose":
        this.#lastSent.delete(tab);
        this.#releaseIcon(tab);
        this.#emit("tabs.close", { id: tabId(tab) });
        break;
      case "TabSelect": {
        let previous = event.detail.previousTab;
        this.#emit("tabs.select", {
          id: tabId(tab),
          previousId: previous ? tabId(previous) : null,
        });
        // Firefox marks new tabs on the New Tab page to get its address bar
        // focused once they're selected.
        if (this.win.gURLBar?.getBrowserState(tab.linkedBrowser).urlbarFocused) {
          this.requestAddressBar();
        }
        break;
      }
      case "TabMove":
        this.#emit("tabs.move", { id: tabId(tab), index: tab.index });
        break;
      case "TabAttrModified":
        if (event.detail.changed.some(a => WATCHED_ATTRIBUTES.includes(a))) {
          this.#update(tab);
        }
        break;
      default:
        // A tab woke up or went to sleep, which changes its back/forward.
        this.#update(tab);
    }
  }

  /**
   * Tabs progress listener: a tab's page changed its address, which can also
   * change whether it can go back or forward, and whether it's an error page
   * (the browser's documentURI is up to date by now).
   */
  onLocationChange(browser, webProgress) {
    if (!webProgress.isTopLevel) {
      return;
    }
    let tab = this.gBrowser.getTabForBrowser(browser);
    if (tab) {
      this.#update(tab);
    }
  }
}
