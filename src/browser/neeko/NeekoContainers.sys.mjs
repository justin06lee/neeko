/**
 * Containers, one per window: the app's own identities (a browser might
 * call them profiles: Personal, Work...), each with its own cookies,
 * storage and cache, while history and bookmarks stay shared. Underneath
 * each is a Firefox user context (userContextId); Firefox's own container
 * feature (its menus, settings and identity list) isn't used, and a browser
 * that declares containers turns its UI off (tools/app.ts).
 *
 * The app declares its containers in browser.json; they seed a profile's
 * list on its first run, kept after that in <profile>/neeko-containers.json
 * and changed through the API. The one marked `default` is Firefox's default
 * context (userContextId 0), so what a profile already had stays in it; the
 * others get ids from FIRST_ID up, away from Firefox's own containers.
 * Ephemeral containers live in private windows (Firefox decides private
 * browsing per window), and are wiped when their last window closes and at
 * startup.
 *
 * Every window is in one container. A window opened with nothing to say
 * which (Cmd+N, the first window at launch) has none until its UI picks one
 * (setContainer): it loads nothing meanwhile, and the addresses it was
 * opened with wait for the pick. Every tab opened in a window afterwards is
 * in its container (addTab), and tabs of other containers can't be moved
 * in. Without declared containers, none of this happens.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  NetUtil: "resource://gre/modules/NetUtil.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  SessionStore: "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
});

const FILE_NAME = "neeko-containers.json";
// The containers the app declares (tools/app.ts writes it from browser.json).
const BUILTIN_PREF = "neeko.containers.builtin";
// The first userContextId Neeko gives a container that isn't the default.
const FIRST_ID = 1000;
// How content processes learn which container a userContextId is.
const SHARED_DATA_KEY = "neeko-containers";
// Where a window's container is saved with the session.
const SESSION_KEY = "neeko-container";
// Where Neeko says which container a window it opens is for.
const ARGUMENT_KEY = "neeko-container";
const TAB_DROP_TYPE = "application/x-moz-tabbrowser-tab";

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const COLOR =
  /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,30}|[a-z]{3,6}\([0-9a-zA-Z.,%/ +-]{1,80}\))$/;

// Pages a window opens when nothing in particular was asked: they don't wait
// for a container, the window opens its New Tab page once it has one.
const START_PAGES = new Set([
  "about:blank",
  "about:home",
  "about:newtab",
  "about:privatebrowsing",
  "about:start",
]);

// The containers: null until first needed.
let store = null;

// Each window's state: { container, pending, restoring, restored }, restored
// being the tabs session restore brought back.
const windows = new WeakMap();

// Called with (win, containerId) when a window's container changes, and with
// the list when the containers do (NeekoAPI, NeekoPageParent).
const windowListeners = new Set();
const listListeners = new Set();

function isPrivate(win) {
  return lazy.PrivateBrowsingUtils.isWindowPrivate(win);
}

function readFileSync(path) {
  let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  file.initWithPath(path);
  if (!file.exists()) {
    return null;
  }
  let stream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(
    Ci.nsIFileInputStream
  );
  stream.init(file, -1, 0, 0);
  try {
    return lazy.NetUtil.readInputStreamToString(stream, stream.available(), {
      charset: "UTF-8",
    });
  } finally {
    stream.close();
  }
}

/**
 * Checks what the app or a page says a container is: { name, color,
 * picture, ephemeral }, all but the name optional.
 */
function checkFields(fields, { creating }) {
  if (!fields || typeof fields != "object" || Array.isArray(fields)) {
    throw new TypeError("Expected a container's fields, like { name }.");
  }
  for (let key of Object.keys(fields)) {
    if (!["name", "color", "picture", "ephemeral"].includes(key)) {
      throw new TypeError(`Unknown field "${key}".`);
    }
  }
  let { name, color, picture, ephemeral } = fields;
  if (
    (creating || name !== undefined) &&
    (typeof name != "string" || !name.trim() || name.length > 64)
  ) {
    throw new TypeError("A container's name is 1 to 64 characters.");
  }
  if (color !== undefined && color !== null) {
    if (typeof color != "string" || !COLOR.test(color.trim())) {
      throw new TypeError('A container\'s color is a CSS color, like "#0ea5e9".');
    }
  }
  if (picture !== undefined && picture !== null) {
    if (typeof picture != "string" || picture.length > 256) {
      throw new TypeError("A container's picture is a string of the app's.");
    }
  }
  if (ephemeral !== undefined && typeof ephemeral != "boolean") {
    throw new TypeError("ephemeral is true or false.");
  }
  return fields;
}

