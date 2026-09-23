/**
 * Downloads for the Neeko API: the window's downloads as plain data, and
 * their changes as events. NeekoAPI makes one for its UI page the first time
 * the UI asks about downloads.
 *
 * The list is Firefox's own (Downloads.sys.mjs): the same downloads its
 * downloads panel and Library window show, public ones in normal windows
 * and private ones in private windows.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  DownloadsCommon:
    "moz-src:///browser/components/downloads/DownloadsCommon.sys.mjs",
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

// Download ids are small numbers, unique for the whole session, like tab ids.
let nextDownloadId = 1;
const downloadIds = new WeakMap();

function downloadId(download) {
  let id = downloadIds.get(download);
  if (!id) {
    id = nextDownloadId++;
    downloadIds.set(download, id);
  }
  return id;
}

/**
 * Where a download is at, in one word.
 */
function stateOf(download) {
  if (download.succeeded) {
    return "done";
  }
  if (download.error) {
    return download.error.becauseBlocked ? "blocked" : "failed";
  }
  if (download.canceled) {
    // Firefox pauses a download by canceling it and keeping what it has.
    return download.hasPartialData ? "paused" : "canceled";
  }
  return "downloading";
}

/**
 * Why a download failed: it broke off or never reached the server
 * ("network"), it couldn't be saved ("file"), or something else.
 */
function failureOf(download) {
  let error = download.error;
  if (!error || error.becauseBlocked) {
    return null;
  }
  if (error.becauseSourceFailed) {
    return "network";
  }
  return error.becauseTargetFailed ? "file" : "other";
}

/**
 * What the UI knows about a download.
 */
function describeDownload(download) {
  let url = download.source.url;
  try {
    // Without any user:password@ part.
    url = Services.io.createExposableURI(Services.io.newURI(url)).spec;
  } catch (e) {}
  let path = download.target.path ?? "";
  return {
    id: downloadId(download),
    url,
    filename: path ? PathUtils.filename(path) : "",
    path,
    state: stateOf(download),
    // Progress updates come at most every 400ms, so the last one can be
    // behind; once it's done, it's the file's size.
    received: download.succeeded
      ? (download.target.size ?? download.currentBytes)
      : download.currentBytes,
    total: download.hasProgress ? download.totalBytes : null,
    speed: download.speed,
    startTime: download.startTime?.getTime() ?? null,
    error: failureOf(download),
  };
}

export class NeekoDownloads {
  #list = null;
  #view = null;
  #ready;
  #destroyed = false;

  /**
   * @param {Window} win The browser window whose downloads to follow.
   * @param {Function} emit Sends an event to the UI: emit(event, data).
   */
  constructor(win, emit) {
    let kind = lazy.PrivateBrowsingUtils.isWindowPrivate(win)
      ? lazy.Downloads.PRIVATE
      : lazy.Downloads.PUBLIC;
    let starting = true;
    this.#view = {
      onDownloadAdded: download => {
        // Adding the view reports the downloads already there, too.
        if (!starting) {
          emit("downloads.start", { download: describeDownload(download) });
        }
      },
      onDownloadChanged: download => {
        emit("downloads.update", { download: describeDownload(download) });
      },
      onDownloadRemoved: download => {
        emit("downloads.remove", { id: downloadId(download) });
      },
    };
    this.#ready = (async () => {
      let list = await lazy.Downloads.getList(kind);
      if (this.#destroyed) {
        return;
      }
      await list.addView(this.#view);
      starting = false;
      this.#list = list;
    })();
  }

  destroy() {
    this.#destroyed = true;
    this.#list?.removeView(this.#view);
  }

  /**
   * Resolves once the view is following the list.
   */
  ready() {
    return this.#ready;
  }

  /**
   * Every download in the window's list, oldest first.
   */
  async list() {
    await this.#ready;
    return (await this.#list.getAll()).map(describeDownload);
  }

  /**
   * The download with this id in the window's list.
   */
  async find(id) {
    if (!Number.isInteger(id)) {
      throw new TypeError("Expected a download id.");
    }
    await this.#ready;
    let download = (await this.#list.getAll()).find(
      d => downloadIds.get(d) === id
    );
    if (!download) {
      throw new Error(`No download with id ${id}.`);
    }
    return download;
  }

  // What the UI can do with a download, the way Firefox's downloads panel
  // does it (DownloadsViewUI.sys.mjs).

  /**
   * Opens the downloaded file, with the app the system (or Firefox, for
   * files it shows itself) would use.
   */
  async open(id) {
    let download = await this.find(id);
    if (!download.succeeded) {
      throw new Error(`Download ${id} hasn't finished.`);
    }
    await download.launch();
  }

  /**
   * Shows the file in Finder (or the system's file manager).
   */
  async show(id) {
    await (await this.find(id)).showContainingDirectory();
  }

  /**
   * Stops a download and deletes what it had downloaded so far.
   */
  async cancel(id) {
    let download = await this.find(id);
    download.cancel().catch(() => {});
    await download.removePartialData().catch(console.error);
    await download.target.refresh();
  }

  /**
   * Starts a failed or canceled download again.
   */
  async retry(id) {
    let download = await this.find(id);
    // Failures while retrying show up as the download's state.
    download.start().catch(() => {});
  }

  /**
   * Removes a download from the list and from history, not the file, like
   * "Remove From History" in Firefox's downloads panel.
   */
  async remove(id) {
    await lazy.DownloadsCommon.deleteDownload(await this.find(id));
  }
}
