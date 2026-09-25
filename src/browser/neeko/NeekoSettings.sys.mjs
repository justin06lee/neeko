/**
 * What the UI keeps for itself, the same in every window: its settings (a
 * theme, a layout...) and the color scheme it asks of everything else. Both
 * live in prefs, so they're saved in the profile, known at once when a
 * window's UI starts, and a browser can ship defaults in its prefs.js.
 *
 * - Settings are `neeko.settings.<key>` prefs, one per key, holding strings,
 *   true/false or whole numbers as prefs of that type.
 * - The color scheme is Firefox's `ui.systemUsesDarkTheme` override: set, it
 *   stands in for the system's light or dark setting everywhere (web pages,
 *   Firefox's own pages and panels, the UI's prefers-color-scheme); cleared,
 *   the system's own setting applies.
 */

const PREFIX = "neeko.settings.";
const KEY = /^[A-Za-z0-9_-]{1,64}$/;
// Past a few kilobytes, Firefox warns about slow prefs.
const MAX_STRING = 4096;
const COLOR_SCHEME_PREF = "ui.systemUsesDarkTheme";
const COLOR_SCHEMES = ["light", "dark", "system"];

function checkKey(key) {
  if (typeof key != "string" || !KEY.test(key)) {
    throw new TypeError(
      "Setting names are 1 to 64 letters, digits, - or _."
    );
  }
  return PREFIX + key;
}

/**
 * A setting's value, from whichever pref type it is; null if unset.
 */
function read(pref) {
  switch (Services.prefs.getPrefType(pref)) {
    case Ci.nsIPrefBranch.PREF_STRING:
      return Services.prefs.getStringPref(pref);
    case Ci.nsIPrefBranch.PREF_INT:
      return Services.prefs.getIntPref(pref);
    case Ci.nsIPrefBranch.PREF_BOOL:
      return Services.prefs.getBoolPref(pref);
    default:
      return null;
  }
}

export const NeekoSettings = {
  /** Every setting, as { key: value }. */
  all() {
    let settings = {};
    for (let pref of Services.prefs.getChildList(PREFIX)) {
      let value = read(pref);
      if (value !== null) {
        settings[pref.slice(PREFIX.length)] = value;
      }
    }
    return settings;
  },

  /**
   * Saves a setting. null removes it, back to the browser's default if its
   * prefs.js has one.
   */
  set(key, value) {
    let pref = checkKey(key);
    if (value === null) {
      Services.prefs.clearUserPref(pref);
      return;
    }
    let setter;
    if (typeof value == "string") {
      if (value.length > MAX_STRING) {
        throw new RangeError(
          `Setting values are at most ${MAX_STRING} characters long.`
        );
      }
      setter = "setStringPref";
    } else if (typeof value == "boolean") {
      setter = "setBoolPref";
    } else if (
      Number.isInteger(value) &&
      value >= -(2 ** 31) &&
      value < 2 ** 31
    ) {
      setter = "setIntPref";
    } else {
      throw new TypeError(
        "Setting values are strings, true or false, whole numbers or null."
      );
    }
    // A value of another type replaces the old one, unless the browser's
    // default is of the old type: Firefox keeps a pref's type.
    let type = Services.prefs.getPrefType(pref);
    let kind = {
      setStringPref: Ci.nsIPrefBranch.PREF_STRING,
      setBoolPref: Ci.nsIPrefBranch.PREF_BOOL,
      setIntPref: Ci.nsIPrefBranch.PREF_INT,
    }[setter];
    if (type != Ci.nsIPrefBranch.PREF_INVALID && type != kind) {
      Services.prefs.clearUserPref(pref);
      if (Services.prefs.getPrefType(pref) != Ci.nsIPrefBranch.PREF_INVALID) {
        throw new TypeError(
          `The browser's default for "${key}" is of another type.`
        );
      }
    }
    Services.prefs[setter](pref, value);
  },

  /**
   * Calls listener(key, value) whenever a setting changes, from any window
   * (or about:config). Returns a function that stops it.
   */
  watch(listener) {
    let observer = (subject, topic, pref) =>
      listener(pref.slice(PREFIX.length), read(pref));
    Services.prefs.addObserver(PREFIX, observer);
    return () => Services.prefs.removeObserver(PREFIX, observer);
  },

  /** "light", "dark", or "system" if the system's setting applies. */
  colorScheme() {
    if (
      Services.prefs.getPrefType(COLOR_SCHEME_PREF) !=
      Ci.nsIPrefBranch.PREF_INT
    ) {
      return "system";
    }
    return Services.prefs.getIntPref(COLOR_SCHEME_PREF) ? "dark" : "light";
  },

  setColorScheme(scheme) {
    if (!COLOR_SCHEMES.includes(scheme)) {
      throw new TypeError('Expected "light", "dark" or "system".');
    }
    if (scheme == "system") {
      Services.prefs.clearUserPref(COLOR_SCHEME_PREF);
    } else {
      Services.prefs.setIntPref(COLOR_SCHEME_PREF, scheme == "dark" ? 1 : 0);
    }
  },

  /**
   * Calls listener(scheme) whenever the color scheme changes. Returns a
   * function that stops it.
   */
  watchColorScheme(listener) {
    let observer = () => listener(this.colorScheme());
    Services.prefs.addObserver(COLOR_SCHEME_PREF, observer);
    return () => Services.prefs.removeObserver(COLOR_SCHEME_PREF, observer);
  },
};