/** What the API tells about a container. */
function describe(c) {
  return {
    id: c.id,
    name: c.name,
    color: c.color,
    picture: c.picture,
    ephemeral: c.ephemeral,
    default: c.userContextId == 0,
  };
}

/**
 * Wipes everything Firefox keeps for a user context: cookies, storage,
 * cache, permissions..., in private windows too.
 */
function clearUserContext(userContextId) {
  return new Promise(resolve => {
    Services.clearData.deleteDataFromOriginAttributesPattern(
      { userContextId },
      { onDataDeleted: () => resolve() }
    );
  });
}

class ContainerStore {
  containers = [];
  nextId = FIRST_ID;

  get path() {
    return PathUtils.join(PathUtils.profileDir, FILE_NAME);
  }

  /**
   * Reads the profile's containers, synchronously: the first window needs
   * to know before anything loads. A profile without the file starts with
   * the app's.
   */
  load() {
    let data = null;
    try {
      let text = readFileSync(this.path);
      data = text && JSON.parse(text);
    } catch (e) {
      console.error("Neeko: couldn't read the containers, starting again.", e);
    }
    if (data?.containers) {
      this.containers = data.containers;
      this.nextId = Math.max(FIRST_ID, data.nextId || 0);
      return;
    }
    let builtin = [];
    try {
      builtin = JSON.parse(Services.prefs.getStringPref(BUILTIN_PREF, "") || "[]");
    } catch (e) {
      console.error(`Neeko: ${BUILTIN_PREF} isn't valid JSON.`, e);
    }
    for (let c of builtin) {
      this.containers.push({
        id: c.id,
        name: c.name,
        color: c.color ?? null,
        picture: c.picture ?? null,
        ephemeral: !!c.ephemeral,
        userContextId: c.default && !c.ephemeral ? 0 : this.nextId++,
      });
    }
    if (this.containers.length) {
      this.save();
    }
  }

  save() {
    IOUtils.writeJSON(
      this.path,
      { version: 1, nextId: this.nextId, containers: this.containers },
      { tmpPath: `${this.path}.tmp` }
    ).catch(e => console.error("Neeko: couldn't save the containers.", e));
    this.share();
  }

  /** Tells content processes which container each user context is. */
  share() {
    let byUserContextId = {};
    for (let c of this.containers) {
      byUserContextId[c.userContextId] = c.id;
    }
    Services.ppmm.sharedData.set(SHARED_DATA_KEY, byUserContextId);
    Services.ppmm.sharedData.flush();
  }

  changed() {
    this.save();
    let list = this.containers.map(describe);
    for (let listener of listListeners) {
      try {
        listener(list);
      } catch (e) {
        console.error(e);
      }
    }
  }

  byId(id) {
    return this.containers.find(c => c.id === id) ?? null;
  }

  byUserContextId(userContextId) {
    return this.containers.find(c => c.userContextId == userContextId) ?? null;
  }
}

function getStore() {
  if (!store) {
    store = new ContainerStore();
    store.load();
  }
  return store;
}

function enabled() {
  return getStore().containers.length > 0;
}

/** The container of a window's kind to fall back on, if any. */
function fallbackContainer(win) {
  let { containers } = getStore();
  return isPrivate(win)
    ? (containers.find(c => c.ephemeral) ?? null)
    : (containers.find(c => c.userContextId == 0) ?? null);
}

function urlsOf(argument) {
  if (!argument) {
    return [];
  }
  if (typeof argument == "string") {
    return [argument];
  }
  if (argument instanceof Ci.nsIArray) {
    return Array.from(argument.enumerate(Ci.nsISupportsString), s => s.data);
  }
  if (argument instanceof Ci.nsISupportsString) {
    return [argument.data];
  }
  return [];
}

