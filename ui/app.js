// The demo UI: a tab list, an address bar and a bar for permission prompts,
// built only on the Neeko API (the global `neeko` object, see docs/api.md).

const tabList = document.getElementById("tabs");
const address = document.getElementById("address");
const back = document.getElementById("back");
const forward = document.getElementById("forward");
const reload = document.getElementById("reload");
const promptBar = document.getElementById("prompt");
const fullscreenButton = document.getElementById("fullscreen");

// The latest description of every tab, and its list item, by tab id.
const tabs = new Map();
const items = new Map();
let currentId = null;
// True while the user is typing in the address bar, so updates don't
// overwrite it.
let editing = false;
// Permission prompts waiting for an answer, by id, in every tab.
const prompts = new Map();
// How long a prompt's buttons wait before they work, like Firefox's: a page
// can't make a prompt appear just as someone clicks where "Allow" will be.
// (Neeko refuses earlier answers anyway.)
const PROMPT_DELAY = 500;

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
  item.classList.toggle(
    "asking",
    [...prompts.values()].some(prompt => prompt.tabId == tab.id)
  );
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
  // Neeko restarts a prompt's delay when its tab is selected again.
  delete promptBar.dataset.id;
  showPrompt();
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

// The selected tab's oldest waiting prompt, above its page.
function showPrompt() {
  let prompt = [...prompts.values()].find(p => p.tabId == currentId);
  promptBar.hidden = !prompt;
  if (!prompt || promptBar.dataset.id == prompt.id) {
    return;
  }
  promptBar.dataset.id = prompt.id;
  promptBar.querySelector(".message").textContent = prompt.message;
  promptBar.querySelector(".hint").textContent = prompt.hint;
  promptBar.querySelector(".learn-more").hidden = !prompt.learnMoreURL;
  let remember = promptBar.querySelector(".remember");
  remember.hidden = !prompt.remember;
  remember.querySelector("input").checked = !!prompt.remember?.checked;
  remember.querySelector("span").textContent = prompt.remember?.label ?? "";
  let buttons = prompt.actions.map((action, index) => {
    let button = document.createElement("button");
    button.textContent = action.label;
    button.disabled = true;
    button.addEventListener("click", () => {
      let checked = remember.querySelector("input").checked;
      neeko.prompts
        .answer(prompt.id, index, { remember: checked })
        .catch(reportError);
    });
    return button;
  });
  promptBar.querySelector(".actions").replaceChildren(...buttons);
  setTimeout(() => buttons.forEach(b => (b.disabled = false)), PROMPT_DELAY);
}

promptBar.querySelector(".learn-more").addEventListener("click", () => {
  let prompt = prompts.get(Number(promptBar.dataset.id));
  if (prompt?.learnMoreURL) {
    neeko.tabs.open(prompt.learnMoreURL);
  }
});

function promptsChanged(tabId) {
  let tab = tabs.get(tabId);
  if (tab) {
    updateTab(tab);
  }
  if (tabId == currentId) {
    delete promptBar.dataset.id;
    showPrompt();
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
// Listening for prompts also tells Neeko not to show Firefox's own.
neeko.prompts.on("open", ({ prompt }) => {
  prompts.set(prompt.id, prompt);
  promptsChanged(prompt.tabId);
});
neeko.prompts.on("close", ({ id }) => {
  let prompt = prompts.get(id);
  prompts.delete(id);
  if (prompt) {
    promptsChanged(prompt.tabId);
  }
});
// Listening for "page" also tells Neeko this UI lays out page fullscreen
// itself (style.css: it steps aside and the page fills the window).
neeko.fullscreen.on("page", ({ fullscreen }) =>
  document.body.classList.toggle("page-fullscreen", fullscreen)
);
neeko.fullscreen.on("window", ({ fullscreen }) =>
  document.body.classList.toggle("window-fullscreen", fullscreen)
);

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
fullscreenButton.addEventListener("click", () => {
  let fullscreen = document.body.classList.contains("window-fullscreen");
  neeko.fullscreen.setWindow(!fullscreen);
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

// The listeners above are in place, so from here on the events keep these
// lists up to date.
for (let prompt of await neeko.prompts.list()) {
  prompts.set(prompt.id, prompt);
}
let fullscreen = await neeko.fullscreen.state();
document.body.classList.toggle("page-fullscreen", fullscreen.page);
document.body.classList.toggle("window-fullscreen", fullscreen.window);
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
