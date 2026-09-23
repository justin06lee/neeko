/**
 * Where Firefox's own panels appear in a window with a custom UI.
 *
 * Firefox hangs its panels from icons in its toolbars: permission prompts
 * (camera, microphone, location, notifications), password saving and add-on
 * installs from the address bar, the downloads panel from its button,
 * notices like "add-on added" from the menu button. Neeko hides those
 * toolbars, so Firefox would open these panels in the window's top-left
 * corner, or (the downloads panel) not at all. Instead they hang from the top
 * edge of the web page: the address bar's panels at its left end and the
 * toolbar buttons' at its right end, as in Firefox.
 *
 * This is the fallback for UIs that don't show these things themselves. A
 * UI that listens for the API's "prompts.open" shows permission prompts
 * itself: this module tells it about them, keeps Firefox's panel closed
 * meanwhile, and carries out the UI's answers. One that listens for
 * "downloads.start" shows new downloads itself, so Firefox's downloads panel
 * doesn't open for them.
 */

const HTML_NS = "http://www.w3.org/1999/xhtml";

// The permission prompts a UI can show itself, by Firefox's notification id,
// and the kind the API calls them. Each is a message, a few buttons and maybe
// a "remember" checkbox. The rest need Firefox's own panel: camera,
// microphone and screen sharing pick a device in it, and password saving and
// add-on installs show forms and lists.
const PROMPT_KINDS = new Map([
  ["geolocation", "location"],
  ["web-notifications", "notifications"],
  ["persistent-storage", "persistent-storage"],
  ["storage-access", "storage-access"],
  ["xr", "vr"],
  ["midi", "midi"],
  ["local-network", "local-network"],
  ["loopback-network", "localhost"],
]);

// Each window's permission prompts, by id, and how to reach its UI's API.
const windows = new WeakMap();
let nextPromptId = 1;

// An invisible line along the top of the web page, a little inside it, for
// the panels to hang from. neeko.css keeps it there, wherever the UI puts
// the page, and across the screen in fullscreen.
const ANCHOR_ID = "neeko-panel-anchor";

/**
 * Whether a panel's own anchor is one of the toolbar buttons after the
 * address bar (the menu, extensions), whose panels Firefox lines up on the
 * right. Everything else lines up on the left, like the address bar's.
 */
function isToolbarButton(doc, anchor) {
  let addressBar = doc.getElementById("urlbar-container");
  if (
    !anchor?.closest("#nav-bar") ||
    !addressBar ||
    addressBar.contains(anchor)
  ) {
    return false;
  }
  let position = addressBar.compareDocumentPosition(anchor);
  return !!(position & anchor.DOCUMENT_POSITION_FOLLOWING);
}

/**
 * Runs just before one of Firefox's panels appears. If the anchor Firefox
 * picked is hidden along with its toolbar, the panel hangs from the page
 * instead. Permission prompts find no visible anchor at all and open with
 * none, so they move too.
 */
function onPopupShowing(doc, event) {
  let panel = event.target;
  if (panel.localName != "panel") {
    return;
  }
  let anchor = panel.anchorNode;
  let hidden = anchor
    ? !anchor.checkVisibility()
    : panel.id == "notification-popup";
  if (hidden) {
    panel.moveToAnchor(
      doc.getElementById(ANCHOR_ID),
      isToolbarButton(doc, anchor) ? "after_end" : "after_start"
    );
  }
}

/**
 * Calls back with one of the browser window's globals once Firefox creates
 * it, without creating it any earlier. Many are lazy: a getter that runs the
 * object's script on first use, and the script's assignment replaces the
 * getter with the object (XPCOMUtils.defineLazyScriptGetter).
 */
function whenCreated(win, name, callback) {
  let lazy = Object.getOwnPropertyDescriptor(win, name);
  if (!lazy?.get) {
    if (lazy?.value) {
      callback(lazy.value);
    }
    return;
  }
  let done = false;
  let created = value => {
    if (value && !done) {
      done = true;
      callback(value);
    }
  };
  Object.defineProperty(win, name, {
    configurable: true,
    enumerable: lazy.enumerable,
    get() {
      let value = lazy.get.call(win);
      created(value);
      return value;
    },
    set(value) {
      Object.defineProperty(win, name, {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      });
      created(value);
    },
  });
}

/**
 * The downloads panel doesn't even open while its toolbar button is hidden:
 * DownloadsButton.getAnchor() finds nowhere to put it. Given the page's
 * anchor instead, it opens when a download starts, lined up on the right as
 * under its button.
 */
