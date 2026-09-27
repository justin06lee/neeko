/**
 * The browser's own pages: pages/<name>.html in the app folder, shown in
 * tabs as about:<name>. pages/start.html becomes the New Tab and home page,
 * in private windows too.
 *
 * They're web content, and locked down as such (the user's decision,
 * 2026-09-25, for Toji's start and settings pages):
 *
 * - Each has a content principal for its about: address, no privileges.
 * - They load only in Firefox's privileged about: process, never in a
 *   process with websites (URI_CAN_LOAD_IN_PRIVILEGEDABOUT_PROCESS).
 * - They aren't linkable: web pages can't open, link to or frame them.
 * - Only they get `neekoPage`, a small API of their own (NeekoPageChild),
 *   and NeekoPageParent checks on every call that the caller really is one
 *   of them, top-level, in that process.
 * - Firefox's own about: pages keep their names: a page named like one
 *   isn't served.
 *
 * This module runs in every process: pages load in a content process, which
 * resolves about:<name> itself, so the parent (init) and every content
 * process (neeko-pages-process.js, registerInChild) register the same pages.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AboutNewTab: "resource:///modules/AboutNewTab.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

const PAGES_URL = "chrome://neeko-pages/content/";
const PROCESS_SCRIPT = "chrome://neeko/content/neeko-pages-process.js";
// How the parent tells content processes which pages there are.
const SHARED_DATA_KEY = "neeko-pages";
const NAME = /^[a-z0-9-]{1,64}$/;
// The page that stands in for the New Tab page and the home page.
const START_PAGE = "start";
// What Firefox asks a new private window to show first.
const PRIVATE_PAGE = "about:privatebrowsing";

const FLAGS =
  Ci.nsIAboutModule.URI_SAFE_FOR_UNTRUSTED_CONTENT |
  Ci.nsIAboutModule.URI_MUST_LOAD_IN_CHILD |
  Ci.nsIAboutModule.URI_CAN_LOAD_IN_PRIVILEGEDABOUT_PROCESS |
  Ci.nsIAboutModule.ALLOW_SCRIPT |
  Ci.nsIAboutModule.ENABLE_INDEXED_DB |
  Ci.nsIAboutModule.HIDE_FROM_ABOUTABOUT;

const aboutContract = name => `@mozilla.org/network/protocol/about;1?what=${name}`;

class AboutPage {
  constructor(name) {
    this.url = `${PAGES_URL}${name}.html`;
  }

  QueryInterface = ChromeUtils.generateQI(["nsIAboutModule"]);

  newChannel(uri, loadInfo) {
    let channel = Services.io.newChannelFromURIWithLoadInfo(
      Services.io.newURI(this.url),
      loadInfo
    );
    channel.originalURI = uri;
    return channel;
  }

  getURIFlags() {
    return FLAGS;
  }

  getChromeURI() {
    return Services.io.newURI(this.url);
  }
}

// The pages this process serves.
let registered = [];

// Keeps a dev launch's pages folder registered at chrome://neeko-pages/ for
// the whole session: the registration goes when this handle is collected.
let pagesRegistration = null;

/**
 * Serves each page as about:<name> in this process.
 */
function register(names) {
  let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
  for (let name of names) {
    let page = new AboutPage(name);
    registrar.registerFactory(
      Components.ID(Services.uuid.generateUUID().toString()),
      `Neeko about:${name}`,
      aboutContract(name),
      {
        QueryInterface: ChromeUtils.generateQI(["nsIFactory"]),
        createInstance: iid => page.QueryInterface(iid),
      }
    );
  }
  registered = names;
}

/**
 * The page names in a folder: its <name>.html files.
 */
function pagesInFolder(dir) {
  let names = [];
  for (let file of dir.directoryEntries) {
    let match = /^([a-z0-9-]+)\.html$/.exec(file.leafName);
    if (match && file.isFile()) {
      names.push(match[1]);
    }
  }
  return names.sort();
}

/**
 * Finds the app's pages: in dev launches the folder in the neeko.pages.path
 * pref, served at chrome://neeko-pages/content/ in place of the pages the
 * build bundled; otherwise the bundled ones, named in neeko.pages.names.
 */
