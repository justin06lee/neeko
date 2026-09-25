// Loaded into every content process by NeekoPages.init, so the app's own
// pages resolve there too: pages load in a content process, which serves
// about:<name> itself.

"use strict";

ChromeUtils.importESModule(
  "moz-src:///browser/neeko/NeekoPages.sys.mjs"
).NeekoPages.registerInChild();
