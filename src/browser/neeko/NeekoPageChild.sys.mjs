/**
 * Gives the browser's own pages (NeekoPages) their `neekoPage` object, the
 * small API they have instead of the UI's `neeko`. It's installed before
 * the page's scripts run, only in the app's pages (this actor only exists
 * for them, in Firefox's privileged about: process), and NeekoPageParent
 * checks every call again.
 *
 *   neekoPage.private                    whether it's in a private window
 *   neekoPage.go(input)                  this tab goes where the user typed
 *   neekoPage.open(input, { background })  a new tab next to this one
 *   neekoPage.settings.get(key) / all() / set(key, value) / on("change", fn)
 *   neekoPage.search.engines() / setDefault(id)
 *   neekoPage.defaultBrowser.isDefault() / setDefault()
 *   neekoPage.import.browsers() / fromBrowser(id, { profile | profiles, types })
 *     / requestPermission(id) / openFullDiskAccess() / fromFile(kind)
 *   neekoPage.container                  its tab's container, if any
 *   neekoPage.containers.list() / create(fields) / update(id, changes)
 *     / remove(id) / clear(id) / on("change", fn)
 *   neekoPage.helper.list() / fetch(name, path, options) / stop(name)
 *   neekoPage.secrets.has(name) / set(name, value) / delete(name)
 *     / on("change" | "waiting", fn)
 *
 * Every method returns a promise; docs/api.md documents them. Those that
 * change something outside the browser, or wipe what the user kept, need a
 * click (or key) in the page first, which only the page's user can give
 * (askAfterClick).
 */

import { NeekoContainers } from "moz-src:///browser/neeko/NeekoContainers.sys.mjs";

/** A value of the page's to reject a call with, as it is. */
class PageValue {
  constructor(value) {
    this.value = value;
  }
}

// Answers that have no body, which a Response can't be given one for.
const NULL_BODY = [101, 103, 204, 205, 304];

/**
 * A helper request's body from a page (text, a Blob, an ArrayBuffer or a
 * typed array), copied out of the page as text or bytes.
 */
async function bodyBytes(body) {
  if (typeof body == "string") {
    return body;
  }
  let copy;
  try {
    copy = Cu.cloneInto(body, {});
  } catch (e) {
    copy = null;
  }
  let kind = copy && Cu.getClassName(copy, true);
  if (kind == "Blob" || kind == "File") {
    return new Uint8Array(await copy.arrayBuffer());
  }
  if (copy instanceof ArrayBuffer) {
    return new Uint8Array(copy);
  }
  if (ArrayBuffer.isView(copy)) {
    return new Uint8Array(copy.buffer, copy.byteOffset, copy.byteLength);
  }
  throw new TypeError("A helper request's body is text, a Blob, an ArrayBuffer or a typed array.");
}

export class NeekoPageChild extends JSWindowActorChild {
  /** The page's listeners for settings changes. */
  #listeners = new Set();
  /** And for container changes. */
  #containerListeners = new Set();
  /** And for secrets kept or deleted, and the keychain waiting on the user. */
  #secretListeners = { change: new Set(), waiting: new Set() };
  /**
   * The page's requests to the app's helpers, by id: the controllers of
   * their answers' bodies (page objects), which arrive as messages.
   */
  #streams = new Map();
  #nextStream = 1;

  handleEvent(event) {
    // The page's document exists and none of its scripts have run.
    if (
      event.type == "DOMDocElementInserted" &&
      event.target == this.document &&
      !this.browsingContext.parent
    ) {
      this.#install(this.contentWindow);
    }
  }

  receiveMessage({ name, data }) {
    if (name == "helper.chunk" || name == "helper.end") {
      // Called as the page's own: a read waiting for this chunk resolves
      // with an object made where the call runs, which the page couldn't
      // read if made here.
      let controller = this.#streams.get(data.stream);
      if (!controller) {
        return;
      }
      controller = Cu.waiveXrays(controller);
      let win = this.contentWindow;
      if (name == "helper.chunk") {
        controller.enqueue(Cu.cloneInto(data.chunk, win));
      } else {
        this.#streams.delete(data.stream);
        if (data.error) {
          controller.error(new win.Error(data.error));
        } else {
          controller.close();
        }
      }
      return;
    }
    let listeners = {
      "settings.change": this.#listeners,
      "containers.change": this.#containerListeners,
      "secrets.change": this.#secretListeners.change,
      "secrets.waiting": this.#secretListeners.waiting,
    }[name];
    if (listeners) {
      let win = this.contentWindow;
      for (let listener of listeners) {
        try {
          listener(Cu.cloneInto(data, win));
        } catch (e) {
          console.error(e);
        }
      }
    }
  }