function isStartPage(win, url) {
  if (!url || START_PAGES.has(url)) {
    return true;
  }
  try {
    return url == win.BROWSER_NEW_TAB_URL || url == win.BrowserHandler?.defaultArgs;
  } catch (e) {
    return false;
  }
}

function openWindowInfo(win) {
  try {
    return (
      win.docShell.treeOwner
        .QueryInterface(Ci.nsIInterfaceRequestor)
        .getInterface(Ci.nsIAppWindow).initialOpenWindowInfo ||
      win.arguments?.[11] ||
      null
    );
  } catch (e) {
    return null;
  }
}

/**
 * The container a new window is for, from how it was opened, or null if
 * nothing says: Neeko's own replacement windows say so, a tab dragged out
 * keeps its container, pop-ups and "Open Link in New Window" their
 * opener's (Firefox passes its userContextId), and a private window opened
 * any other way gets the first ephemeral container.
 */
function containerFor(win) {
  let s = getStore();
  let args = win.arguments;
  let bag = args?.[1];
  let found = null;
  if (bag instanceof Ci.nsIPropertyBag2 && bag.hasKey(ARGUMENT_KEY)) {
    found = s.byId(bag.getPropertyAsAString(ARGUMENT_KEY));
  }
  let tab = !found && win.gBrowserInit?.getTabToAdopt?.();
  if (tab) {
    found = s.byUserContextId(tab.userContextId ?? 0);
  }
  let info = !found && !tab && openWindowInfo(win);
  if (info) {
    found = s.byUserContextId(info.originAttributes.userContextId ?? 0);
  }
  // openLinkIn's full form of window arguments: [5] is the userContextId.
  if (!found && !tab && !info && args?.length >= 6 && typeof args[5] == "number") {
    found = s.byUserContextId(args[5]);
  }
  if (found && found.ephemeral != isPrivate(win)) {
    found = null;
  }
  if (!found && isPrivate(win)) {
    found = fallbackContainer(win);
  }
  return found;
}

function notifyWindow(win) {
  let id = windows.get(win)?.container ?? null;
  for (let listener of windowListeners) {
    try {
      listener(win, id);
    } catch (e) {
      console.error(e);
    }
  }
}

/** Saves a window's container with the session, once SessionStore knows it. */
function saveToSession(win) {
  let id = windows.get(win)?.container;
  if (!id || !win.__SSi) {
    return;
  }
  try {
    lazy.SessionStore.setCustomWindowValue(win, SESSION_KEY, id);
  } catch (e) {
    console.error("Neeko: couldn't save a window's container.", e);
  }
}

/**
 * Forgets the closed windows that were in a container, so none comes back
 * into what it has become, or into nothing.
 */
function forgetClosedWindows(container) {
  for (let data of lazy.SessionStore.getClosedWindowData()) {
    if (
      data.extData?.[SESSION_KEY] == container.id ||
      data.tabs?.some(tab => (tab.userContextId ?? 0) == container.userContextId)
    ) {
      lazy.SessionStore.forgetClosedWindowById(data.closedId);
    }
  }
}

function bind(win, container) {
  let state = windows.get(win);
  state.container = container.id;
  saveToSession(win);
  notifyWindow(win);
}

/**
 * A window's container is gone: its pages stop, and it waits for its UI to
 * pick again.
 */
function orphan(win) {
  let state = windows.get(win);
  state.container = null;
  state.pending = [];
  let system = Services.scriptSecurityManager.getSystemPrincipal();
  for (let tab of win.gBrowser.tabs) {
    try {
      tab.linkedBrowser.loadURI(Services.io.newURI("about:blank"), {
        triggeringPrincipal: system,
      });
    } catch (e) {
      // A tab that's asleep has nothing to stop.
    }
  }
  notifyWindow(win);
}

/**
 * The arguments for a new window in a container, as openLinkIn gives them
 * (browser-init.js reads them): its first address, and Neeko's word on its
 * container.
 */
