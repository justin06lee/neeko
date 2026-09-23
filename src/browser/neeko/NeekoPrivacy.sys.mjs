/**
 * Privacy behavior that prefs alone can't express. The privacy defaults
 * themselves are in firefox-neeko-privacy.js; docs/privacy/decisions.md has
 * the reasons.
 */

const DRM_PREF = "media.eme.enabled";
const PLUGIN_UPDATES_PREF = "media.gmp-manager.updateEnabled";

export const NeekoPrivacy = {
  /**
   * Called by Firefox once at startup, before the first window.
   */
  init() {
    // Codec and DRM plugins (#37): nothing at startup. Plugin updates are off
    // by default, so Firefox doesn't ask aus5.mozilla.org for its plugin list
    // every day. Once DRM is on (the user said yes to Firefox's "enable DRM"
    // prompt), they come on, so Widevine installs and stays up to date.
    // Firefox waits 10 seconds after that yes before it checks, and this runs
    // right away. It only ever turns updates on, so a browser built on Neeko
    // can still default them to on.
    let followDRM = () => {
      if (Services.prefs.getBoolPref(DRM_PREF, false)) {
        Services.prefs
          .getDefaultBranch("")
          .setBoolPref(PLUGIN_UPDATES_PREF, true);
      }
    };
    followDRM();
    Services.prefs.addObserver(DRM_PREF, followDRM);
  },
};
