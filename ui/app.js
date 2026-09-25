// The demo UI: a tab list, an address bar, a bar for permission prompts and
// a downloads list, built only on the Neeko API (the global `neeko` object,
// see docs/api.md).
//
// Tabs: click to select, drag to move, ⧉ to duplicate, the speaker to mute.
// Address bar: Enter goes there, Alt+Enter opens it in a new tab next to
// this one (Shift+Alt+Enter, behind it), Escape puts the address back and
// the keys in the page.

const tabList = document.getElementById("tabs");
const address = document.getElementById("address");
const back = document.getElementById("back");
const forward = document.getElementById("forward");
const reload = document.getElementById("reload");
const promptBar = document.getElementById("prompt");
const fullscreenButton = document.getElementById("fullscreen");
const downloadList = document.querySelector("#downloads ol");

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
  // Drag a tab up or down the list to move it.
  item.draggable = true;
  let icon = document.createElement("span");
  icon.className = "icon";
  icon.append(document.createElement("img"));
  let title = document.createElement("span");
  title.className = "title";
  let buttons = [
    ["sound", "Mute tab"],
    ["duplicate", "Duplicate tab", "⧉"],
    ["close", "Close tab (Cmd+W)", "×"],
  ].map(([name, label, text = ""]) => {
    let button = document.createElement("button");
    button.className = name;
    button.title = label;
    button.textContent = text;
    return button;
  });
  item.append(icon, title, ...buttons);
  items.set(tab.id, item);
  tabList.insertBefore(item, tabList.children[index] ?? null);
  updateTab(tab);
}

