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
  // The demo app's own start page (pages/start.html).
  "about:start",
];

// The tab rows, in order, without the group headers between them.
const tabRows = () => [...tabList.querySelectorAll("li.tab")];

// Inserts a tab row at a position among the tab rows.
function placeTabRow(item, index) {
  let rows = tabRows().filter(row => row != item);
  tabList.insertBefore(item, rows[index] ?? null);
}

function addTab(tab, index = tabRows().length) {
  if (items.has(tab.id)) {
    updateTab(tab);
    return;
  }
  let item = document.createElement("li");
  item.className = "tab";
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
  placeTabRow(item, index);
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
  if (item.dataset.group != (tab.groupId ?? "")) {
    item.dataset.group = tab.groupId ?? "";
    showGroups();
  }
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
  showGroups();
}

// Tab groups: a header before each group's tabs (click it to collapse or
// expand the group, × to ungroup it), and the group's color along its tabs.
// A collapsed group shows only its selected tab, if any, as in Firefox.
const groups = new Map();

function showGroups() {
  for (let header of tabList.querySelectorAll("li.group")) {
    header.remove();
  }
  let previous = null;
  for (let row of tabRows()) {
    let group = groups.get(row.dataset.group);
    row.classList.toggle("grouped", !!group);
    row.style.setProperty("--group-color", group ? `var(--group-${group.color})` : "");
    row.hidden = !!group?.collapsed && Number(row.dataset.id) != currentId;
    if (group && group.id != previous) {
      let header = document.createElement("li");
      header.className = "group";
      header.dataset.group = group.id;
      header.style.setProperty("--group-color", `var(--group-${group.color})`);
      header.classList.toggle("collapsed", group.collapsed);
      let name = document.createElement("span");
      name.className = "title";
      name.textContent = group.name || "Unnamed group";
      let ungroup = document.createElement("button");
      ungroup.className = "ungroup";
      ungroup.title = "Ungroup";
      ungroup.textContent = "×";
      header.append(name, ungroup);
      tabList.insertBefore(header, row);
    }
    previous = group?.id ?? null;
  }
}

neeko.groups.on("create", ({ group }) => {
  groups.set(group.id, group);
  showGroups();
});
neeko.groups.on("update", ({ group }) => {
  groups.set(group.id, group);
  showGroups();
});
neeko.groups.on("remove", ({ id }) => {
  groups.delete(id);
  showGroups();
});

function moveTab(id, index) {
  let item = items.get(id);
  if (item) {
    placeTabRow(item, index);
    showGroups();
  }
}

function selectTab(id) {
  currentId = id;
  showGroups();
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
  if (item.classList.contains("group")) {
    let group = groups.get(item.dataset.group);
    if (event.target.closest(".ungroup")) {
      neeko.groups.ungroup(group.id).catch(reportError);
    } else {
      neeko.groups.update(group.id, { collapsed: !group.collapsed }).catch(reportError);
    }
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
  let target = event.target.closest("li.tab");
  if (dragged && target) {
    event.preventDefault();
    neeko.tabs.move(tabRows().indexOf(target), dragged);
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
  group: () => {
    let tab = tabs.get(currentId);
    return tab?.groupId
      ? neeko.tabs.setGroup(null)
      : neeko.groups.create([currentId], { name: `Group ${groups.size + 1}` });
  },
  // A setting of this UI's own, saved for every window (early.js applies it
  // at startup, and every window follows the change event below).
  tabsSide: () =>
    neeko.settings.set("tabs", tabsSide() == "right" ? "left" : "right"),
  hideTabs: () => neeko.settings.set("hideTabs", !neeko.settings.get("hideTabs")),
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
    menu.querySelector("[data-command=group]").textContent = tabs.get(currentId)
      ?.groupId
      ? "Remove tab from group"
      : "Add tab to a new group";
    menu.querySelector("[data-command=tabsSide]").textContent =
      tabsSide() == "right" ? "Tabs on the left" : "Tabs on the right";
    menu.querySelector("[data-command=hideTabs]").textContent =
      neeko.settings.get("hideTabs") ? "Show the tab list" : "Hide the tab list";
    for (let item of menu.querySelectorAll("[data-scheme]")) {
      item.classList.toggle(
        "checked",
        item.dataset.scheme == neeko.colorScheme.get()
      );
    }
  }
}

menuButton.addEventListener("click", () => showMenu(menu.hidden));
// Cmd+, (Settings... in the app menu): this UI's settings are in the ⋯ menu.
// Listening also tells Neeko not to open Firefox's own settings.
neeko.settings.on("request", () => showMenu(true));
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
  if (key == "tabs" || key == "hideTabs") {
    followTabsEdge();
  }
});

// Containers: each window is in one (neeko.window.container), with its own
// cookies and site data. A new window has none, and loads nothing, until the
// user picks one in "Who's browsing?"; picking an ephemeral one (it keeps
// nothing) makes Neeko replace the window with a private one. The badge next
// to the address bar says which this window is in. Without containers in
// browser.json, there's no picker and no badge.
const picker = document.getElementById("picker");
const pickerList = document.getElementById("picker-list");
const badge = document.getElementById("container-badge");