function windowArguments(url, container) {
  let args = Cc["@mozilla.org/array;1"].createInstance(Ci.nsIMutableArray);
  let uri = Cc["@mozilla.org/supports-string;1"].createInstance(
    Ci.nsISupportsString
  );
  uri.data = url;
  let bag = Cc["@mozilla.org/hash-property-bag;1"].createInstance(
    Ci.nsIWritablePropertyBag2
  );
  bag.setPropertyAsAString(ARGUMENT_KEY, container.id);
  let fixup = Cc["@mozilla.org/supports-PRBool;1"].createInstance(
    Ci.nsISupportsPRBool
  );
  fixup.data = false;
  let userContextId = Cc["@mozilla.org/supports-PRUint32;1"].createInstance(
    Ci.nsISupportsPRUint32
  );
  userContextId.data = container.userContextId;
  for (let value of [
    uri,
    bag,
    null, // referrerInfo
    null, // postData
    fixup,
    userContextId,
    null, // originPrincipal
    null, // originStoragePrincipal
    Services.scriptSecurityManager.getSystemPrincipal(),
    null, // allowInheritPrincipal
    null, // policyContainer
  ]) {
    args.appendElement(value);
  }
  return args;
}

function whenStarted(win) {
  return new Promise(resolve => {
    let observer = subject => {
      if (subject == win) {
        Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
        resolve();
      }
    };
    Services.obs.addObserver(observer, "browser-delayed-startup-finished");
  });
}

/**
 * Replaces a window with one of the other kind (private or not) for a
 * container, at the same place and size, with the addresses it was waiting
 * to open.
 */
async function replaceWindow(win, container, urls) {
  let maximized = win.windowState == win.STATE_MAXIMIZED;
  let place = [win.screenX, win.screenY, win.outerWidth, win.outerHeight];
  let features =
    win.windowState == win.STATE_FULLSCREEN
      ? undefined
      : `left=${place[0]},top=${place[1]},outerWidth=${place[2]},outerHeight=${place[3]},suppressanimation`;
  let first = urls[0] ?? win.BROWSER_NEW_TAB_URL;
  let replacement = lazy.BrowserWindowTracker.openWindow({
    private: container.ephemeral,
    features,
    args: windowArguments(first, container),
  });
  if (maximized) {
    replacement.addEventListener("load", () => replacement.maximize(), {
      once: true,
    });
  }
  await whenStarted(replacement);
  // Linux window managers place a new window where they like, and size its
  // frame their own way, but follow a move once it's shown.
  if (features && !maximized) {
    replacement.moveTo(place[0], place[1]);
    replacement.resizeTo(place[2], place[3]);
  }
  for (let url of urls.slice(1)) {
    replacement.gBrowser.addTrustedTab(url, { inBackground: true });
  }
  try {
    win.windowUtils.suppressAnimation(true);
  } catch (e) {
    // Only macOS animates closing windows.
  }
  win.close();
}

/**
 * Keeps every tab of a window in its container: tabs it opens get it, tabs
 * of other containers can't come in, and a window without one loads nothing
 * until it has one.
 */