function updateTab(tab) {
  tabs.set(tab.id, tab);
  let item = items.get(tab.id);
  item.querySelector(".title").textContent = tab.title || tab.url;
  // The icon is a URL (never the image itself), for as long as the tab has
  // one. Crashed tabs and error pages show a mark instead.
  let icon = item.querySelector(".icon img");
  let showIcon = tab.icon && !tab.crashed && !tab.error;
  icon.hidden = !showIcon;
  if (showIcon && icon.getAttribute("src") != tab.icon) {
    icon.src = tab.icon;
  }
  item.title = tab.error
    ? `${tab.url}\nCouldn't load it (${tab.error.code})`
    : tab.crashed
      ? `${tab.url}\nThis tab crashed. Reload to bring it back.`
      : tab.url;
  item.classList.toggle("crashed", tab.crashed);
  item.classList.toggle("failed", !!tab.error);
  let sound = item.querySelector(".sound");
  sound.hidden = !tab.audible && !tab.muted;
  sound.textContent = tab.muted ? "🔇" : "🔊";
  sound.title = tab.muted ? "Unmute tab" : "Mute tab";
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
  if (star.dataset.url != tab.url) {
    star.dataset.url = tab.url;
    showStar().catch(reportError);
  }
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

// 1234567 -> "1.2 MB"
function formatBytes(bytes) {
  let units = ["bytes", "KB", "MB", "GB"];
  let unit = 0;
  while (bytes >= 1000 && unit < units.length - 1) {
    bytes /= 1000;
    unit++;
  }
  return `${unit ? bytes.toFixed(1) : bytes} ${units[unit]}`;
}

const DOWNLOAD_STATUS = {
  paused: "Paused",
  canceled: "Canceled",
  blocked: "Blocked",
  failed: "Failed",
};

// A download's row, made or updated from its latest description.
function showDownload(download) {
  let item = downloadList.querySelector(`[data-id="${download.id}"]`);
  if (!item) {
    item = document.createElement("li");
    item.dataset.id = download.id;
    item.innerHTML =
      '<span class="name"></span><span class="buttons"></span>' +
      '<progress max="1"></progress><span class="status"></span>';
    downloadList.prepend(item);
  }
  item.className = download.state;
  let name = item.querySelector(".name");
  name.textContent = download.filename || download.url;
  name.title = download.state == "done" ? "Open" : download.url;

  let progress = item.querySelector("progress");
  progress.hidden = download.state != "downloading";
  if (download.total) {
    progress.value = download.received / download.total;
  } else {
    progress.removeAttribute("value");
  }
  let status = item.querySelector(".status");
  if (download.state == "downloading") {
    status.textContent = download.total
      ? `${formatBytes(download.received)} of ${formatBytes(download.total)}`
      : formatBytes(download.received);
  } else if (download.state == "done") {
    status.textContent = formatBytes(download.received);
  } else {
    status.textContent = DOWNLOAD_STATUS[download.state];
  }

  // What each state offers, as in Firefox's downloads panel.
  let actions = {
    downloading: [["×", "Cancel", "cancel"]],
    done: [["⌕", "Show in Finder", "show"], ["×", "Remove from list", "remove"]],
  }[download.state] ?? [["↻", "Retry", "retry"], ["×", "Remove from list", "remove"]];
  if (download.state == "blocked") {
    actions = [["×", "Remove from list", "remove"]];
  }
  let buttons = actions.map(([label, title, action]) => {
    let button = document.createElement("button");
    button.textContent = label;
    button.title = title;
    button.dataset.action = action;
    return button;
  });
  item.querySelector(".buttons").replaceChildren(...buttons);
  downloadList.parentNode.hidden = false;
}

function removeDownload(id) {
  downloadList.querySelector(`[data-id="${id}"]`)?.remove();
  downloadList.parentNode.hidden = !downloadList.children.length;
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
// Listening for "start" also tells Neeko not to open Firefox's downloads
// panel when a download starts.
neeko.downloads.on("start", ({ download }) => showDownload(download));
neeko.downloads.on("update", ({ download }) => showDownload(download));
neeko.downloads.on("remove", ({ id }) => removeDownload(id));

tabList.addEventListener("click", event => {
  let item = event.target.closest("li");
  if (!item) {
    return;
  }
  let id = Number(item.dataset.id);
  let button = event.target.closest("button")?.className;
  if (button == "close") {
    neeko.tabs.close(id);
  } else if (button == "duplicate") {
    neeko.tabs.duplicate(id);
  } else if (button == "sound") {
    neeko.tabs.setMuted(!tabs.get(id).muted, id);
  } else {
    neeko.tabs.select(id);
  }
});

// Dragging a tab onto another moves it to that one's place. The list itself
// only changes once Neeko's "move" event says the tab moved.
let dragged = null;
tabList.addEventListener("dragstart", event => {
  dragged = Number(event.target.closest("li")?.dataset.id);
  event.dataTransfer.effectAllowed = "move";
});
tabList.addEventListener("dragover", event => {
  if (dragged) {
    event.preventDefault();
  }
});
tabList.addEventListener("drop", event => {
  let target = event.target.closest("li");
  if (dragged && target) {
    event.preventDefault();
    neeko.tabs.move([...tabList.children].indexOf(target), dragged);
  }
});
tabList.addEventListener("dragend", () => (dragged = null));

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
downloadList.addEventListener("click", event => {
  let item = event.target.closest("li");
  if (!item) {
    return;
  }
  let id = Number(item.dataset.id);
  let action = event.target.closest("button")?.dataset.action;
  if (action) {
    neeko.downloads[action](id).catch(reportError);
  } else if (event.target.closest(".name") && item.classList.contains("done")) {
    neeko.downloads.open(id).catch(reportError);
  }
});

function toggleWindowFullscreen() {
  let fullscreen = document.body.classList.contains("window-fullscreen");
  neeko.fullscreen.setWindow(!fullscreen);
}
fullscreenButton.addEventListener("click", toggleWindowFullscreen);

// Bookmarks: the star in the toolbar bookmarks the page (or unbookmarks
// it), and the bookmarks toolbar's contents show in the sidebar, where
// folders open in place. Cmd+D is the star's too: listening for "request"
// tells Neeko not to open Firefox's own bookmark panel.
const star = document.getElementById("star");
const bookmarkList = document.querySelector("#bookmarks ol");
const openFolders = new Set();

async function showStar() {
  let tab = tabs.get(currentId);
  let page = tab && !BLANK_PAGES.includes(tab.url) ? tab.url : null;
  let bookmarked = page && (await neeko.bookmarks.find(page)).length > 0;
  if (tabs.get(currentId)?.url != tab?.url) {
    return;
  }
  star.disabled = !page;
  star.textContent = bookmarked ? "★" : "☆";
  star.classList.toggle("on", !!bookmarked);
  star.title = bookmarked ? "Remove bookmark" : "Bookmark this page (Cmd+D)";
}

async function toggleBookmark() {
  let tab = tabs.get(currentId);
  if (!tab || BLANK_PAGES.includes(tab.url)) {
    return;
  }
  let existing = await neeko.bookmarks.find(tab.url);
  if (existing.length) {
    await Promise.all(existing.map(b => neeko.bookmarks.remove(b.id)));
  } else {
    await neeko.bookmarks.add({ url: tab.url, title: tab.title });
  }
}

async function showBookmarks() {
  let rows = async (folderId, depth) => {
    let items = [];
    for (let bookmark of await neeko.bookmarks.list(folderId)) {
      if (bookmark.type == "separator") {
        continue;
      }
      let item = document.createElement("li");
      item.dataset.id = bookmark.id;
      item.dataset.type = bookmark.type;
      item.style.paddingInlineStart = `${10 + depth * 14}px`;
      let icon = document.createElement("span");
      icon.className = "icon";
      if (bookmark.type == "folder") {
        icon.textContent = openFolders.has(bookmark.id) ? "▾" : "▸";
      } else if (bookmark.icon) {
        let image = document.createElement("img");
        image.src = bookmark.icon;
        icon.append(image);
      }
      let title = document.createElement("span");
      title.className = "title";
      title.textContent = bookmark.title || bookmark.url;
      item.title = bookmark.url ?? bookmark.title;
      item.dataset.url = bookmark.url ?? "";
      let remove = document.createElement("button");
      remove.className = "remove";
      remove.title = "Remove";
      remove.textContent = "×";
      item.append(icon, title, remove);
      items.push(item);
      if (bookmark.type == "folder" && openFolders.has(bookmark.id)) {
        items.push(...(await rows(bookmark.id, depth + 1)));
      }
    }
    return items;
  };
  let items = await rows(neeko.bookmarks.folders.toolbar, 0);
  bookmarkList.replaceChildren(...items);
  bookmarkList.parentNode.hidden = !items.length;
}

// Any change redraws the list and the star, at most once per frame.
let bookmarksChanged = false;
function redrawBookmarks() {
  if (!bookmarksChanged) {
    bookmarksChanged = true;
    requestAnimationFrame(() => {
      bookmarksChanged = false;
      showBookmarks().catch(reportError);
      showStar().catch(reportError);
    });
  }
}
for (let type of ["add", "remove", "move", "update"]) {
  neeko.bookmarks.on(type, redrawBookmarks);
}
neeko.bookmarks.on("request", async () => {
  let tab = tabs.get(currentId);
  if (tab && !(await neeko.bookmarks.find(tab.url)).length) {
    toggleBookmark().catch(reportError);
  }
});
star.addEventListener("click", () => toggleBookmark().catch(reportError));
bookmarkList.addEventListener("click", event => {
  let item = event.target.closest("li");
  if (!item) {
    return;
  }
  if (event.target.closest(".remove")) {
    neeko.bookmarks.remove(item.dataset.id).catch(reportError);
  } else if (item.dataset.type == "folder") {
    let id = item.dataset.id;
    openFolders.has(id) ? openFolders.delete(id) : openFolders.add(id);
    showBookmarks().catch(reportError);
  } else {
    neeko.nav.go(item.dataset.url).catch(reportError);
  }
});
// Middle-click opens a bookmark in a new tab behind this one.
bookmarkList.addEventListener("auxclick", event => {
  let item = event.target.closest("li");
  if (item?.dataset.url && event.button == 1) {
    neeko.tabs.open(item.dataset.url, { background: true }).catch(reportError);
  }
});

// The ⋯ menu drops down over the web page: it's marked data-neeko-overlay,
// so Neeko draws it over the page, which stays live around it. A click in
// the page moves focus there, which closes the menu like a click elsewhere
// in the UI does.
const menuButton = document.getElementById("menu-button");
const menu = document.getElementById("menu");
const menuCommands = {
  newTab: () => neeko.tabs.open(),
  duplicate: () => neeko.tabs.duplicate(),
  mute: () => neeko.tabs.setMuted(!tabs.get(currentId)?.muted),
  moveToStart: () => neeko.tabs.move(0),
  // A setting of this UI's own, saved for every window (early.js applies it
  // at startup, and every window follows the change event below).
  tabsSide: () =>
    neeko.settings.set("tabs", tabsSide() == "right" ? "left" : "right"),
  // Web pages, Firefox's own pages and this UI (style.css) follow it.
  colorScheme: button => neeko.colorScheme.set(button.dataset.scheme),
  fullscreen: toggleWindowFullscreen,
};

const tabsSide = () => neeko.settings.get("tabs") ?? "left";

function showMenu(show) {
  menu.hidden = !show;
  menuButton.classList.toggle("open", show);
  if (show) {
    // Below the ⋯ button, lined up with its right edge.
    let button = menuButton.getBoundingClientRect();
    menu.style.top = `${button.bottom + 4}px`;
    menu.style.right = `${document.documentElement.clientWidth - button.right}px`;
    let muted = tabs.get(currentId)?.muted;
    menu.querySelector("[data-command=mute]").textContent = muted
      ? "Unmute tab"
      : "Mute tab";
    menu.querySelector("[data-command=tabsSide]").textContent =
      tabsSide() == "right" ? "Tabs on the left" : "Tabs on the right";
    for (let item of menu.querySelectorAll("[data-scheme]")) {
      item.classList.toggle(
        "checked",
        item.dataset.scheme == neeko.colorScheme.get()
      );
    }
  }
}

menuButton.addEventListener("click", () => showMenu(menu.hidden));
menu.addEventListener("click", event => {
  let button = event.target.closest("button");
  let command = button?.dataset.command;
  if (command) {
    showMenu(false);
    Promise.resolve(menuCommands[command](button)).catch(reportError);
  }
});
neeko.settings.on("change", ({ key, value }) => {
  if (key == "tabs") {
    document.documentElement.dataset.tabs = value ?? "left";
  }
});
document.addEventListener("pointerdown", event => {
  if (!menu.hidden && !event.target.closest("#menu, #menu-button")) {
    showMenu(false);
  }
});
document.addEventListener("keydown", event => {
  if (event.key == "Escape" && !menu.hidden) {
    showMenu(false);
  }
});
window.addEventListener("blur", () => showMenu(false));
back.addEventListener("click", () => neeko.nav.back());
forward.addEventListener("click", () => neeko.nav.forward());
reload.addEventListener("click", () => neeko.nav.reload());

address.addEventListener("focus", () => address.select());
address.addEventListener("input", () => (editing = true));
address.addEventListener("keydown", event => {
  if (event.key == "Enter" && address.value.trim()) {
    editing = false;
    if (event.altKey) {
      // Alt+Enter: in a new tab next to this one (with Shift, behind it).
      let index = [...tabList.children].indexOf(items.get(currentId)) + 1;
      neeko.tabs
        .open(address.value, { index, background: event.shiftKey })
        .catch(reportError);
      showToolbar();
    } else {
      neeko.nav.go(address.value).catch(reportError);
    }
  } else if (event.key == "Escape") {
    // Puts the address back, and the keys back in the page.
    editing = false;
    showToolbar();
    neeko.tabs.focus();
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
for (let download of await neeko.downloads.list()) {
  showDownload(download);
}
let fullscreen = await neeko.fullscreen.state();
document.body.classList.toggle("page-fullscreen", fullscreen.page);
document.body.classList.toggle("window-fullscreen", fullscreen.window);
showBookmarks().catch(reportError);
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