function anchorDownloadsPanel(win) {
  whenCreated(win, "DownloadsButton", button => {
    let getAnchor = button.getAnchor;
    button.getAnchor = function () {
      return getAnchor.call(this) ?? win.document.getElementById(ANCHOR_ID);
    };
  });
}

/**
 * Firefox opens its downloads panel by itself when a download starts
 * (DownloadsCommon.sys.mjs calls showPanel() with no arguments). While the
 * UI shows downloads itself, it doesn't. Opening it on purpose still works.
 */
function watchDownloadsPanel(win, state) {
  whenCreated(win, "DownloadsPanel", panel => {
    let showPanel = panel.showPanel;
    panel.showPanel = function (openedManually = false, ...rest) {
      let api = state.getAPI();
      if (!openedManually && api?.listening.has("downloads.start")) {
        return;
      }
      showPanel.call(this, openedManually, ...rest);
    };
  });
}

/**
 * Where a URI comes from, as Firefox's prompts show it: host and port, or a
 * file's path.
 */
function originOf(uri) {
  if (!uri) {
    return "";
  }
  if (uri instanceof Ci.nsIFileURL) {
    return uri.pathQueryRef;
  }
  try {
    return uri.hostPort;
  } catch (e) {
    return uri.spec;
  }
}

/**
 * Whether the window's UI shows permission prompts itself.
 */
function uiShowsPrompts(state) {
  return !!state.getAPI()?.listening.has("prompts.open");
}

/**
 * Tells the UI about a new permission prompt.
 */
function promptOpened(state, prompt) {
  prompt.readyAt = ChromeUtils.now();
  state.prompts.set(prompt.id, prompt);
  state.getAPI()?.promptOpened(describePrompt(prompt));
}

/**
 * Tells the UI a permission prompt is gone: answered, or removed by Firefox
 * (the page went away, the request was withdrawn).
 */
function promptClosed(state, prompt) {
  if (state.prompts.delete(prompt.id)) {
    state.getAPI()?.promptClosed(prompt.id);
  }
}

/**
 * Watches Firefox's PopupNotifications.show() for the permission prompts in
 * PROMPT_KINDS. While the UI shows prompts itself, they're added with
 * `neverShow`, which keeps Firefox's panel closed. (`dismissed` wouldn't:
 * permission prompts are "persistent", which shows them anyway.)
 */
function watchPrompts(win, state) {
  whenCreated(win, "PopupNotifications", popups => {
    state.popups = popups;
    let show = popups.show;
    popups.show = function (
      browser,
      id,
      message,
      anchorID,
      mainAction,
      secondaryActions,
      options
    ) {
      let kind = PROMPT_KINDS.get(id);
      // Prompts added dismissed only show Firefox's icon: requests Firefox
      // already turned down (notifications asked for without a click, say).
      if (!kind || !options || options.dismissed) {
        return show.apply(this, arguments);
      }
      let prompt = {
        id: nextPromptId++,
        kind,
        notification: null,
        neverShow: !!options.neverShow,
        readyAt: 0,
      };
      let eventCallback = options.eventCallback;
      options.eventCallback = function (topic, ...args) {
        if (topic == "removed") {
          promptClosed(state, prompt);
        }
        return eventCallback?.call(this, topic, ...args);
      };
      options.neverShow = prompt.neverShow || uiShowsPrompts(state);
      prompt.notification = show.apply(this, arguments);
      promptOpened(state, prompt);
      return prompt.notification;
    };
  });

  let onTabEvent = event => {
    let browser = event.target.linkedBrowser;
    for (let prompt of state.prompts.values()) {
      if (prompt.notification.browser != browser) {
        continue;
      }
      if (event.type == "TabClose") {
        promptClosed(state, prompt);
      } else {
        // A prompt the UI shows again gets the delay again.
        prompt.readyAt = ChromeUtils.now();
      }
    }
  };
  // gBrowser appears at the window's DOMContentLoaded.
  let watchTabs = () => {
    if (!win.gBrowser) {
      return false;
    }
    for (let type of ["TabClose", "TabSelect"]) {
      win.gBrowser.tabContainer.addEventListener(type, onTabEvent);
    }
    return true;
  };
  if (!watchTabs()) {
    win.addEventListener("DOMContentLoaded", function onLoaded() {
      if (watchTabs()) {
        win.removeEventListener("DOMContentLoaded", onLoaded);
      }
    });
  }
  win.addEventListener("activate", () => {
    for (let prompt of state.prompts.values()) {
      prompt.readyAt = ChromeUtils.now();
    }
  });
}