function findPages() {
  let path = Services.prefs.getStringPref("neeko.pages.path", "");
  if (path) {
    let dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    try {
      dir.initWithPath(path);
    } catch (e) {
      console.error(`Neeko: neeko.pages.path "${path}" is not a valid path.`);
      return [];
    }
    if (!dir.exists() || !dir.isDirectory()) {
      return [];
    }
    let aomStartup = Cc[
      "@mozilla.org/addons/addon-manager-startup;1"
    ].getService(Ci.amIAddonManagerStartup);
    pagesRegistration = aomStartup.registerChrome(
      Services.io.newURI("manifest.json", null, Services.io.newFileURI(dir)),
      [["content", "neeko-pages", "./", "contentaccessible=yes"]]
    );
    return pagesInFolder(dir);
  }
  return Services.prefs
    .getStringPref("neeko.pages.names", "")
    .split(",")
    .filter(Boolean);
}

export const NeekoPages = {
  /** The page names this process serves, as about:<name>. */
  get names() {
    return registered;
  },

  /**
   * Whether a principal is one of the app's pages: a content principal for
   * about:<name> (with or without a query or fragment).
   */
  isPagePrincipal(principal) {
    if (!principal?.isContentPrincipal || !principal.schemeIs("about")) {
      return false;
    }
    let name = principal.spec.slice("about:".length).split(/[?#]/)[0];
    return registered.includes(name);
  },

  /**
   * Called by Firefox once at startup, before the first window.
   */
  init() {
    let names = [];
    for (let name of findPages()) {
      if (!NAME.test(name)) {
        console.error(
          `Neeko: pages/${name}.html: page names are lowercase letters, digits and -.`
        );
      } else if (Cc[aboutContract(name)]) {
        // Firefox's own pages stay Firefox's: they're the fallbacks.
        console.error(
          `Neeko: about:${name} is one of Firefox's own pages, so pages/${name}.html isn't served. Name it something else.`
        );
      } else {
        names.push(name);
      }
    }
    if (!names.length) {
      return;
    }
    register(names);
    Services.ppmm.sharedData.set(SHARED_DATA_KEY, names);
    Services.ppmm.sharedData.flush();
    Services.ppmm.loadProcessScript(PROCESS_SCRIPT, true);

    let matches = names.flatMap(name => [
      `about:${name}`,
      `about:${name}?*`,
      `about:${name}#*`,
    ]);
    ChromeUtils.registerWindowActor("NeekoPage", {
      parent: { esModuleURI: "moz-src:///browser/neeko/NeekoPageParent.sys.mjs" },
      child: {
        esModuleURI: "moz-src:///browser/neeko/NeekoPageChild.sys.mjs",
        events: { DOMDocElementInserted: { capture: true } },
      },
      matches,
      remoteTypes: ["privilegedabout"],
    });

    if (names.includes(START_PAGE)) {
      // The New Tab page (Cmd+T, new windows), and the home page unless the
      // user or the browser chose another. Private windows' new tabs follow
      // it too, since it's no longer Firefox's own (BROWSER_NEW_TAB_URL).
      lazy.AboutNewTab.newTabURL = `about:${START_PAGE}`;
      Services.prefs
        .getDefaultBranch("")
        .setStringPref("browser.startup.homepage", `about:${START_PAGE}`);
    }
  },

  /**
   * Called by Firefox for each browser window, before its first layout. A
   * new private window's first tab shows the start page too, instead of
   * Firefox's about:privatebrowsing, which Firefox names as the window's
   * page to load (BrowserWindowTracker.openWindow, the -private-window
   * flag). Firefox has usually read that already, for the bookmarks
   * toolbar (gBrowserInit.uriToLoadPromise, a getter that keeps its
   * value), but loads nothing until later.
   *
   * @param {Window} win
   */
  initWindow(win) {
    if (
      !registered.includes(START_PAGE) ||
      !lazy.PrivateBrowsingUtils.isWindowPrivate(win)
    ) {
      return;
    }
    let start = `about:${START_PAGE}`;
    let init = win.gBrowserInit;
    let read = Object.getOwnPropertyDescriptor(init, "uriToLoadPromise");
    if (read && !read.get) {
      if (read.value == PRIVATE_PAGE) {
        init.uriToLoadPromise = start;
      }
      return;
    }
    let page = win.arguments?.[0];
    if (page instanceof Ci.nsISupportsString && page.data == PRIVATE_PAGE) {
      page.data = start;
    } else if (page == PRIVATE_PAGE) {
      win.arguments[0] = start;
    }
  },

  /**
   * Called in each content process by neeko-pages-process.js.
   */
  registerInChild() {
    if (registered.length) {
      return;
    }
    let names = Services.cpmm.sharedData.get(SHARED_DATA_KEY);
    if (names?.length) {
      register(names);
    }
  },
};