function wrapTabbrowser(win) {
  let gBrowser = win.gBrowser;
  let addTab = gBrowser.addTab;
  gBrowser.addTab = function (uri, params = {}) {
    let state = windows.get(win);
    // A tab moving in from another window (adoptTab checks it), or one
    // session restore brings back: it keeps its own.
    if (!state || params.eventDetail?.adoptedTab || state.restoring) {
      let tab = addTab.call(this, uri, params);
      if (state?.restoring) {
        state.restored.add(tab);
      }
      return tab;
    }
    let container = state.container && getStore().byId(state.container);
    if (!container) {
      if (uri && !isStartPage(win, uri)) {
        state.pending.push(uri);
      }
      return addTab.call(this, "about:blank", { ...params, userContextId: 0 });
    }
    return addTab.call(this, uri, {
      ...params,
      userContextId: container.userContextId,
    });
  };

  let sameContainer = tab =>
    getStore().byUserContextId(tab.userContextId ?? 0)?.id ==
    windows.get(win)?.container;
  let adoptTab = gBrowser.adoptTab;
  gBrowser.adoptTab = function (tab, options) {
    return sameContainer(tab) ? adoptTab.call(this, tab, options) : null;
  };
  let swap = gBrowser.swapBrowsersAndCloseOther;
  gBrowser.swapBrowsersAndCloseOther = function (ourTab, otherTab) {
    return sameContainer(otherTab) ? swap.call(this, ourTab, otherTab) : false;
  };
  let dragAndDrop = gBrowser.tabContainer?.tabDragAndDrop;
  let getDropEffect = dragAndDrop?.getDropEffectForTabDrag;
  if (getDropEffect) {
    dragAndDrop.getDropEffectForTabDrag = function (event) {
      let effect = getDropEffect.call(this, event);
      if (effect == "move" || effect == "copy") {
        let source = event.dataTransfer.mozGetDataAt(TAB_DROP_TYPE, 0);
        let sourceWindow = source?.ownerDocument?.defaultView;
        if (
          sourceWindow != win &&
          windows.get(sourceWindow)?.container != windows.get(win)?.container
        ) {
          return "none";
        }
      }
      return effect;
    };
  }

  // Session restore brings a window's tabs back with their own user
  // contexts, then its saved values: the window's container is decided once
  // it's done. Only if it brought tabs back: at a launch that doesn't restore
  // the session, it still restores the first window's closed tabs and place
  // (not its saved values), and that window's own blank tab would say "the
  // default container". Nothing restored, the UI picks, as for any first
  // window.
  win.addEventListener("SSWindowStateBusy", () => {
    windows.get(win).restoring = true;
  });
  win.addEventListener("SSWindowStateReady", () => {
    let state = windows.get(win);
    state.restoring = false;
    if (state.container) {
      saveToSession(win);
      return;
    }
    // (The restored tab to select can be the window's own blank one, reused
    // when their containers match, which only SessionStore knows about.)
    let restored = gBrowser.tabs.filter(
      tab => state.restored.has(tab) || lazy.SessionStore.isTabRestoring(tab)
    );
    if (!restored.length) {
      return;
    }
    let s = getStore();
    let saved = null;
    try {
      saved = lazy.SessionStore.getCustomWindowValue(win, SESSION_KEY);
    } catch (e) {
      // Nothing saved.
    }
    let tab = restored.includes(gBrowser.selectedTab) ? gBrowser.selectedTab : restored[0];
    let container = s.byId(saved) ?? s.byUserContextId(tab.userContextId ?? 0);
    if (container && container.ephemeral == isPrivate(win)) {
      state.pending = [];
      bind(win, container);
    }
  });
}

