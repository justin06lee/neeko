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
 * carries the messages, so nothing else leaks into the page's globals.
 */

port => {
  "use strict";

  let nextId = 1;
  let pending = new Map();
  // "tabs.update" -> Set of listeners
  let listeners = new Map();

  port.onmessage = ({ data }) => {
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
    tabs: Object.freeze({
      list: () => call("tabs.list"),
      current: () => call("tabs.current"),
      open: url => call("tabs.open", url),
      close: tabId => call("tabs.close", tabId),
      select: tabId => call("tabs.select", tabId),
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
  });

  Object.defineProperty(window, "neeko", { value: neeko, enumerable: true });
};
