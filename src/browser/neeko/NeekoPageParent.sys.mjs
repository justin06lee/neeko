/**
 * The Firefox side of `neekoPage`, the API of the browser's own pages
 * (NeekoPages): what those pages may ask of the browser, and nothing more.
 *
 * Every call is checked first: the caller must be one of the app's pages
 * (a content principal for its about:<name> address, as the parent knows
 * it), a tab's top-level page, in Firefox's privileged about: process.
 * Anything else is refused, so neither a web page nor a compromised web
 * content process can use this.
 */

import { goTo, openTab } from "moz-src:///browser/neeko/NeekoAPI.sys.mjs";
import { NeekoPages } from "moz-src:///browser/neeko/NeekoPages.sys.mjs";
import { NeekoSettings } from "moz-src:///browser/neeko/NeekoSettings.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  SearchService: "moz-src:///toolkit/components/search/SearchService.sys.mjs",
});

/**
 * Takes what a user typed, for a page to load: an address or search terms,
 * but not script or data, which would run as the browser.
 */
function typed(input) {
  if (typeof input != "string" || !input.trim()) {
    throw new TypeError("Expected a URL or search terms.");
  }
  if (/^\s*(javascript|data):/i.test(input)) {
    throw new TypeError("Pages can't open javascript: or data: URLs.");
  }
  return input.trim();
}

export class NeekoPageParent extends JSWindowActorParent {
  /** Stops sending the page settings changes. */
  #unwatch = null;

  #allowed() {
    let context = this.browsingContext;
    return (
      !context.parent &&
      context.currentRemoteType == "privilegedabout" &&
      NeekoPages.isPagePrincipal(this.manager.documentPrincipal)
    );
  }

  async receiveMessage({ name, data }) {
    if (!this.#allowed()) {
      throw new Error("Only the browser's own pages can do that.");
    }
    let browser = this.browsingContext.embedderElement;
    let win = browser?.ownerDocument.defaultView;
    switch (name) {
      case "go":
        goTo(win, browser, typed(data.input));
        return undefined;
      case "open": {
        // Next to the page's own tab.
        let tab = win.gBrowser.getTabForBrowser(browser);
        openTab(win, typed(data.input), {
          background: !!data.background,
          index: tab ? tab.index + 1 : undefined,
        });
        return undefined;
      }
      case "settings.all":
        return NeekoSettings.all();
      case "settings.set":
        NeekoSettings.set(data.key, data.value);
        return undefined;
      case "settings.listen":
        this.#unwatch ??= NeekoSettings.watch((key, value) =>
          this.sendAsyncMessage("settings.change", { key, value })
        );
        return undefined;
      case "search.engines": {
        let engines = await lazy.SearchService.getVisibleEngines();
        let current = await lazy.SearchService.getDefault();
        return engines.map(engine => ({
          id: engine.id,
          name: engine.name,
          isDefault: engine.id == current?.id,
        }));
      }
      case "search.setDefault": {
        let engine =
          typeof data.id == "string" && lazy.SearchService.getEngineById(data.id);
        if (!engine || engine.hidden) {
          throw new Error(`No search engine with id ${data.id}.`);
        }
        await lazy.SearchService.setDefault(
          engine,
          lazy.SearchService.CHANGE_REASON.USER
        );
        return undefined;
      }
    }
    throw new Error(`Unknown message "${name}".`);
  }

  didDestroy() {
    this.#unwatch?.();
  }
}
