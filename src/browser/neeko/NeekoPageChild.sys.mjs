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
 *
 * Every method returns a promise; docs/api.md documents them. Those that
 * change something outside the browser need a click (or key) in the page
 * first, which only the page's user can give (askAfterClick).
 */

import { NeekoContainers } from "moz-src:///browser/neeko/NeekoContainers.sys.mjs";

export class NeekoPageChild extends JSWindowActorChild {
  /** The page's listeners for settings changes. */
  #listeners = new Set();
  /** And for container changes. */
  #containerListeners = new Set();

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
    if (name == "settings.change" || name == "containers.change") {
      let win = this.contentWindow;
      let listeners =
        name == "settings.change" ? this.#listeners : this.#containerListeners;
      for (let listener of listeners) {
        try {
          listener(Cu.cloneInto(data, win));
        } catch (e) {
          console.error(e);
        }
      }
    }
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
    define(containers, "update", (id, changes) =>
      ask("containers.update", { id, changes: Cu.cloneInto(changes, {}) })
    );
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

    for (let object of [settings, search, defaultBrowser, imports, containers, api]) {
      Cu.waiveXrays(win).Object.freeze(Cu.waiveXrays(object));
    }
  }
}
