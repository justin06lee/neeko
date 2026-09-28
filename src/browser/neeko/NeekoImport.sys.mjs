/**
 * Importing from other browsers and from files, for the browser's own pages
 * (neekoPage.import, through NeekoPageParent), with Firefox's own importers
 * (MigrationUtils): bookmarks, history and passwords, into Firefox's
 * bookmarks, history and password manager. Only what the other browser keeps
 * on this computer: extensions, which Firefox would match on
 * addons.mozilla.org, are left out, so importing never goes online.
 *
 * Pages get names and counts, never the data itself.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BookmarkHTMLUtils: "resource://gre/modules/BookmarkHTMLUtils.sys.mjs",
  BookmarkJSONUtils: "resource://gre/modules/BookmarkJSONUtils.sys.mjs",
  LoginCSVImport: "resource://gre/modules/LoginCSVImport.sys.mjs",
  MigrationUtils: "resource:///modules/MigrationUtils.sys.mjs",
});

ChromeUtils.defineLazyGetter(
  lazy,
  "strings",
  () => new Localization(["branding/brand.ftl", "browser/migrationWizard.ftl"])
);

// What can be imported, by the API's name: MigrationUtils' resource type,
// and the name of its count (MigrationUtils.getImportedCount), if it has one.
const TYPES = {
  bookmarks: { resource: "BOOKMARKS", count: "bookmarks" },
  history: { resource: "HISTORY", count: null },
  passwords: { resource: "PASSWORDS", count: "logins" },
};

// Firefox's importers that aren't other browsers: another Firefox profile,
// and Firefox's own tests.
const NOT_BROWSERS = new Set([
  "firefox",
  "firefox-selectable-profile",
  "internal-testing",
]);

// macOS's System Settings, at Privacy & Security > Full Disk Access.
const FULL_DISK_ACCESS =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

// One import at a time: Firefox counts what came in for the latest one.
let queue = Promise.resolve();

function oneAtATime(task) {
  let run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

/**
 * The browsers Firefox can import from on this system, by key, whether or
 * not they're installed.
 */
function browserKeys() {
  return lazy.MigrationUtils.availableMigratorKeys.filter(
    key =>
      !NOT_BROWSERS.has(key) &&
      Services.prefs.getBoolPref(`browser.migrate.${key}.enabled`, false)
  );
}

async function displayName(key) {
  let name = await lazy.strings.formatValue(
    `migration-wizard-migrator-display-name-${key}`
  );
  return name || key;
}

/**
 * What a browser profile has to import, by the API's names.
 */
async function typesIn(migrator, profile) {
  let available = await migrator.getMigrateData(profile);
  return Object.keys(TYPES).filter(
    type => available & lazy.MigrationUtils.resourceTypes[TYPES[type].resource]
  );
}

/**
 * The migrator for a browser, and the profile of it with this id ("" for
 * browsers with just one), or an error.
 */
async function findProfile(id, profileId) {
  if (typeof id != "string" || !browserKeys().includes(id)) {
    throw new Error(`No browser to import from called "${id}".`);
  }
  let migrator = await lazy.MigrationUtils.getMigrator(id);
  if (!migrator) {
    throw new Error(`${await displayName(id)} isn't on this computer.`);
  }
  let profiles = (await migrator.getSourceProfiles()) ?? null;
  if (!profiles) {
    return { migrator, profile: null };
  }
  let profile = profiles.find(p => p.id === profileId) ?? null;
  if (!profile) {
    if (profileId === undefined && profiles.length) {
      return { migrator, profile: profiles[0] };
    }
    throw new Error(`${await displayName(id)} has no profile "${profileId}".`);
  }
  return { migrator, profile };
}

/**
 * Asks the user for a file with a native file picker, in a browser window:
 * its path, or null if they cancel.
 */
function pickFile(win, filters) {
  return new Promise(resolve => {
    let picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    picker.init(win.browsingContext, "", Ci.nsIFilePicker.modeOpen);
    for (let [title, pattern] of filters) {
      picker.appendFilter(title, pattern);
    }
    picker.appendFilters(Ci.nsIFilePicker.filterAll);
    picker.open(result =>
      resolve(result == Ci.nsIFilePicker.returnOK ? picker.file.path : null)
    );
  });
}