  /**
   * neekoPage.helper.fetch(): a request to one of the app's helpers, as
   * fetch() would send it to a server, resolving with a Response of the
   * page's once the answer starts, its body streaming in. Options: method,
   * headers, body, signal, secrets.
   */
  async #helperFetch(win, name, path, options) {
    let request = {};
    let signal = null;
    if (options !== undefined && options !== null) {
      if (typeof options != "object") {
        throw new TypeError("Expected options: { method, headers, body, signal, secrets }.");
      }
      for (let key of Object.keys(options)) {
        if (!["method", "headers", "body", "signal", "secrets"].includes(key)) {
          throw new TypeError(`Unknown option "${key}".`);
        }
      }
      if (options.method !== undefined) {
        request.method = String(options.method);
      }
      if (options.headers !== undefined) {
        request.headers = Array.from(new win.Headers(options.headers), ([key, value]) => [
          String(key),
          String(value),
        ]);
      }
      if (options.body !== undefined && options.body !== null) {
        request.body = await bodyBytes(options.body);
      }
      if (options.secrets !== undefined) {
        if (!Array.isArray(options.secrets)) {
          throw new TypeError("Expected secrets as a list of secret names.");
        }
        request.secrets = Array.from(options.secrets, String);
      }
      if (options.signal !== undefined && options.signal !== null) {
        if (Cu.getClassName(options.signal, true) != "AbortSignal") {
          throw new TypeError("Expected an AbortSignal.");
        }
        signal = options.signal;
      }
    }
    // Why the page cancelled, as the page's own object.
    let reason = () => new PageValue(Cu.waiveXrays(signal).reason);
    if (signal?.aborted) {
      throw reason();
    }
    let id = this.#nextStream++;
    let controller;
    let cancel = () => {
      if (this.#streams.delete(id)) {
        this.sendAsyncMessage("helper.cancel", { id });
      }
    };
    // The body's source, an object of the page's with functions of Neeko's.
    let source = Cu.createObjectIn(win);
    Cu.exportFunction(c => (controller = c), source, { defineAs: "start" });
    Cu.exportFunction(cancel, source, { defineAs: "cancel" });
    let stream = new win.ReadableStream(source);
    this.#streams.set(id, controller);
    let aborted;
    let abort = () => {
      let open = this.#streams.get(id);
      cancel();
      if (open) {
        Cu.waiveXrays(open).error(reason().value);
      }
      aborted(reason());
    };
    signal?.addEventListener("abort", abort, { once: true });
    let answer;
    try {
      answer = await Promise.race([
        this.sendQuery("helper.fetch", { id, name, path, request }),
        new Promise((resolve, reject) => (aborted = reject)),
      ]);
    } catch (e) {
      this.#streams.delete(id);
      signal?.removeEventListener("abort", abort);
      throw signal?.aborted ? reason() : e;
    }
    let empty = NULL_BODY.includes(answer.status) || /^head$/i.test(request.method ?? "");
    return new win.Response(
      empty ? null : stream,
      Cu.cloneInto(
        { status: answer.status, statusText: answer.statusText, headers: answer.headers },
        win
      )
    );
  }

  #install(win) {
    // Asks the parent, and hands the page a promise of the answer.
    let ask = (name, data = {}) =>
      new win.Promise((resolve, reject) => {
        this.sendQuery(name, data).then(
          result => resolve(Cu.cloneInto(result, win)),
          e => reject(new win.Error(e.message))
        );
      });
    // The same, for what only the page's user may start: it's refused unless
    // the user just clicked or typed in the page, and uses up that click, as
    // opening a pop-up does.
    let askAfterClick = (name, data = {}) => {
      if (!this.document.hasValidTransientUserGestureActivation) {
        return win.Promise.reject(
          new win.Error("This needs a click in the page first: call it from a click handler.")
        );
      }
      this.document.consumeTransientUserGestureActivation();
      return ask(name, data);
    };
    let define = (target, name, fn) =>
      Cu.exportFunction(fn, target, { defineAs: name });

    let api = Cu.createObjectIn(win, { defineAs: "neekoPage" });
    // A tab never moves between private and other windows.
    Cu.waiveXrays(api).private = this.browsingContext.usePrivateBrowsing;
    define(api, "go", input => ask("go", { input }));
    define(api, "open", (input, options) =>
      ask("open", { input, background: !!options?.background })
    );

    let settings = Cu.createObjectIn(api, { defineAs: "settings" });
    define(settings, "all", () => ask("settings.all"));
    define(settings, "get", key =>
      ask("settings.all").then(all => all[key])
    );
    define(settings, "set", (key, value) =>
      ask("settings.set", { key, value })
    );
    define(settings, "on", (type, listener) => {
      if (type != "change" || typeof listener != "function") {
        throw new win.TypeError('Expected "change" and a listener.');
      }
      if (!this.#listeners.size) {
        this.sendAsyncMessage("settings.listen");
      }
      this.#listeners.add(listener);
      return Cu.exportFunction(() => this.#listeners.delete(listener), win);
    });

    let search = Cu.createObjectIn(api, { defineAs: "search" });
    define(search, "engines", () => ask("search.engines"));
    define(search, "setDefault", id => ask("search.setDefault", { id }));

    let defaultBrowser = Cu.createObjectIn(api, { defineAs: "defaultBrowser" });
    define(defaultBrowser, "isDefault", () => ask("defaultBrowser.isDefault"));
    define(defaultBrowser, "setDefault", () =>
      askAfterClick("defaultBrowser.setDefault")
    );

    let imports = Cu.createObjectIn(api, { defineAs: "import" });
    define(imports, "browsers", () => ask("import.browsers"));
    define(imports, "fromBrowser", (id, options) =>
      askAfterClick("import.fromBrowser", {
        id,
        profile: options?.profile,
        profiles: options?.profiles ? [...options.profiles] : undefined,
        types: options?.types ? [...options.types] : undefined,
      })
    );
    define(imports, "requestPermission", id =>
      askAfterClick("import.requestPermission", { id })
    );
    define(imports, "openFullDiskAccess", () =>
      askAfterClick("import.openFullDiskAccess")
    );
    define(imports, "fromFile", kind => askAfterClick("import.fromFile", { kind }));

    // The container of the page's tab: a tab never changes container.
    Cu.waiveXrays(api).container = NeekoContainers.idForUserContext(
      this.browsingContext.originAttributes.userContextId
    );
    let containers = Cu.createObjectIn(api, { defineAs: "containers" });
    define(containers, "list", () => ask("containers.list"));
    define(containers, "create", fields =>
      ask("containers.create", { fields: Cu.cloneInto(fields, {}) })
    );
    define(containers, "update", (id, changes) => {
      let data = { id, changes: Cu.cloneInto(changes, {}) };
      // Becoming ephemeral, or not, wipes what the container kept.
      return data.changes?.ephemeral !== undefined
        ? askAfterClick("containers.update", data)
        : ask("containers.update", data);
    });
    define(containers, "remove", id => askAfterClick("containers.remove", { id }));
    define(containers, "clear", id => askAfterClick("containers.clear", { id }));
    define(containers, "on", (type, listener) => {
      if (type != "change" || typeof listener != "function") {
        throw new win.TypeError('Expected "change" and a listener.');
      }
      if (!this.#containerListeners.size) {
        this.sendAsyncMessage("containers.listen");
      }
      this.#containerListeners.add(listener);
      return Cu.exportFunction(() => this.#containerListeners.delete(listener), win);
    });

    let helper = Cu.createObjectIn(api, { defineAs: "helper" });
    define(helper, "list", () => ask("helper.list"));
    define(helper, "stop", name => ask("helper.stop", { name }));
    define(helper, "fetch", (name, path, options) =>
      new win.Promise((resolve, reject) => {
        this.#helperFetch(win, name, path, options).then(resolve, e =>
          reject(e instanceof PageValue ? e.value : new win.Error(e.message))
        );
      })
    );

    // Never a value back: only a helper request that names a secret gets it.
    // Keeping or deleting one takes a click, one call per click.
    let secrets = Cu.createObjectIn(api, { defineAs: "secrets" });
    define(secrets, "has", name => ask("secrets.has", { name }));
    define(secrets, "set", (name, value) => askAfterClick("secrets.set", { name, value }));
    define(secrets, "delete", name => askAfterClick("secrets.delete", { name }));
    define(secrets, "on", (type, listener) => {
      if (!["change", "waiting"].includes(type) || typeof listener != "function") {
        throw new win.TypeError('Expected "change" or "waiting", and a listener.');
      }
      let { change, waiting } = this.#secretListeners;
      if (!change.size && !waiting.size) {
        this.sendAsyncMessage("secrets.listen");
      }
      this.#secretListeners[type].add(listener);
      return Cu.exportFunction(() => this.#secretListeners[type].delete(listener), win);
    });

    for (let object of [settings, search, defaultBrowser, imports, containers, helper, secrets, api]) {
      Cu.waiveXrays(win).Object.freeze(Cu.waiveXrays(object));
    }
  }
}
