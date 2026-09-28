// The demo app's start page, built on `neekoPage`, the API of the browser's
// own pages: search or go somewhere, pick the search engine, and share a
// setting with the UI, import from other browsers, and make this the
// default browser. Private windows show it too, with a note.

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

// Importing from another browser on this computer, or from a file, with
// Firefox's importers. Browsers that aren't here are listed as such.
const importFrom = document.getElementById("import-from");
const importBrowser = document.getElementById("import-browser");
const importResult = document.getElementById("import-result");
const showResult = text => {
  importResult.textContent = text;
  importResult.hidden = false;
};
const REASONS = {
  permission: "needs your permission to read it",
  keychain: "the keychain didn't allow it",
  none: "there were none",
  failed: "they couldn't be read",
};
const describe = result =>
  Object.entries(result)
    .map(([type, { count, error }]) =>
      error ? `${type}: ${REASONS[error] ?? error}` : count === null ? `${type}: done` : `${count} ${type}`
    )
    .join(", ");
let browsers = [];
const showBrowsers = async () => {
  browsers = await neekoPage.import.browsers();
  importFrom.replaceChildren();
  for (let browser of browsers.filter(b => b.available && b.profiles.length)) {
    importFrom.add(new Option(browser.name, browser.id));
  }
  let missing = browsers.filter(b => !b.available).map(b => b.name);
  importFrom.title = missing.length ? `Not on this computer: ${missing.join(", ")}` : "";
  importBrowser.disabled = !importFrom.options.length;
};
// Every profile of the browser, from the one click.
importBrowser.addEventListener("click", async () => {
  let browser = browsers.find(b => b.id == importFrom.value);
  let id = browser.id;
  // Safari's data needs the user's say-so first: a folder picker at it.
  if (browser.needsPermission && !(await neekoPage.import.requestPermission(id))) {
    showResult(`${browser.name}: ${REASONS.permission}.`);
    return;
  }
  showResult(`Importing from ${browser.name}…`);
  let result = await neekoPage.import.fromBrowser(id, {
    profiles: browser.profiles.map(p => p.id),
  });
  let several = browser.profiles.length > 1;
  showResult(
    `${browser.name}: ` +
      browser.profiles
        .map(p => `${several ? `${p.name}: ` : ""}${describe(result[p.id]) || "nothing to import"}`)
        .join("; ") +
      "."
  );
});
for (let kind of ["bookmarks", "passwords"]) {
  document.getElementById(`import-${kind}`).addEventListener("click", async () => {
    let result = await neekoPage.import.fromFile(kind);
    if (!result.canceled) {
      showResult(result.error ? `The file: ${REASONS[result.error]}.` : `${result.count} ${kind} imported.`);
    }
  });
}
showBrowsers();

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
