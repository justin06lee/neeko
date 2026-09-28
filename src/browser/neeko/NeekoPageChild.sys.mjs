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
 *
 * Every method returns a promise; docs/api.md documents them. Those that
 * change something outside the browser need a click (or key) in the page
 * first, which only the page's user can give (askAfterClick).
 */

export class NeekoPageChild extends JSWindowActorChild {
  /** The page's listeners for settings changes. */
  #listeners = new Set();

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
    if (name == "settings.change") {
      let win = this.contentWindow;
      for (let listener of this.#listeners) {
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

    for (let object of [settings, search, defaultBrowser, api]) {
      Cu.waiveXrays(win).Object.freeze(Cu.waiveXrays(object));
    }
  }
}
