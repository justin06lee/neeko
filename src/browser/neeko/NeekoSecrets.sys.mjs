/**
 * Secrets: values an app keeps for its user by name, an API key say, in
 * the system's keychain: macOS's Keychain, or a Secret Service keyring on
 * Linux (GNOME Keyring, KWallet). Never in a file of the browser's, and
 * nowhere else if there's no keychain.
 *
 * The UI and the app's pages can store one, delete it and ask whether there
 * is one, never read it. Neeko reads a secret only here, in the parent
 * process, for a helper request that names it (NeekoHelpers), which carries
 * it to the app's helper in a header. docs/api.md ("Secrets") documents
 * them.
 *
 * Each profile has its own. A keychain call can wait for the user (macOS
 * may ask whether the browser may use an item, a Linux keyring to create a
 * wallet or be unlocked), so they run on a thread of their own
 * (NeekoSecrets.worker.js), started on the first call, and one that takes
 * a while says so: the app can tell the user to look for the system's
 * dialog.
 */

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BasePromiseWorker: "resource://gre/modules/PromiseWorker.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

// A secret's name, as a helper's: it ends up in a header's name.
const NAME = /^[a-z][a-z0-9-]{0,31}$/;
// Its value, which a header carries: printable ASCII, no space at either end.
const VALUE = /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/;
const MAX_VALUE = 8192;
// How long a keychain call may take before it's waiting on the user, as
// far as anyone can tell.
const SLOW = 1000;
// For tests only: a keychain file to use instead of the user's (macOS), and
// a delay before every keychain call.
const KEYCHAIN_PREF = "neeko.secrets.keychain";
const DELAY_PREF = "neeko.secrets.delay";

const watchers = new Set();
const waitWatchers = new Set();
let worker = null;
// Keychain calls under way, and whether they've been waiting a while.
let pending = 0;
let slowTimer = null;
let waiting = false;

function checkName(name) {
  if (typeof name != "string" || !NAME.test(name)) {
    throw new TypeError(
      "A secret's name is lowercase letters, digits and dashes, starting with a letter (at most 32)."
    );
  }
  return name;
}

/**
 * How the keychain knows a secret: the app's (browser.json's name, which
 * dev builds' Services.appinfo.name isn't), this profile's, by name.
 */
function item(name) {
  checkName(name);
  if (!["macosx", "linux"].includes(AppConstants.platform)) {
    throw new Error("Secrets need macOS's Keychain or a Linux keyring.");
  }
  let app = AppConstants.MOZ_APP_BASENAME;
  return {
    platform: AppConstants.platform,
    app,
    profile: PathUtils.filename(PathUtils.profileDir),
    name,
    label: `${app}: ${name}`,
    keychain: Services.prefs.getStringPref(KEYCHAIN_PREF, "") || null,
  };
}

function setWaiting(value) {
  if (value == waiting) {
    return;
  }
  waiting = value;
  for (let watcher of waitWatchers) {
    try {
      watcher(value);
    } catch (e) {
      console.error(e);
    }
  }
}

async function keychain(method, ...args) {
  worker ??= new lazy.BasePromiseWorker("moz-src:///browser/neeko/NeekoSecrets.worker.js");
  pending++;
  slowTimer ??= lazy.setTimeout(() => {
    slowTimer = null;
    setWaiting(true);
  }, SLOW);
  try {
    let delay = Services.prefs.getIntPref(DELAY_PREF, 0);
    if (delay) {
      await new Promise(resolve => lazy.setTimeout(resolve, delay));
    }
    return await worker.post(method, args);
  } catch (e) {
    throw new Error(e.message || "The keychain didn't do it.");
  } finally {
    if (!--pending) {
      lazy.clearTimeout(slowTimer);
      slowTimer = null;
      setWaiting(false);
    }
  }
}

function changed(name, present) {
  for (let watcher of watchers) {
    try {
      watcher(name, present);
    } catch (e) {
      console.error(e);
    }
  }
}

export const NeekoSecrets = {
  /** Whether this profile has a secret of that name. */
  async has(name) {
    return keychain("has", item(name));
  },

  /** Keeps a secret, in place of one of the same name. */
  async set(name, value) {
    let where = item(name);
    if (typeof value != "string" || value.length > MAX_VALUE || !VALUE.test(value)) {
      throw new TypeError(
        `A secret's value is printable ASCII text with no space at either end, at most ${MAX_VALUE} characters.`
      );
    }
    await keychain("set", where, value);
    changed(name, true);
  },

  /** Deletes a secret, if there is one. */
  async delete(name) {
    if (await keychain("delete", item(name))) {
      changed(name, false);
    }
  },

  /**
   * Calls callback(name, present) when a secret is kept or deleted, from any
   * window or page. Returns a function that stops it.
   */
  watch(callback) {
    watchers.add(callback);
    return () => watchers.delete(callback);
  },

  /**
   * Calls callback(true) when keychain calls have been waiting a while (the
   * system is most likely asking the user something), and callback(false)
   * when they're done. Returns a function that stops it.
   */
  watchWaiting(callback) {
    waitWatchers.add(callback);
    return () => waitWatchers.delete(callback);
  },
};

/**
 * A secret's value, or null if this profile has none. Only for a helper
 * request (NeekoHelpers): nothing hands one to the UI or a page.
 */
export async function readSecret(name) {
  return keychain("read", item(name));
}