export const NeekoContainers = {
  /** Whether the app has containers (it declared some). */
  get enabled() {
    return enabled();
  },

  /**
   * Called once at startup: ephemeral containers start empty, even after a
   * crash, and content processes learn the containers.
   */
  init() {
    if (!enabled()) {
      return;
    }
    let s = getStore();
    s.share();
    for (let c of s.containers) {
      if (c.ephemeral) {
        clearUserContext(c.userContextId).catch(console.error);
      }
    }
  },

  /**
   * Called for each browser window before its tabs exist
   * (browser-window-domcontentloaded-before-tabbrowser): works out its
   * container, if anything says, and otherwise keeps it from loading what
   * it was opened with until its UI picks one.
   */
  beforeTabbrowser(win) {
    if (!enabled()) {
      return;
    }
    let state = { container: null, pending: [], restoring: false, restored: new WeakSet() };
    windows.set(win, state);
    let container = containerFor(win);
    // A window without a UI to pick with (a pop-up, or no UI at all) gets its
    // kind's first container.
    if (!container && (!win.toolbar.visible || !hasUI())) {
      container = fallbackContainer(win);
    }
    if (container) {
      state.container = container.id;
      let args = win.arguments;
      if (args && !win.gBrowserInit?.getTabToAdopt?.() && !openWindowInfo(win)) {
        // The first tab is in the container: Tabbrowser reads [5]. With
        // that, browser-init.js loads the window's first page with the full
        // form of the arguments, which needs the rest filled in.
        if (args.length < 3) {
          args[1] = null;
          args[2] = null;
          args[3] = null;
          args[4] = false;
          args[8] = Services.scriptSecurityManager.getSystemPrincipal();
        }
        args[5] = container.userContextId;
      }
      return;
    }
    state.pending = urlsOf(win.arguments?.[0]).filter(url => !isStartPage(win, url));
    if (win.arguments?.length) {
      win.arguments[0] = null;
    }
    // browser-init.js has usually read what to load already, for the
    // bookmarks toolbar, and keeps the value: nothing.
    if (win.gBrowserInit) {
      Object.defineProperty(win.gBrowserInit, "uriToLoadPromise", {
        value: null,
        writable: true,
        configurable: true,
      });
    }
  },

  /**
   * Called for each browser window once its tabs exist
   * (browser-window-domcontentloaded).
   */
  initWindow(win) {
    if (enabled() && windows.has(win)) {
      wrapTabbrowser(win);
    }
  },

  /**
   * Called once SessionStore follows a window
   * (browser-window-sessionstore-initialized).
   */
  sessionStoreReady(win) {
    saveToSession(win);
  },

  /**
   * Called as a browser window closes (browser-window-unload-begin): an
   * ephemeral container is wiped once none of its windows is left.
   */
  uninitWindow(win) {
    let id = windows.get(win)?.container;
    windows.delete(win);
    let container = id && getStore().byId(id);
    if (!container?.ephemeral) {
      return;
    }
    let stillOpen = lazy.BrowserWindowTracker.orderedWindows.some(
      w => w != win && !w.closed && windows.get(w)?.container == id
    );
    if (!stillOpen) {
      clearUserContext(container.userContextId).catch(console.error);
    }
  },

  /** The container a window is in: its id, or null. */
  containerOf(win) {
    return windows.get(win)?.container ?? null;
  },

  /**
   * Puts a window that has no container in one: the tabs it was waiting to
   * open open in it (or the New Tab page), and its blank ones go. A
   * container of the other kind (ephemeral in a normal window, or the
   * reverse) replaces the window with one of the right kind, at the same
   * place and size.
   */
  async setContainer(win, id) {
    let state = windows.get(win);
    if (!state) {
      throw new Error("The app has no containers: declare them in browser.json.");
    }
    if (state.container) {
      throw new Error("This window already has a container: open a new window for another.");
    }
    let container = getStore().byId(id);
    if (!container) {
      throw new Error(`No container with id ${id}.`);
    }
    let urls = state.pending.splice(0);
    if (container.ephemeral != isPrivate(win)) {
      await replaceWindow(win, container, urls);
      return;
    }
    let gBrowser = win.gBrowser;
    let blank = [...gBrowser.tabs];
    bind(win, container);
    let first = urls.length ? urls : [win.BROWSER_NEW_TAB_URL];
    first.forEach((url, i) => {
      gBrowser.addTrustedTab(url, { inBackground: i > 0 });
    });
    for (let tab of blank) {
      gBrowser.removeTab(tab, { animate: false, skipPermitUnload: true });
    }
  },

  /** Every container, in order. */
  list() {
    return getStore().containers.map(describe);
  },

  /** Makes a container; its id comes from its name. */
  create(fields) {
    if (!enabled()) {
      throw new Error("The app has no containers: declare them in browser.json.");
    }
    checkFields(fields, { creating: true });
    let s = getStore();
    let base =
      fields.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
      "container";
    let id = base.slice(0, 56);
    for (let n = 2; s.byId(id); n++) {
      id = `${base.slice(0, 56)}-${n}`;
    }
    let container = {
      id,
      name: fields.name.trim(),
      color: fields.color?.trim() ?? null,
      picture: fields.picture ?? null,
      ephemeral: !!fields.ephemeral,
      userContextId: s.nextId++,
    };
    s.containers.push(container);
    s.changed();
    return describe(container);
  },

  /**
   * Renames a container, or changes its color or picture, or whether it's
   * ephemeral (only while none of its windows is open: what it kept is
   * wiped).
   */
  async update(id, changes) {
    checkFields(changes, { creating: false });
    let s = getStore();
    let container = s.byId(id);
    if (!container) {
      throw new Error(`No container with id ${id}.`);
    }
    // Ephemeral or not, while none of its windows is open: private windows
    // or normal ones hold it, and nothing it kept carries over.
    if (changes.ephemeral !== undefined && changes.ephemeral != container.ephemeral) {
      if (container.userContextId == 0) {
        throw new Error("The default container can't be ephemeral.");
      }
      let open = lazy.BrowserWindowTracker.orderedWindows.some(
        win => !win.closed && windows.get(win)?.container == id
      );
      if (open) {
        throw new Error(
          "A container becomes ephemeral, or stops being, only while none of its windows is open."
        );
      }
      // Windows that pick it meanwhile are of its new kind.
      container.ephemeral = changes.ephemeral;
      forgetClosedWindows(container);
      await clearUserContext(container.userContextId);
    }
    if (changes.name !== undefined) {
      container.name = changes.name.trim();
    }
    if (changes.color !== undefined) {
      container.color = changes.color?.trim() ?? null;
    }
    if (changes.picture !== undefined) {
      container.picture = changes.picture;
    }
    s.changed();
    for (let win of lazy.BrowserWindowTracker.orderedWindows) {
      if (windows.get(win)?.container == id) {
        notifyWindow(win);
      }
    }
    return describe(container);
  },

  /**
   * Removes a container and everything it kept. Its windows wait for their
   * UI to pick another. The default one, and the last one, stay.
   */
  async remove(id) {
    let s = getStore();
    let container = s.byId(id);
    if (!container) {
      throw new Error(`No container with id ${id}.`);
    }
    if (container.userContextId == 0) {
      throw new Error("The default container can't be removed (it can be cleared).");
    }
    if (s.containers.length == 1) {
      throw new Error("The last container can't be removed.");
    }
    s.containers = s.containers.filter(c => c != container);
    s.changed();
    for (let win of lazy.BrowserWindowTracker.orderedWindows) {
      if (windows.get(win)?.container == id) {
        orphan(win);
      }
    }
    forgetClosedWindows(container);
    await clearUserContext(container.userContextId);
  },

  /**
   * Wipes what a container kept (cookies, storage, cache...), and reloads
   * its tabs.
   */
  async clear(id) {
    let container = getStore().byId(id);
    if (!container) {
      throw new Error(`No container with id ${id}.`);
    }
    await clearUserContext(container.userContextId);
    for (let win of lazy.BrowserWindowTracker.orderedWindows) {
      if (windows.get(win)?.container != id) {
        continue;
      }
      for (let tab of win.gBrowser.tabs) {
        if (tab.linkedPanel) {
          win.gBrowser.reloadTab(tab);
        }
      }
    }
  },

  /**
   * Calls listener(win, containerId) when a window's container changes, or
   * its container does. Returns a function that stops it.
   */
  watchWindows(listener) {
    windowListeners.add(listener);
    return () => windowListeners.delete(listener);
  },

  /**
   * Calls listener(list) when the containers change. Returns a function that
   * stops it.
   */
  watch(listener) {
    listListeners.add(listener);
    return () => listListeners.delete(listener);
  },

  /**
   * In a content process: the id of the container a user context is, from
   * what the parent shares.
   */
  idForUserContext(userContextId) {
    return Services.cpmm.sharedData.get(SHARED_DATA_KEY)?.[userContextId] ?? null;
  },
};

/**
 * Whether windows have a custom UI to pick a container with: a UI folder
 * (dev launches) or one the build bundled (NeekoWindow's findUI).
 */
function hasUI() {
  if (Services.prefs.getStringPref("neeko.ui.path", "")) {
    return true;
  }
  try {
    Cc["@mozilla.org/chrome/chrome-registry;1"]
      .getService(Ci.nsIChromeRegistry)
      .convertChromeURL(Services.io.newURI("chrome://neeko-ui/content/index.html"));
    return true;
  } catch (e) {
    return false;
  }
}
