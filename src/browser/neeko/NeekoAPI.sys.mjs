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

import { NeekoPanels } from "moz-src:///browser/neeko/NeekoPanels.sys.mjs";

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

/**
 * What the UI knows about a tab. Tabs that are asleep (restored but never
 * shown, or unloaded to save memory) have no page yet, and asking about their
 * history would wake them, so they report no back or forward.
 */
function describeTab(tab) {
  let browser = tab.linkedBrowser;
  let asleep = !tab.linkedPanel;
  let uri = browser.currentURI;
  return {
    id: tabId(tab),
    // Without any user:password@ part.
    url: uri ? Services.io.createExposableURI(uri).spec : "",
    title: tab.label,
    loading: tab.hasAttribute("busy"),
    canGoBack: !asleep && browser.canGoBack,
    canGoForward: !asleep && browser.canGoForward,
    selected: tab.selected,
  };
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
];

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
const UPDATE_FIELDS = ["url", "title", "loading", "canGoBack", "canGoForward"];

// Tab attributes Firefox reports changing that affect a tab's description.
const WATCHED_ATTRIBUTES = ["label", "busy"];

const TAB_EVENTS = [
  "TabOpen",
  "TabClose",
  "TabSelect",
  "TabMove",
  "TabAttrModified",
  "TabBrowserInserted",
  "TabBrowserDiscarded",
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
    if (event == "prompts.open") {
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
   * Opens a tab and selects it, the way the address bar or Cmd+T would. With
   * no input it shows the New Tab page.
   */
  "tabs.open"(input) {
    let url =
      input === undefined ? this.win.BROWSER_NEW_TAB_URL : addressInput(input);
    let browser = null;
    this.win.openTrustedLinkIn(url, "tab", {
      allowThirdPartyFixup: true,
      resolveOnNewTabCreated: b => (browser = b),
    });
    let tab = browser && this.gBrowser.getTabForBrowser(browser);
    if (!tab) {
      throw new Error("The tab didn't open in this window.");
    }
    return this.describe(tab);
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
    let url = addressInput(input);
    this.win.openTrustedLinkIn(url, "current", {
      targetBrowser: this.findTab(id).linkedBrowser,
      allowThirdPartyFixup: true,
      allowInheritPrincipal: false,
      allowPinnedTabHostChange: true,
      indicateErrorPageLoad: true,
    });
  },

  "nav.back"(id) {
    this.findTab(id).linkedBrowser.goBack();
  },

  "nav.forward"(id) {
    this.findTab(id).linkedBrowser.goForward();
  },

  "nav.reload"(id) {
    this.gBrowser.reloadTab(this.findTab(id));
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
};

export class NeekoAPI {
  /** What each tab looked like when the UI last heard about it. */
  #lastSent = new WeakMap();
  /** The events the UI listens for. */
  listening = new Set();
  /** The fullscreen state the UI last heard about. */
  #fullscreen;
  #send;
  #destroyed = false;

  /**
   * @param {Window} win The browser window whose tabs the UI controls. Its
   *   gBrowser must already exist.
   * @param {Function} send Delivers a message to the UI.
   */
  constructor(win, send) {
    this.win = win;
    this.gBrowser = win.gBrowser;
    this.#send = send;
    for (let type of TAB_EVENTS) {
      this.gBrowser.tabContainer.addEventListener(type, this);
    }
    this.gBrowser.addTabsProgressListener(this);
    this.#fullscreen = this.fullscreenState();
    for (let type of FULLSCREEN_EVENTS) {
      win.addEventListener(type, this, true);
    }
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
    for (let type of TAB_EVENTS) {
      this.gBrowser.tabContainer.removeEventListener(type, this);
    }
    this.gBrowser.removeTabsProgressListener(this);
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
    if (!this.#destroyed && this.listening.has(event)) {
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
    let description = describeTab(tab);
    this.#lastSent.set(tab, description);
    return description;
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
    let changed = UPDATE_FIELDS.filter(field => now[field] !== before?.[field]);
    if (changed.length) {
      this.#emit("tabs.update", { tab: now, changed });
    }
  }

  handleEvent(event) {
    switch (event.type) {
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
    let tab = event.target;
    switch (event.type) {
      case "TabOpen":
        this.#emit("tabs.open", { tab: this.describe(tab), index: tab.index });
        break;
      case "TabClose":
        this.#lastSent.delete(tab);
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
   * change whether it can go back or forward.
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
