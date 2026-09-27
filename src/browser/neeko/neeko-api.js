/**
 * The Neeko API, the UI's side: the global `neeko` object. Neeko runs this
 * file inside the custom UI page before any of the page's own scripts.
 *
 * Every call becomes a message to Firefox and returns a promise of the reply,
 * and events arrive as messages too. Nothing here touches Firefox directly, so
 * the same file works when the UI runs sandboxed. docs/api.md documents the
 * API and the messages.
 *
 * The file's value is a function Neeko calls with the MessagePort that
 * carries the messages, and what the UI can read without waiting
 * ({ platform, settings, colorScheme, bookmarkFolders }), so nothing else
 * leaks into the page's globals.
 */

(port, facts) => {
  "use strict";

  let { platform } = facts;
  // Kept current by the settings and color scheme change events, which
  // Neeko always sends, so reading them never waits.
  let settings = new Map(Object.entries(facts.settings));
  let colorScheme = facts.colorScheme;

  let nextId = 1;
  let pending = new Map();
  // "tabs.update" -> Set of listeners
  let listeners = new Map();

  port.onmessage = ({ data }) => {
    if (data.event == "settings.change") {
      let { key, value } = data.data;
      if (value === null) {
        settings.delete(key);
      } else {
        settings.set(key, value);
      }
    } else if (data.event == "colorScheme.change") {
      colorScheme = data.data.colorScheme;
    }
    if (data.event) {
      for (let listener of listeners.get(data.event) ?? []) {
        try {
          listener(data.data);
        } catch (e) {
          reportError(e);
        }
      }
      return;
    }
    let call = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) {
      call.reject(new Error(data.error.message));
    } else {
      call.resolve(data.result);
    }
  };

  function call(method, ...params) {
    return new Promise((resolve, reject) => {
      let id = nextId++;
      port.postMessage({ id, method, params });
      pending.set(id, { resolve, reject });
    });
  }

  // Tells Neeko to start or stop sending an event. Neeko only sends events
  // the UI listens for, and treats listening as "the UI handles this".
  function listen(event, listening) {
    call("events.listen", event, listening).catch(reportError);
  }

  /**
   * Makes the `on` function for one part of the API. Returns a function that
   * removes the listener again.
   */
  function events(namespace, types) {
    return (type, listener) => {
      if (!types.includes(type)) {
        throw new TypeError(
          `neeko.${namespace} has no "${type}" event. ` +
            `Its events are: ${types.join(", ")}.`
        );
      }
      if (typeof listener != "function") {
        throw new TypeError("The listener must be a function.");
      }
      let key = `${namespace}.${type}`;
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      if (!set.size) {
        listen(key, true);
      }
      set.add(listener);
      return () => {
        if (set.delete(listener) && !set.size) {
          listen(key, false);
        }
      };
    };
  }

  let neeko = Object.freeze({
    platform,
    tabs: Object.freeze({
      list: () => call("tabs.list"),
      current: () => call("tabs.current"),
      open: (url, options) => call("tabs.open", url, options),
      close: tabId => call("tabs.close", tabId),
      select: tabId => call("tabs.select", tabId),
      duplicate: (tabId, options) => call("tabs.duplicate", tabId, options),
      move: (index, tabId) => call("tabs.move", index, tabId),
      setMuted: (muted, tabId) => call("tabs.setMuted", muted, tabId),
      setGroup: (groupId, tabId) => call("tabs.setGroup", groupId, tabId),
      focus: () => call("tabs.focus"),
      on: events("tabs", ["open", "close", "select", "move", "update"]),
    }),
    nav: Object.freeze({
      go: (input, tabId) => call("nav.go", input, tabId),
      back: tabId => call("nav.back", tabId),
      forward: tabId => call("nav.forward", tabId),
      reload: tabId => call("nav.reload", tabId),
      on: events("nav", ["addressbar"]),
    }),
    prompts: Object.freeze({
      list: () => call("prompts.list"),
      answer: (promptId, action, options) =>
        call("prompts.answer", promptId, action, options),
      on: events("prompts", ["open", "close"]),
    }),
    fullscreen: Object.freeze({
      state: () => call("fullscreen.state"),
      exit: () => call("fullscreen.exit"),
      setWindow: fullscreen => call("fullscreen.setWindow", fullscreen),
      on: events("fullscreen", ["page", "window"]),
    }),
    downloads: Object.freeze({
      list: () => call("downloads.list"),
      open: downloadId => call("downloads.open", downloadId),
      show: downloadId => call("downloads.show", downloadId),
      cancel: downloadId => call("downloads.cancel", downloadId),
      retry: downloadId => call("downloads.retry", downloadId),
      remove: downloadId => call("downloads.remove", downloadId),
      on: events("downloads", ["start", "update", "remove"]),
    }),
    settings: Object.freeze({
      get: key => settings.get(key),
      all: () => Object.fromEntries(settings),
      set: (key, value) => call("settings.set", key, value),
      on: events("settings", ["change", "request"]),
    }),
    bookmarks: Object.freeze({
      // The folders every profile has: { toolbar, menu, other, mobile }.
      folders: Object.freeze({ ...facts.bookmarkFolders }),
      list: folderId => call("bookmarks.list", folderId),
      get: id => call("bookmarks.get", id),
      find: url => call("bookmarks.find", url),
      add: item => call("bookmarks.add", item),
      update: (id, changes) => call("bookmarks.update", id, changes),
      remove: id => call("bookmarks.remove", id),
      on: events("bookmarks", ["add", "remove", "move", "update", "request"]),
    }),
    groups: Object.freeze({
      list: () => call("groups.list"),
      create: (tabIds, options) => call("groups.create", tabIds, options),
      update: (groupId, changes) => call("groups.update", groupId, changes),
      ungroup: groupId => call("groups.ungroup", groupId),
      on: events("groups", ["create", "remove", "update"]),
    }),
    pointer: Object.freeze({
      setEdges: edges => call("pointer.setEdges", edges),
      on: events("pointer", ["edge"]),
    }),
    colorScheme: Object.freeze({
      get: () => colorScheme,
      set: scheme => call("colorScheme.set", scheme),
      on: events("colorScheme", ["change"]),
    }),
  });

  Object.defineProperty(window, "neeko", { value: neeko, enumerable: true });
};
