/**
 * Firefox's bookmarks (Places), as plain data for the API's neeko.bookmarks.
 * Bookmarks, folders and separators are identified by their Places GUIDs,
 * which stay the same across sessions. Tags, which Firefox keeps as
 * bookmarks in a hidden folder, are left out.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  PlacesUIUtils: "moz-src:///browser/components/places/PlacesUIUtils.sys.mjs",
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
});

// PlacesUtils.bookmarks.TYPE_BOOKMARK, TYPE_FOLDER and TYPE_SEPARATOR.
const TYPES = { 1: "bookmark", 2: "folder", 3: "separator" };
const TYPE_CODES = { bookmark: 1, folder: 2, separator: 3 };

const PLACES_EVENTS = [
  "bookmark-added",
  "bookmark-removed",
  "bookmark-moved",
  "bookmark-title-changed",
  "bookmark-url-changed",
];

/**
 * A bookmark's icon: Places' page-icon: URL for its page, which the UI can
 * put in an <img> (the image comes from Firefox's favicon store), or null if
 * Firefox has no icon for the page.
 */
function icon(url, hasIcon) {
  return url && hasIcon ? `page-icon:${url}` : null;
}

async function hasIcon(url) {
  if (!url) {
    return false;
  }
  try {
    let favicon = await lazy.PlacesUtils.favicons.getFaviconForPage(
      Services.io.newURI(url)
    );
    return !!favicon;
  } catch (e) {
    return false;
  }
}

/**
 * Describes an item from PlacesUtils.bookmarks.fetch() or insert().
 */
async function describe(info) {
  let url = info.url ? info.url.href : null;
  return {
    id: info.guid,
    type: TYPES[info.type],
    parentId: info.parentGuid,
    title: info.title ?? "",
    url,
    icon: icon(url, await hasIcon(url)),
    added: info.dateAdded.getTime(),
  };
}

async function fetchItem(id) {
  if (typeof id != "string" || !id) {
    throw new TypeError("Expected a bookmark id.");
  }
  let info =
    lazy.PlacesUtils.isValidGuid(id) &&
    (await lazy.PlacesUtils.bookmarks.fetch(id));
  if (!info || info.guid == lazy.PlacesUtils.bookmarks.tagsGuid) {
    throw new Error(`No bookmark with id ${id}.`);
  }
  return info;
}

function checkURL(url) {
  if (typeof url != "string" || !URL.canParse(url)) {
    throw new TypeError("Expected a URL.");
  }
  return url;
}

function checkTitle(title) {
  if (title !== undefined && typeof title != "string") {
    throw new TypeError("A title is a string.");
  }
  return title;
}

function checkIndex(index) {
  if (index !== undefined && !(Number.isInteger(index) && index >= 0)) {
    throw new TypeError("A position is a whole number from 0.");
  }
  return index;
}

