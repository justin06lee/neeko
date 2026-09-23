// The demo UI: a tab list and an address bar, built only on the Neeko API
// (the global `neeko` object, see docs/api.md).

const tabList = document.getElementById("tabs");
const address = document.getElementById("address");
const back = document.getElementById("back");
const forward = document.getElementById("forward");
const reload = document.getElementById("reload");

// The latest description of every tab, and its list item, by tab id.
const tabs = new Map();
const items = new Map();
let currentId = null;
// True while the user is typing in the address bar, so updates don't
// overwrite it.
let editing = false;

// Pages that show as an empty address bar, as in Firefox.
const BLANK_PAGES = [
  "about:blank",
  "about:home",
  "about:newtab",
  "about:privatebrowsing",
];

function addTab(tab, index = tabList.children.length) {
  if (items.has(tab.id)) {
    updateTab(tab);
    return;
  }
  let item = document.createElement("li");
  item.dataset.id = tab.id;
  let title = document.createElement("span");
  title.className = "title";
  let close = document.createElement("button");
  close.className = "close";
  close.title = "Close tab (Cmd+W)";
  close.textContent = "×";
  item.append(title, close);
  items.set(tab.id, item);
  tabList.insertBefore(item, tabList.children[index] ?? null);
  updateTab(tab);
}

function updateTab(tab) {
  tabs.set(tab.id, tab);
  let item = items.get(tab.id);
  item.querySelector(".title").textContent = tab.title || tab.url;
  item.title = tab.url;
  item.classList.toggle("loading", tab.loading);
  if (tab.id == currentId) {
    showToolbar();
  }
}

function removeTab(id) {
  items.get(id)?.remove();
  items.delete(id);
  tabs.delete(id);
}

function moveTab(id, index) {
  let item = items.get(id);
  if (item) {
    item.remove();
    tabList.insertBefore(item, tabList.children[index] ?? null);
  }
}

function selectTab(id) {
  currentId = id;
  for (let [itemId, item] of items) {
    item.classList.toggle("selected", itemId == id);
  }
  items.get(id)?.scrollIntoView({ block: "nearest" });
  editing = false;
  showToolbar();
}

// Back, forward, reload and the address bar follow the selected tab.
function showToolbar() {
  let tab = tabs.get(currentId);
  if (!tab) {
    return;
  }
  back.disabled = !tab.canGoBack;
  forward.disabled = !tab.canGoForward;
  reload.classList.toggle("loading", tab.loading);
  if (!editing) {
    address.value = BLANK_PAGES.includes(tab.url) ? "" : tab.url;
  }
}

function focusAddressBar() {
  address.focus();
  address.select();
}

// Tabs can change without this UI asking (links, keyboard shortcuts), so it
// follows the events rather than its own clicks.
neeko.tabs.on("open", ({ tab, index }) => addTab(tab, index));
neeko.tabs.on("close", ({ id }) => removeTab(id));
neeko.tabs.on("select", ({ id }) => selectTab(id));
neeko.tabs.on("move", ({ id, index }) => moveTab(id, index));
neeko.tabs.on("update", ({ tab }) => items.has(tab.id) && updateTab(tab));
// Cmd+L, or a new tab on the New Tab page. Listening for this also tells
// Neeko not to show Firefox's own address bar.
neeko.nav.on("addressbar", focusAddressBar);

tabList.addEventListener("click", event => {
  let item = event.target.closest("li");
  if (!item) {
    return;
  }
  let id = Number(item.dataset.id);
  if (event.target.closest(".close")) {
    neeko.tabs.close(id);
  } else {
    neeko.tabs.select(id);
  }
});

// Middle-click closes a tab.
tabList.addEventListener("auxclick", event => {
  let item = event.target.closest("li");
  if (item && event.button == 1) {
    neeko.tabs.close(Number(item.dataset.id));
  }
});

document.getElementById("new-tab").addEventListener("click", () => {
  neeko.tabs.open();
});
back.addEventListener("click", () => neeko.nav.back());
forward.addEventListener("click", () => neeko.nav.forward());
reload.addEventListener("click", () => neeko.nav.reload());

address.addEventListener("focus", () => address.select());
address.addEventListener("input", () => (editing = true));
address.addEventListener("keydown", event => {
  if (event.key == "Enter" && address.value.trim()) {
    editing = false;
    neeko.nav.go(address.value).catch(reportError);
  } else if (event.key == "Escape") {
    editing = false;
    showToolbar();
    address.select();
  }
});
// Leaving the address bar without pressing Enter puts the URL back.
address.addEventListener("blur", () => {
  if (editing) {
    editing = false;
    showToolbar();
  }
});

// The listeners above are in place, so from here on the events keep this
// list up to date.
let list = await neeko.tabs.list();
tabList.replaceChildren();
items.clear();
tabs.clear();
for (let tab of list) {
  addTab(tab);
}
let current = list.find(tab => tab.selected);
selectTab(current.id);
if (BLANK_PAGES.includes(current.url)) {
  focusAddressBar();
}
