// Runs before the UI's first paint: a plain script in <head>, where `neeko`
// is already there with its settings, so the saved layout is right from the
// start instead of flashing. (app.js is a module, which runs later.)
document.documentElement.dataset.platform = neeko.platform;
document.documentElement.dataset.tabs = neeko.settings.get("tabs") ?? "left";
document.documentElement.toggleAttribute(
  "data-hide-tabs",
  !!neeko.settings.get("hideTabs")
);