export const NeekoImport = {
  /**
   * Every browser Firefox can import from here:
   * [{ id, name, available, needsPermission, profiles: [{ id, name, types }] }]
   */
  async browsers() {
    let result = [];
    for (let key of browserKeys()) {
      let entry = {
        id: key,
        name: await displayName(key),
        available: false,
        needsPermission: false,
        profiles: [],
      };
      result.push(entry);
      try {
        let migrator = await lazy.MigrationUtils.getMigrator(key);
        if (!migrator) {
          continue;
        }
        entry.available = true;
        entry.needsPermission = !(await migrator.hasPermissions());
        let profiles = await migrator.getSourceProfiles();
        for (let profile of profiles ?? [null]) {
          entry.profiles.push({
            id: profile?.id ?? "",
            name: profile?.name ?? entry.name,
            types: await typesIn(migrator, profile),
          });
        }
      } catch (e) {
        console.error(`Neeko: couldn't read ${key} to import from it.`, e);
      }
    }
    return result;
  },

  /**
   * Imports some of what a browser profile has (all of it by default): for
   * each type, { count } (null where Firefox doesn't count) or { error }.
   */
  fromBrowser(id, { profile: profileId, types } = {}) {
    return oneAtATime(async () => {
      if (types !== undefined) {
        if (!Array.isArray(types) || types.some(type => !Object.hasOwn(TYPES, type))) {
          throw new TypeError(`Types are some of: ${Object.keys(TYPES).join(", ")}.`);
        }
      }
      let { migrator, profile } = await findProfile(id, profileId);
      let has = await typesIn(migrator, profile);
      let wanted = types ?? has;
      let result = {};
      if (!(await migrator.hasPermissions())) {
        for (let type of wanted) {
          result[type] = { error: "permission" };
        }
        return result;
      }
      let resources = 0;
      for (let type of wanted) {
        if (has.includes(type)) {
          resources |= lazy.MigrationUtils.resourceTypes[TYPES[type].resource];
        } else {
          result[type] = { error: "none" };
        }
      }
      if (!resources) {
        return result;
      }
      let done = {};
      await migrator.migrate(resources, false, profile, (resource, success) => {
        done[resource] = success;
      });
      for (let type of wanted) {
        if (result[type]) {
          continue;
        }
        let { resource, count } = TYPES[type];
        if (done[lazy.MigrationUtils.resourceTypes[resource]]) {
          result[type] = {
            count: count ? lazy.MigrationUtils.getImportedCount(count) : null,
          };
        } else {
          // The profile's passwords were readable to find (see typesIn), so
          // when a Chromium browser's don't come, it's the key to decrypt
          // them, in the macOS keychain, that was refused.
          result[type] = {
            error:
              type == "passwords" && migrator._keychainServiceName
                ? "keychain"
                : "failed",
          };
        }
      }
      return result;
    });
  },

  /**
   * Asks the user for access to a browser's data where the system protects
   * it (Safari's, on macOS), as Firefox does: a folder picker opens at the
   * folder to allow. Resolves to whether access was given.
   */
  async requestPermission(id, win) {
    let { migrator } = await findProfile(id);
    if (await migrator.hasPermissions()) {
      return true;
    }
    return migrator.getPermissions(win);
  },

  /**
   * Opens macOS's System Settings at Full Disk Access, the other way to let
   * the browser read Safari's data.
   */
  openFullDiskAccess() {
    if (Services.appinfo.OS != "Darwin") {
      throw new Error("Full Disk Access is macOS's.");
    }
    Cc["@mozilla.org/uriloader/external-protocol-service;1"]
      .getService(Ci.nsIExternalProtocolService)
      .loadURI(Services.io.newURI(FULL_DISK_ACCESS));
  },

  /**
   * Imports a file the user picks: "bookmarks" (an HTML or JSON bookmarks
   * file) into Firefox's bookmarks, or "passwords" (a CSV or TSV export)
   * into Firefox's password manager. Resolves to { count } (and for
   * passwords, { updated }: logins it already had), { canceled: true }, or
   * { error: "failed" } for a file it couldn't read.
   */
  fromFile(kind, win) {
    if (kind != "bookmarks" && kind != "passwords") {
      throw new TypeError('Expected "bookmarks" or "passwords".');
    }
    return oneAtATime(async () => {
      let path = await pickFile(
        win,
        kind == "bookmarks"
          ? [["Bookmarks (HTML, JSON)", "*.html; *.htm; *.json"]]
          : [["Passwords (CSV, TSV)", "*.csv; *.tsv"]]
      );
      if (!path) {
        return { canceled: true };
      }
      try {
        if (kind == "passwords") {
          let summary = await lazy.LoginCSVImport.importFromCSV(path);
          return {
            count: summary.filter(entry => entry.result == "added").length,
            updated: summary.filter(entry => entry.result == "modified").length,
          };
        }
        let count = /\.json$/i.test(path)
          ? await lazy.BookmarkJSONUtils.importFromFile(path)
          : await lazy.BookmarkHTMLUtils.importFromFile(path);
        return { count };
      } catch (e) {
        console.error("Neeko: couldn't import from a file.", e);
        return { error: "failed" };
      }
    });
  },
};