async function showContainer() {
  let containers = await neeko.containers.list();
  let current = containers.find(c => c.id == neeko.window.container);
  picker.hidden = !!current || !containers.length;
  badge.hidden = !current;
  if (current) {
    badge.textContent = current.name;
    badge.style.setProperty("--container-color", current.color);
    return;
  }
  pickerList.replaceChildren(
    ...containers.map(container => {
      let button = document.createElement("button");
      let avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.style.setProperty("--container-color", container.color);
      let name = document.createElement("span");
      name.textContent = container.name;
      button.append(avatar, name);
      if (container.ephemeral) {
        let note = document.createElement("span");
        note.className = "note";
        note.textContent = "Forgets everything";
        button.append(note);
      }
      button.addEventListener("click", () =>
        neeko.window.setContainer(container.id).catch(reportError)
      );
      return button;
    })
  );
}

neeko.window.on("container", showContainer);
neeko.containers.on("change", showContainer);
showContainer();

// The link the pointer is over in the page, or else the selected tab's
// loading status ("Waiting for example.com…"), at the bottom of the tab
// list. Listening for them hides Firefox's own status bubble.
const statusLine = document.getElementById("status");
let hoveredLink = "";
const loadingMessages = new Map();

function showStatus() {
  let text = hoveredLink || loadingMessages.get(currentId) || "";
  statusLine.textContent = text;
  statusLine.hidden = !text;
}

neeko.status.on("link", ({ text }) => {
  hoveredLink = text;
  showStatus();
});
neeko.status.on("message", ({ tabId, message }) => {
  if (message) {
    loadingMessages.set(tabId, message);
  } else {
    loadingMessages.delete(tabId);
  }
  showStatus();
});
neeko.tabs.on("select", showStatus);

// Find in page. Cmd+F, Cmd+G, Cmd+Shift+G and / in a page come here: listening
// for "request" tells Neeko not to open Firefox's own find bar. What's found
// is the selected tab's, so the bar closes when another tab is selected.
const findBar = document.getElementById("find");
const findText = document.getElementById("find-text");
const findCount = document.getElementById("find-count");
const findHighlight = document.getElementById("find-highlight");

function showFound(text, { result, current, total }) {
  if (text != findText.value) {
    return; // An older search, answered after a newer one started.
  }
  let none = text && result == "notFound";
  findText.classList.toggle("not-found", none);
  findCount.textContent = !text
    ? ""
    : none
      ? "No matches"
      : total == -1
        ? `${current} of many`
        : `${current} of ${total}`;
}

function find() {
  let text = findText.value;
  neeko.find.find(text).then(found => showFound(text, found), reportError);
}

function findAgain(previous) {
  if (!findText.value) {
    return;
  }
  let text = findText.value;
  (previous ? neeko.find.previous() : neeko.find.next()).then(
    found => showFound(text, found),
    reportError
  );
}

function openFind(selection) {
  // Just inside the top of the page.
  let page = document.querySelector("[data-neeko-content]").getBoundingClientRect();
  findBar.style.top = `${page.top + 8}px`;
  findBar.hidden = false;
  if (selection) {
    findText.value = selection;
  }
  findText.focus();
  findText.select();
  if (findText.value) {
    find();
    neeko.find.highlight(findHighlight.checked).catch(reportError);
  }
}

// Escape or ×: done, and the page gets the keys back, as in Firefox.
function closeFind() {
  if (!findBar.hidden) {
    findBar.hidden = true;
    neeko.find.close().catch(reportError);
    neeko.tabs.focus();
  }
}

neeko.find.on("request", ({ command, selection }) => {
  if (command == "next" || command == "previous") {
    if (findBar.hidden || !findText.value) {
      openFind();
    } else {
      findAgain(command == "previous");
    }
    return;
  }
  // "find", or "selection" (Cmd+E: find what's selected).
  openFind(selection);
});
findText.addEventListener("input", find);
findText.addEventListener("keydown", event => {
  if (event.key == "Enter") {
    findAgain(event.shiftKey);
  } else if (event.key == "Escape") {
    closeFind();
  }
});
document.getElementById("find-next").addEventListener("click", () => findAgain(false));
document.getElementById("find-previous").addEventListener("click", () => findAgain(true));
document.getElementById("find-close").addEventListener("click", () => closeFind());
findHighlight.addEventListener("change", () =>
  neeko.find.highlight(findHighlight.checked).catch(reportError)
);
neeko.tabs.on("select", ({ previousId }) => {
  if (!findBar.hidden) {
    findBar.hidden = true;
    // Unless that tab just closed.
    neeko.find.close(previousId).catch(() => {});
  }
});

// With the tab list hidden, the page reaches the window's edge, where the
// list slides out when the pointer gets there. The pointer over the page
// never reaches this UI, so Neeko watches that edge of the page for it.
const aside = document.querySelector("aside");
function followTabsEdge() {
  let hidden = !!neeko.settings.get("hideTabs");
  document.documentElement.toggleAttribute("data-hide-tabs", hidden);
  aside.classList.remove("peek");
  neeko.pointer.setEdges(hidden ? { [tabsSide()]: 4 } : {}).catch(reportError);
}
neeko.pointer.on("edge", ({ edge }) => {
  if (!document.documentElement.hasAttribute("data-hide-tabs")) {
    return;
  }
  if (edge == tabsSide()) {
    aside.classList.add("peek");
  } else {
    // Gone again, unless the pointer went onto the list.
    setTimeout(() => {
      if (!aside.matches(":hover")) {
        aside.classList.remove("peek");
      }
    }, 400);
  }
});
aside.addEventListener("mouseleave", () => aside.classList.remove("peek"));
followTabsEdge();
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
      let index = tabRows().indexOf(items.get(currentId)) + 1;
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
for (let group of await neeko.groups.list()) {
  groups.set(group.id, group);
}
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