export const NeekoBookmarks = {
  /** The folders every profile has, by the names the API uses. */
  get folders() {
    let { toolbarGuid, menuGuid, unfiledGuid, mobileGuid } =
      lazy.PlacesUtils.bookmarks;
    return {
      toolbar: toolbarGuid,
      menu: menuGuid,
      other: unfiledGuid,
      mobile: mobileGuid,
    };
  },

  /**
   * What's in a folder, in order: the bookmarks toolbar by default.
   */
  async list(folderId = lazy.PlacesUtils.bookmarks.toolbarGuid) {
    let folder = await fetchItem(folderId);
    if (TYPES[folder.type] != "folder") {
      throw new TypeError(`${folderId} isn't a folder.`);
    }
    let { tagsGuid } = lazy.PlacesUtils.bookmarks;
    let tree = await lazy.PlacesUtils.promiseBookmarksTree(folder.guid, {
      excludeItemsCallback: item => item.guid == tagsGuid,
    });
    return (tree?.children ?? []).map(child => ({
      id: child.guid,
      type: TYPES[child.typeCode],
      parentId: folder.guid,
      title: child.title ?? "",
      url: child.uri ?? null,
      icon: icon(child.uri, !!child.iconUri),
      // The tree has microseconds.
      added: Math.floor(child.dateAdded / 1000),
    }));
  },

  async get(id) {
    return describe(await fetchItem(id));
  },

  /**
   * Every bookmark of this URL, in any folder: none means it isn't
   * bookmarked.
   */
  async find(url) {
    let infos = [];
    await lazy.PlacesUtils.bookmarks.fetch({ url: checkURL(url) }, info =>
      infos.push(info)
    );
    return Promise.all(infos.map(describe));
  },

  /**
   * Adds a bookmark ({ url, title }), a folder ({ type: "folder", title })
   * or a separator ({ type: "separator" }), in `parentId` (by default where
   * Firefox puts new bookmarks, the toolbar unless the user chose another
   * folder) at `index` (by default the end).
   */
  async add(item) {
    if (!item || typeof item != "object") {
      throw new TypeError("Expected a bookmark to add.");
    }
    let { url, title, parentId, index } = item;
    let type = item.type ?? (url !== undefined ? "bookmark" : undefined);
    if (!TYPE_CODES[type]) {
      throw new TypeError(
        'Expected a url, or type "folder" or "separator".'
      );
    }
    if (type == "bookmark") {
      checkURL(url);
    } else if (url !== undefined) {
      throw new TypeError(`A ${type} has no url.`);
    }
    checkTitle(title);
    checkIndex(index);
    let parent = parentId
      ? await fetchItem(parentId)
      : { guid: await lazy.PlacesUIUtils.defaultParentGuid, type: 2 };
    if (TYPES[parent.type] != "folder") {
      throw new TypeError(`${parentId} isn't a folder.`);
    }
    let info = await lazy.PlacesUtils.bookmarks.insert({
      type: TYPE_CODES[type],
      parentGuid: parent.guid,
      index: index ?? lazy.PlacesUtils.bookmarks.DEFAULT_INDEX,
      ...(type == "bookmark" ? { url } : {}),
      ...(type != "separator" ? { title: title ?? "" } : {}),
    });
    return describe(info);
  },

  /**
   * Changes a bookmark's title or url, or moves it: to `index` in its
   * folder, or into `parentId` (at `index`, or the end).
   */
  async update(id, changes) {
    if (!changes || typeof changes != "object") {
      throw new TypeError("Expected the changes to make.");
    }
    let { title, url, parentId, index } = changes;
    let info = await fetchItem(id);
    checkTitle(title);
    checkIndex(index);
    let update = { guid: info.guid };
    if (title !== undefined) {
      update.title = title;
    }
    if (url !== undefined) {
      if (TYPES[info.type] != "bookmark") {
        throw new TypeError(`A ${TYPES[info.type]} has no url.`);
      }
      update.url = checkURL(url);
    }
    if (parentId !== undefined) {
      let parent = await fetchItem(parentId);
      if (TYPES[parent.type] != "folder") {
        throw new TypeError(`${parentId} isn't a folder.`);
      }
      update.parentGuid = parent.guid;
      update.index = index ?? lazy.PlacesUtils.bookmarks.DEFAULT_INDEX;
    } else if (index !== undefined) {
      update.index = index;
    }
    return describe(await lazy.PlacesUtils.bookmarks.update(update));
  },

  /** Removes a bookmark, or a folder with everything in it. */
  async remove(id) {
    await lazy.PlacesUtils.bookmarks.remove(await fetchItem(id));
  },

  /**
   * Calls emit(event, data) for every change to the bookmarks, in order, as
   * the API's "add", "remove", "move" and "update" events. Returns a
   * function that stops it.
   */
  watch(emit) {
    let { tagsGuid } = lazy.PlacesUtils.bookmarks;
    // Events that need a lookup (an icon, a whole bookmark) are sent in the
    // order they happened all the same.
    let queue = Promise.resolve();
    let send = make =>
      (queue = queue
        .then(make)
        .then(message => message && emit(...message))
        .catch(console.error));
    let listener = events => {
      for (let event of events) {
        if (event.isTagging || event.parentGuid == tagsGuid) {
          continue;
        }
        switch (event.type) {
          case "bookmark-added":
            send(async () => [
              "bookmarks.add",
              {
                bookmark: {
                  id: event.guid,
                  type: TYPES[event.itemType],
                  parentId: event.parentGuid,
                  title: event.title ?? "",
                  url: event.url || null,
                  icon: icon(event.url, await hasIcon(event.url)),
                  added: event.dateAdded,
                },
                index: event.index,
              },
            ]);
            break;
          case "bookmark-removed":
            // A folder's contents go with it: one event for the folder.
            if (!event.isDescendantRemoval) {
              send(() => [
                "bookmarks.remove",
                { id: event.guid, parentId: event.parentGuid },
              ]);
            }
            break;
          case "bookmark-moved":
            send(() => [
              "bookmarks.move",
              {
                id: event.guid,
                parentId: event.parentGuid,
                index: event.index,
                oldParentId: event.oldParentGuid,
              },
            ]);
            break;
          case "bookmark-title-changed":
          case "bookmark-url-changed": {
            let changed =
              event.type == "bookmark-title-changed" ? ["title"] : ["url", "icon"];
            send(async () => {
              let info = await lazy.PlacesUtils.bookmarks.fetch(event.guid);
              return (
                info && [
                  "bookmarks.update",
                  { bookmark: await describe(info), changed },
                ]
              );
            });
            break;
          }
        }
      }
    };
    lazy.PlacesUtils.observers.addListener(PLACES_EVENTS, listener);
    return () =>
      lazy.PlacesUtils.observers.removeListener(PLACES_EVENTS, listener);
  },
};
