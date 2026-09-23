// Neeko's default prefs. Firefox reads every file in defaults/preferences at
// startup, before any window opens. Its privacy defaults are in
// firefox-neeko-privacy.js.
//
// The name matters. Firefox reads those files in reverse alphabetical order
// and the last one read wins, so Neeko's files are named "firefox-neeko*.js":
// read after Firefox's own firefox.js (Neeko's values win) and before
// firefox-branding.js (a browser built on Neeko can override them there).

// Folder holding the custom UI (its index.html). Empty means there is no
// custom UI, so Firefox's own UI stays visible. `make run` points this at ui/.
pref("neeko.ui.path", "");

// Artifact builds use Mozilla's prebuilt core, which looks for helper apps
// named "Firefox GPU Helper" and "Firefox Media Plugin Helper". Our build names
// them after its own brand, so run those processes in plugin-container instead.
pref("layers.gpu-process-executable.enabled", false);
pref("media.plugin_helper_process.enabled", false);
