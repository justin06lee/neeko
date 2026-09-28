// The demo app's start page, built on `neekoPage`, the API of the browser's
// own pages: search or go somewhere, pick the search engine, and share a
// setting with the UI, and make this the default browser. Private windows
// show it too, with a note.

const query = document.getElementById("query");
const engineMenu = document.getElementById("engine");
const tabsRight = document.getElementById("tabs-right");

document.getElementById("private").hidden = !neekoPage.private;

// Enter goes where the user typed, in this tab, as the address bar would.
document.getElementById("search").addEventListener("submit", event => {
  event.preventDefault();
  if (query.value.trim()) {
    neekoPage.go(query.value);
  }
});

// Firefox's search engines, and which one searches.
for (let engine of await neekoPage.search.engines()) {
  engineMenu.add(new Option(engine.name, engine.id, false, engine.isDefault));
}
engineMenu.addEventListener("change", () => {
  neekoPage.search.setDefault(engineMenu.value);
});

// Whether this is the default browser, and a button to make it so. The
// system asks the user in a dialog of its own; the page checks again when
// it gets the focus back, in case that changed some other way.
const notDefault = document.getElementById("not-default");
const showDefault = async () => {
  notDefault.hidden = await neekoPage.defaultBrowser.isDefault();
};
document.getElementById("make-default").addEventListener("click", async () => {
  notDefault.hidden = await neekoPage.defaultBrowser.setDefault();
});
addEventListener("focus", showDefault);
showDefault();

// The UI's "tabs" setting (neeko.settings): the same in the UI's ⋯ menu.
let showTabs = value => (tabsRight.checked = value == "right");
showTabs(await neekoPage.settings.get("tabs"));
neekoPage.settings.on("change", ({ key, value }) => {
  if (key == "tabs") {
    showTabs(value);
  }
});
tabsRight.addEventListener("change", () => {
  neekoPage.settings.set("tabs", tabsRight.checked ? "right" : "left");
});