/**
 * A permission prompt as the API describes it, in plain data, except for the
 * browser it's for, which NeekoAPI turns into a tab id.
 */
function describePrompt(prompt) {
  let { browser, message, mainAction, secondaryActions, options } =
    prompt.notification;
  let checkbox = options.checkbox;
  return {
    id: prompt.id,
    browser,
    kind: prompt.kind,
    // Some prompts name the site only in their message.
    origin: originOf(options.displayURI) || options.name || "",
    message: message
      .replace("<>", options.name ?? "")
      .replace("{}", options.secondName ?? ""),
    hint: options.hintText ?? "",
    learnMoreURL: options.learnMoreURL ?? null,
    actions: [mainAction, ...(secondaryActions ?? [])]
      .filter(Boolean)
      .map(action => ({ label: action.label })),
    remember: checkbox?.show
      ? { label: checkbox.label ?? "", checked: !!checkbox.checked }
      : null,
  };
}

export const NeekoPanels = {
  /**
   * Called by NeekoWindow for each browser window that shows a custom UI.
   *
   * @param {Window} win
   * @param {Function} getAPI Returns the NeekoAPI of the window's UI page, if
   *   it has one.
   */
  init(win, getAPI) {
    let doc = win.document;
    let anchor = doc.createElementNS(HTML_NS, "div");
    anchor.id = ANCHOR_ID;
    // After the page area, which CSS anchor positioning requires.
    doc.body.append(anchor);
    doc.addEventListener("popupshowing", event => onPopupShowing(doc, event), {
      capture: true,
    });
    anchorDownloadsPanel(win);

    let state = { prompts: new Map(), getAPI, popups: null };
    windows.set(win, state);
    watchPrompts(win, state);
    watchDownloadsPanel(win, state);
  },

  /**
   * The window's permission prompts, oldest first, described as the API
   * describes them (with the browser instead of a tab id).
   */
  prompts(win) {
    return [...(windows.get(win)?.prompts.values() ?? [])].map(describePrompt);
  },

  /**
   * Hands the window's permission prompts to its UI, or back to Firefox's
   * own panel when the UI stops listening or goes away.
   */
  setUIShowsPrompts(win, shows) {
    let state = windows.get(win);
    if (!state?.popups) {
      return;
    }
    for (let prompt of state.prompts.values()) {
      prompt.notification.options.neverShow = shows || prompt.neverShow;
      prompt.readyAt = ChromeUtils.now();
    }
    // Firefox re-checks which prompts to show (and hides its panel if none).
    state.popups.anchorVisibilityChange();
  },

  /**
   * Answers a permission prompt with one of its actions, as a click on
   * Firefox's own button would. Actions that grant something wait out
   * Firefox's delay against clickjacking, as its buttons do: a page can't
   * make a prompt appear just as someone clicks where its "Allow" will be.
   *
   * @param {Window} win
   * @param {number} id
   * @param {number} index Which of the prompt's actions.
   * @param {boolean} remember Whether to check its "remember" checkbox.
   */
  answerPrompt(win, id, index, remember) {
    let state = windows.get(win);
    let prompt = state?.prompts.get(id);
    if (!prompt) {
      throw new Error(`No prompt with id ${id} in this window.`);
    }
    let notification = prompt.notification;
    let actions = [
      notification.mainAction,
      ...(notification.secondaryActions ?? []),
    ].filter(Boolean);
    let action = actions[index];
    if (!action) {
      throw new RangeError(`Prompt ${id} has no action ${index}.`);
    }
    if (!action.disableSecurityDelay) {
      if (Services.focus.activeWindow != win) {
        throw new Error("Can't allow that while the window isn't active.");
      }
      let delay = Services.prefs.getIntPref(
        "security.notification_enable_delay",
        500
      );
      let wait = Math.ceil(prompt.readyAt + delay - ChromeUtils.now());
      if (wait > 0) {
        throw new Error(
          `Too soon: this prompt's actions work ${delay}ms after it ` +
            `appears (${wait}ms to go), against clickjacking.`
        );
      }
    }
    try {
      action.callback.call(undefined, {
        checkboxChecked: remember && !!notification.options.checkbox?.show,
        source: "neeko",
      });
    } catch (e) {
      console.error(e);
    }
    if (action.dismiss) {
      // Firefox keeps it, dismissed; the UI is done with it.
      notification.dismissed = true;
      promptClosed(state, prompt);
    } else {
      notification.remove();
    }
  },
};
