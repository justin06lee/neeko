/**
 * The build's app step. It turns an app folder (a browser built on Neeko, or
 * Neeko's own demo app) into what Surfer and Firefox's build need. The
 * Makefile runs it; nothing else should need to.
 *
 *   bun tools/app.ts config   <app>   write surfer.json (before Surfer runs)
 *   bun tools/app.ts branding <app>   write the app's Firefox branding folder
 *                                     (after `surfer import`)
 *   bun tools/app.ts dist     <app>   copy a finished release into <app>/dist
 *   bun tools/app.ts install  <app>   Linux: install the packaged dev build for
 *                                     this user (after its stage-package)
 *   bun tools/app.ts uninstall <app>  Linux: remove it again, but the profile
 *
 * An app folder holds:
 *
 *   browser.json  name, vendor, appId and version (see readApp)
 *   ui/           the browser's UI: index.html and everything it loads
 *   pages/        optional: the browser's own pages, <name>.html as
 *                 about:<name> (start.html is the New Tab and home page)
 *
 * browser.json can also give the browser's look for what Firefox still
 * draws itself, its "theme" (see readTheme), which of Firefox's menus and
 * items to keep, its "menus" (see readMenus), and its "containers", one per
 * window (see readContainers).
 *   branding/     optional: icon.png (and icon.svg), prefs.js, and any
 *                 Firefox branding file to replace, at the same path
 *
 * Everything the app changes lands in one generated Firefox branding folder,
 * engine/browser/branding/release/, which the build selects with
 * --with-branding. Firefox's own files stay untouched.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
// Neeko's names for Firefox's menus and their items (plain data).
import { CONTEXT, MENUBAR } from "../src/browser/neeko/NeekoMenuNames.sys.mjs";

const NEEKO = resolve(import.meta.dir, "..");
const ENGINE = join(NEEKO, "engine");
// Surfer's name for the brand. It names the generated branding folder and, in
// release builds, the update channel.
const BRAND = "release";
const BRANDING = join(ENGINE, "browser/branding", BRAND);
// The generated folder starts as a copy of Firefox's unofficial branding, so
// anything an app doesn't provide keeps working.
const BASE_BRANDING = join(ENGINE, "browser/branding/unofficial");
// Branding files the app step reads itself rather than copying over.
const APP_BRANDING_INPUTS = new Set(["icon.png", "icon.svg", "prefs.js"]);

type App = {
  dir: string;
  name: string;
  displayName: string;
  vendor: string;
  appId: string;
  version: string;
  // browser.json's "theme", checked by readTheme.
  theme: Theme | null;
  // browser.json's "menus", checked by readMenus.
  menus: Menus | null;
  // browser.json's "containers", checked by readContainers.
  containers: Container[] | null;
};

type Container = {
  id: string;
  name: string;
  color?: string;
  picture?: string;
  ephemeral?: boolean;
  default?: boolean;
};

type Menus = {
  menubar?: Record<string, true | string[]>;
  context?: string[];
};

// The colors of one color scheme (see readTheme).
type Colors = Record<(typeof COLOR_NAMES)[number], string | undefined>;

type Theme = {
  font: { family: string; files: FontFile[] } | null;
  radius: number;
  dialogRadius: number;
  buttonHeight: number;
  light: Colors;
  dark: Colors;
};

type FontFile = { file: string; weight: string; style: string; unicodeRange: string | null };

// A theme's colors for each scheme: the first four are required.
const COLOR_NAMES = [
  "text",
  "surface",
  "primary",
  "onPrimary",
  "muted",
  "line",
  "field",
  "backdrop",
] as const;
const REQUIRED_COLORS = 4;

function fail(message: string): never {
  console.error(`neeko: ${message}`);
  process.exit(1);
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Reads and checks <app>/browser.json:
 *
 * - name: letters and digits. It names the program's profile folder
 *   (~/Library/Application Support/<name>) and its system integration.
 * - displayName (optional, defaults to name): what users see, spaces allowed.
 * - vendor: who makes it, as users see it. (Firefox's build fixes the
 *   internal vendor, part of the profile path on Windows and Linux, to
 *   "Mozilla"; the app's name still keeps its profiles apart from Firefox's.)
 * - appId: reverse-DNS id, used as the macOS bundle id (dev.neeko.demo).
 * - version: the browser's own version, shown in its About window. Firefox's
 *   version stays the engine version, so websites and add-ons see the Firefox
 *   release they're dealing with.
 */
function readApp(dir: string): App {
  let file = join(dir, "browser.json");
  if (!existsSync(file)) {
    fail(`no browser.json in ${dir}`);
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(read(file));
  } catch (e) {
    fail(`${file} is not valid JSON: ${(e as Error).message}`);
  }
  let field = (key: string, pattern: RegExp, rule: string, fallback?: string) => {
    let value = json[key] ?? fallback;
    if (typeof value != "string" || !pattern.test(value)) {
      fail(`${file}: "${key}" must be ${rule}`);
    }
    return value;
  };
  let name = field("name", /^[A-Za-z][A-Za-z0-9]{0,39}$/, "letters and digits, starting with a letter");
  let plain = /^[^"'`$\\\n]{1,64}$/;
  return {
    dir,
    name,
    displayName: field("displayName", plain, "a name without quotes or backslashes", name),
    vendor: field("vendor", plain, "a name without quotes or backslashes"),
    appId: field(
      "appId",
      /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z][A-Za-z0-9-]*)+$/,
      "a reverse-DNS id such as com.example.browser"
    ),
    version: field(
      "version",
      /^\d+\.\d+(\.\d+)?([-+][0-9A-Za-z.-]+)?$/,
      "a version such as 1.2.0"
    ),
    theme: json.theme === undefined ? null : readTheme(dir, file, json.theme),
    menus: json.menus === undefined ? null : readMenus(file, json.menus),
    containers: json.containers === undefined ? null : readContainers(file, json.containers),
  };
}

/**
 * Reads and checks browser.json's optional "containers": the browser's own
 * identities, one per window (NeekoContainers), that a new profile starts
 * with. The one marked "default" is Firefox's default context; "ephemeral"
 * ones live in private windows and keep nothing.
 *
 *   "containers": [
 *     { "id": "personal", "name": "Personal", "color": "#0ea5e9",
 *       "picture": "profiles/personal.svg", "default": true },
 *     { "id": "private", "name": "Private", "ephemeral": true }
 *   ]
 */
function readContainers(file: string, containers: unknown): Container[] {
  let where = (i: number, key?: string) =>
    `${file}: "containers[${i}]${key ? `.${key}` : ""}"`;
  if (!Array.isArray(containers) || !containers.length) {
    fail(`${file}: "containers" must be a list of containers`);
  }
  let ids = new Set<string>();
  let defaults = 0;
  let result = containers.map((entry, i) => {
    if (!entry || typeof entry != "object" || Array.isArray(entry)) {
      fail(`${where(i)} must be an object`);
    }
    let c = entry as Record<string, unknown>;
    for (let key of Object.keys(c)) {
      if (!["id", "name", "color", "picture", "ephemeral", "default"].includes(key)) {
        fail(`${where(i)} has an unknown key "${key}"`);
      }
    }
    if (typeof c.id != "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(c.id) || ids.has(c.id)) {
      fail(`${where(i, "id")} must be a new id: lowercase letters, digits and -`);
    }
    ids.add(c.id);
    if (typeof c.name != "string" || !c.name.trim() || c.name.length > 64) {
      fail(`${where(i, "name")} must be 1 to 64 characters`);
    }
    if (
      c.color !== undefined &&
      (typeof c.color != "string" ||
        !/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,30}|[a-z]{3,6}\([0-9a-zA-Z.,%/ +-]{1,80}\))$/.test(c.color))
    ) {
      fail(`${where(i, "color")} must be a CSS color such as "#0ea5e9"`);
    }
    if (c.picture !== undefined && (typeof c.picture != "string" || c.picture.length > 256)) {
      fail(`${where(i, "picture")} must be a string (the app's own, such as a path)`);
    }
    for (let key of ["ephemeral", "default"]) {
      if (c[key] !== undefined && typeof c[key] != "boolean") {
        fail(`${where(i, key)} must be true or false`);
      }
    }
    if (c.default) {
      if (c.ephemeral) {
        fail(`${where(i)}: the default container can't be ephemeral`);
      }
      defaults++;
    }
    return c as Container;
  });
  if (defaults > 1) {
    fail(`${file}: only one of "containers" can be the default`);
  }
  return result;
}

/**
 * Reads and checks browser.json's optional "menus": which of Firefox's menus
 * and items to keep, in Neeko's names (src/browser/neeko/NeekoMenuNames.sys.mjs,
 * listed in docs/api.md). NeekoMenus hides the rest.
 *
 *   "menus": {
 *     "menubar": { "file": ["newTab", "closeTab"], "edit": true, "window": true },
 *     "context": ["back", "forward", "reload", "copy", "copyLink"]
 *   }
 *
 * In the menu bar, true keeps a menu whole; menus not named are hidden.
 */
function readMenus(file: string, menus: unknown): Menus {
  let where = (key: string) => `${file}: "menus${key ? `.${key}` : ""}"`;
  let isObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value == "object" && !Array.isArray(value);
  let names = (value: unknown, key: string, known: Record<string, unknown>) => {
    if (!Array.isArray(value) || value.some(name => typeof name != "string")) {
      fail(`${where(key)} must be a list of names`);
    }
    for (let name of value as string[]) {
      if (!Object.hasOwn(known, name)) {
        fail(`${where(key)} has an unknown name "${name}" (known: ${Object.keys(known).join(", ")})`);
      }
    }
    return value as string[];
  };
  if (!isObject(menus)) {
    fail(`${where("")} must be an object`);
  }
  let result: Menus = {};
  for (let key of Object.keys(menus)) {
    if (key != "menubar" && key != "context") {
      fail(`${where("")} has an unknown key "${key}" (known: menubar, context)`);
    }
  }
  if (menus.menubar !== undefined) {
    if (!isObject(menus.menubar)) {
      fail(`${where("menubar")} must be an object, such as { "file": true }`);
    }
    result.menubar = {};
    for (let [name, keep] of Object.entries(menus.menubar)) {
      let menu = (MENUBAR as Record<string, { items?: Record<string, unknown> }>)[name];
      if (!menu) {
        fail(`${where("menubar")} has an unknown menu "${name}" (known: ${Object.keys(MENUBAR).join(", ")})`);
      }
      if (keep === true) {
        result.menubar[name] = true;
      } else if (!menu.items) {
        fail(`${where(`menubar.${name}`)} can only be true: it's kept whole or not at all`);
      } else {
        result.menubar[name] = names(keep, `menubar.${name}`, menu.items);
      }
    }
  }
  if (menus.context !== undefined) {
    result.context = names(menus.context, "context", CONTEXT);
  }
  return result;
}

/**
 * Reads and checks browser.json's optional "theme": the browser's look for
 * what Firefox still draws itself (its dialogs, panels and bars), which
 * Neeko maps onto Firefox's own styles (src/browser/neeko/neeko-theme*.css).
 * Only these values, never CSS aimed at Firefox's elements:
 *
 *   "theme": {
 *     "font": { "family": "Poppins", "files": [
 *       { "file": "fonts/poppins-400.woff2", "weight": 400 }, ... ] },
 *     "radius": 12,           panels, bars, buttons and fields (px; 8)
 *     "dialogRadius": 16,     a page's dialogs (px; radius + 4 by default)
 *     "buttonHeight": 36,     (px; 32, Firefox's, by default)
 *     "light": { "text", "surface", "primary", "onPrimary",
 *                "muted", "line", "field", "backdrop" },
 *     "dark":  { ...the same }
 *   }
 *
 * Colors are CSS colors; text, surface, primary (the main button) and
 * onPrimary (its text) are required, the rest are made from them. Font files
 * are paths in the app folder; without "files", the family must be
 * installed. Every value is checked, so nothing but a value reaches the CSS.
 */
function readTheme(dir: string, file: string, theme: unknown): Theme {
  let where = (key: string) => `${file}: "theme${key ? `.${key}` : ""}"`;
  let object = (value: unknown, key: string) => {
    if (!value || typeof value != "object" || Array.isArray(value)) {
      fail(`${where(key)} must be an object`);
    }
    return value as Record<string, unknown>;
  };
  let known = (value: Record<string, unknown>, key: string, names: readonly string[]) => {
    for (let name of Object.keys(value)) {
      if (!names.includes(name)) {
        fail(`${where(key)} has an unknown key "${name}" (known: ${names.join(", ")})`);
      }
    }
  };
  let pixels = (value: unknown, key: string, min: number, max: number) => {
    if (typeof value != "number" || !Number.isFinite(value) || value < min || value > max) {
      fail(`${where(key)} must be a number of pixels from ${min} to ${max}`);
    }
    return value;
  };

  let t = object(theme, "");
  known(t, "", ["font", "radius", "dialogRadius", "buttonHeight", "light", "dark"]);

  let colors = (scheme: "light" | "dark"): Colors => {
    let c = object(t[scheme], scheme);
    known(c, scheme, COLOR_NAMES);
    let result = {} as Colors;
    COLOR_NAMES.forEach((name, i) => {
      let value = c[name];
      if (value === undefined && i >= REQUIRED_COLORS) {
        return;
      }
      // Hex, a named color or a color function of numbers: nothing that
      // could end the declaration it goes in.
      if (
        typeof value != "string" ||
        !/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,30}|[a-z]{3,6}\([0-9a-zA-Z.,%/ +-]{1,80}\))$/.test(value.trim())
      ) {
        fail(`${where(`${scheme}.${name}`)} must be a CSS color such as "#171717" or "rgba(0, 0, 0, 0.07)"`);
      }
      result[name] = value.trim();
    });
    return result;
  };

  let font: Theme["font"] = null;
  if (t.font !== undefined) {
    let f = object(t.font, "font");
    known(f, "font", ["family", "files"]);
    if (typeof f.family != "string" || !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/.test(f.family)) {
      fail(`${where("font.family")} must be a font's name: letters, digits, spaces, - and _`);
    }
    let files: FontFile[] = [];
    if (f.files !== undefined) {
      if (!Array.isArray(f.files) || !f.files.length) {
        fail(`${where("font.files")} must be a list of { "file", "weight" }`);
      }
      f.files.forEach((entry, i) => {
        let key = `font.files[${i}]`;
        let e = object(entry, key);
        known(e, key, ["file", "weight", "style", "unicodeRange"]);
        if (
          typeof e.file != "string" ||
          !/^[\w.@+\/-]+\.(woff2|woff|ttf|otf)$/.test(e.file) ||
          e.file.split("/").includes("..") ||
          !existsSync(join(dir, e.file))
        ) {
          fail(`${where(`${key}.file`)} must be a .woff2, .woff, .ttf or .otf file in the app folder`);
        }
        let weight = e.weight ?? 400;
        if (!Number.isInteger(weight) || (weight as number) < 1 || (weight as number) > 1000) {
          fail(`${where(`${key}.weight`)} must be a font weight from 1 to 1000`);
        }
        let style = e.style ?? "normal";
        if (style != "normal" && style != "italic") {
          fail(`${where(`${key}.style`)} must be "normal" or "italic"`);
        }
        let range = e.unicodeRange ?? null;
        if (range !== null && (typeof range != "string" || !/^[Uu]\+[0-9A-Fa-f?]+(-[0-9A-Fa-f]+)?(, *[Uu]\+[0-9A-Fa-f?]+(-[0-9A-Fa-f]+)?)*$/.test(range))) {
          fail(`${where(`${key}.unicodeRange`)} must be a CSS unicode-range such as "U+0000-00FF, U+0131"`);
        }
        files.push({ file: e.file, weight: String(weight), style, unicodeRange: range });
      });
    }
    font = { family: f.family, files };
  }

  let radius = t.radius === undefined ? 8 : pixels(t.radius, "radius", 0, 32);
  return {
    font,
    radius,
    dialogRadius: t.dialogRadius === undefined ? radius + 4 : pixels(t.dialogRadius, "dialogRadius", 0, 40),
    buttonHeight: t.buttonHeight === undefined ? 32 : pixels(t.buttonHeight, "buttonHeight", 20, 64),
    light: colors("light"),
    dark: colors("dark"),
  };
}

function firefoxVersion(): string {
  let version = JSON.parse(read(join(NEEKO, "neeko.json"))).firefox;
  if (!/^\d+\.\d+(\.\d+)?$/.test(version ?? "")) {
    fail(`neeko.json: "firefox" must be a Firefox release version such as 156.0.1`);
  }
  return version;
}

/** Writes a file only if its contents change, so builds don't redo work. */
function writeIfChanged(path: string, contents: string | Buffer) {
  if (existsSync(path) && readFileSync(path).equals(Buffer.from(contents))) {
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

/** Every file under a folder, as paths relative to it, skipping dotfiles. */
function listFiles(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => !entry.name.startsWith("."))
    .flatMap(entry => {
      let path = join(dir, entry.name);
      return entry.isDirectory() ? listFiles(root, path) : [relative(root, path)];
    });
}

/**
 * Makes `target` match `source`: copies new and changed files, deletes the
 * rest. Unchanged files keep their timestamps, so the build skips them.
 */
function sync(source: string, target: string) {
  let wanted = new Set(listFiles(source));
  for (let path of wanted) {
    writeIfChanged(join(target, path), readFileSync(join(source, path)));
  }
  if (existsSync(target)) {
    for (let path of listFiles(target)) {
      if (!wanted.has(path)) {
        rmSync(join(target, path));
      }
    }
  }
}

function run(command: string, args: string[], cwd?: string) {
  let result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status != 0) {
    fail(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// config: surfer.json

function writeSurferConfig(app: App) {
  let firefox = firefoxVersion();
  let config = {
    name: app.name,
    vendor: app.vendor,
    appId: app.appId,
    // Artifact builds use Mozilla's prebuilt program, which is named firefox.
    binaryName: "firefox",
    version: { product: "firefox", version: firefox },
    buildOptions: { windowsUseSymbolicLinks: false },
    addons: {},
    brands: {
      [BRAND]: {
        backgroundColor: "#2B2A33",
        brandShorterName: app.displayName,
        brandShortName: app.displayName,
        brandFullName: app.displayName,
        // Surfer writes this into Firefox's own version files. Keep those at
        // Firefox's version: the app's version goes in through the branding
        // folder instead (--with-version-file-path).
        release: { displayVersion: firefox },
      },
    },
    license: { ignoredFiles: [".*\\.json"], licenseType: "MPL-2.0" },
  };
  writeIfChanged(join(NEEKO, "surfer.json"), JSON.stringify(config, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// branding: engine/browser/branding/release/

function writeNames(app: App, out: string) {
  let bundleId = app.appId.split(".").pop();
  writeFileSync(
    join(out, "configure.sh"),
    `# Generated by Neeko's tools/app.ts from ${app.dir}/browser.json.\n` +
      `MOZ_APP_DISPLAYNAME=${shellQuote(app.displayName)}\n` +
      `MOZ_MACBUNDLE_ID=${bundleId}\n`
  );
  let ftl = join(out, "locales/en-US/brand.ftl");
  let names: Record<string, string> = {
    "-brand-shorter-name": app.displayName,
    "-brand-short-name": app.displayName,
    "-brand-shortcut-name": app.displayName,
    "-brand-full-name": app.displayName,
    "-brand-product-name": app.displayName,
    "-vendor-short-name": app.vendor,
  };
  writeFileSync(
    ftl,
    read(ftl).replace(/^(-[a-z-]+) = .*$/gm, (line, key) =>
      key in names ? `${key} = ${names[key]}` : line
    )
  );
  let properties = join(out, "locales/en-US/brand.properties");
  writeFileSync(
    properties,
    read(properties).replace(/^(brand\w*Name)=.*$/gm, `$1=${app.displayName}`)
  );
}

/**
 * The app's default prefs. firefox-branding.js is the last default pref file
 * Firefox reads, after Neeko's firefox-neeko*.js files, so the app's prefs
 * win over Neeko's and Firefox's.
 */
function writePrefs(app: App, out: string) {
  let file = join(out, "pref/firefox-branding.js");
  let prefs = join(app.dir, "branding/prefs.js");
  writeFileSync(
    file,
    read(file) +
      "\n// ---- The browser's own prefs, from branding/prefs.js (added by Neeko's tools/app.ts) ----\n\n" +
      (existsSync(prefs) ? read(prefs) : "")
  );
}

/** Any other file in the app's branding/ replaces Firefox's at the same path. */
function copyBrandingFiles(app: App, out: string) {
  let dir = join(app.dir, "branding");
  if (!existsSync(dir)) {
    return;
  }
  for (let path of listFiles(dir)) {
    if (APP_BRANDING_INPUTS.has(path) || /^readme/i.test(path)) {
      continue;
    }
    if (!existsSync(join(BASE_BRANDING, path))) {
      console.warn(`neeko: branding/${path} isn't a Firefox branding file, so nothing uses it.`);
      continue;
    }
    cpSync(join(dir, path), join(out, path));
  }
}

// Files made from the app's icon: the macOS app icon (on macOS), window
// icons (Linux takes them from the app; `make install` puts them in the icon
// theme too), and the logo on Firefox's own pages.
const MAC_ICON_FILES = ["firefox.icns", "Assets.car"];
const ICON_SIZES = [16, 22, 24, 32, 48, 64, 128, 256];
const ICON_FILES = [
  ...(process.platform == "darwin" ? MAC_ICON_FILES : []),
  ...ICON_SIZES.map(size => `default${size}.png`),
  "content/about-logo.png",
  "content/about-logo@2x.png",
  "content/about-logo.svg",
];
// Generated icons, one folder per version of the app's icon, so a rebuild
// with the same icon doesn't make them again.
const ICON_CACHE = join(ENGINE, ".neeko-cache/icons");

/**
 * Makes the app icon (macOS app icon, window icons, the logo on Firefox's
 * own pages) from branding/icon.png, a square PNG of at least 1024 pixels.
 * branding/icon.svg, if there, is used where Firefox wants an SVG logo.
 * macOS has the tools for it; on Linux, ImageMagick does the resizing.
 */
function writeIcons(app: App, out: string) {
  let png = join(app.dir, "branding/icon.png");
  if (!existsSync(png)) {
    return;
  }
  let svg = join(app.dir, "branding/icon.svg");
  let hash = createHash("sha256")
    .update(readFileSync(png))
    .update(existsSync(svg) ? readFileSync(svg) : "")
    .digest("hex");
  let cache = join(ICON_CACHE, hash);
  if (!ICON_FILES.every(file => existsSync(join(cache, file)))) {
    let resize = resizer(png);
    if (!resize) {
      console.warn(
        process.platform == "linux"
          ? "neeko: install ImageMagick (apt install imagemagick) for the app's icons; keeping Firefox's."
          : "neeko: app icons are only made on macOS and Linux; keeping Firefox's."
      );
      return;
    }
    rmSync(ICON_CACHE, { recursive: true, force: true });
    makeIcons(resize, png, svg, cache);
  }
  for (let file of ICON_FILES) {
    cpSync(join(cache, file), join(out, file));
  }
}

type Resize = (size: number, to: string) => void;

/**
 * What resizes the app's icon here: macOS's sips, or ImageMagick (its
 * `magick` or, before version 7, `convert`). Null if there's none.
 */
function resizer(png: string): Resize | null {
  if (process.platform == "darwin") {
    return (size, to) => run("sips", ["-z", `${size}`, `${size}`, png, "--out", to]);
  }
  let magick = ["magick", "convert"].find(
    tool => spawnSync(tool, ["-version"], { stdio: "ignore" }).status == 0
  );
  if (process.platform != "linux" || !magick) {
    return null;
  }
  // PNG32: full color with transparency, whatever the source's format.
  return (size, to) => run(magick, [png, "-resize", `${size}x${size}`, "-strip", `PNG32:${to}`]);
}

function makeIcons(resize: Resize, png: string, svg: string, out: string) {
  let work = mkdtempSync(join(tmpdir(), "neeko-icon-"));
  mkdirSync(join(out, "content"), { recursive: true });
  try {
    if (process.platform == "darwin") {
      makeMacIcons(resize, work, out);
    }
    for (let size of ICON_SIZES) {
      resize(size, join(out, `default${size}.png`));
    }
    resize(192, join(out, "content/about-logo.png"));
    resize(384, join(out, "content/about-logo@2x.png"));
    if (existsSync(svg)) {
      cpSync(svg, join(out, "content/about-logo.svg"));
    } else {
      let data = readFileSync(join(out, "content/about-logo@2x.png")).toString("base64");
      writeFileSync(
        join(out, "content/about-logo.svg"),
        `<svg xmlns="http://www.w3.org/2000/svg" width="384" height="384">` +
          `<image width="384" height="384" href="data:image/png;base64,${data}"/></svg>\n`
      );
    }
  } catch (e) {
    rmSync(out, { recursive: true, force: true });
    throw e;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * firefox.icns (older macOS) and Assets.car (current macOS, which looks for
 * the "AppIcon" in it first).
 */
function makeMacIcons(resize: Resize, work: string, out: string) {
  let iconset = join(work, "icon.iconset");
  let appiconset = join(work, "Icon.xcassets/AppIcon.appiconset");
  mkdirSync(iconset, { recursive: true });
  mkdirSync(appiconset, { recursive: true });
  let images = [];
  for (let size of [16, 32, 128, 256, 512]) {
    for (let scale of [1, 2]) {
      let name = `icon_${size}x${size}${scale == 2 ? "@2x" : ""}.png`;
      resize(size * scale, join(iconset, name));
      cpSync(join(iconset, name), join(appiconset, name));
      images.push({ idiom: "mac", size: `${size}x${size}`, scale: `${scale}x`, filename: name });
    }
  }
  let info = { version: 1, author: "neeko" };
  writeFileSync(join(appiconset, "Contents.json"), JSON.stringify({ images, info }));
  writeFileSync(join(work, "Icon.xcassets/Contents.json"), JSON.stringify({ info }));
  run("iconutil", ["-c", "icns", iconset, "-o", join(out, "firefox.icns")]);
  run("xcrun", [
    "actool", "--compile", work, "--platform", "macosx",
    "--minimum-deployment-target", "10.15", "--app-icon", "AppIcon",
    "--output-partial-info-plist", join(work, "partial.plist"),
    join(work, "Icon.xcassets"),
  ]);
  cpSync(join(work, "Assets.car"), join(out, "Assets.car"));
}

/**
 * Puts the app's UI inside the app, at chrome://neeko-ui/content/, where
 * NeekoWindow finds it when the neeko.ui.path pref is empty (packaged
 * browsers). Dev launches point neeko.ui.path at the app's ui/ folder
 * instead, so UI changes only need a relaunch.
 */
function writeUI(app: App, out: string) {
  let dir = join(app.dir, "ui");
  if (!existsSync(join(dir, "index.html"))) {
    console.warn(`neeko: no ui/index.html in ${app.dir}, so this build shows Firefox's own UI.`);
    return;
  }
  let files = listFiles(dir);
  for (let path of files) {
    if (!/^[\w.@+\/-]+$/.test(path)) {
      fail(`ui/${path}: file names in ui/ may only use letters, digits and . _ - @ +`);
    }
  }
  cpSync(dir, join(out, "ui"), { recursive: true, filter: src => !/\/\.[^/]*$/.test(src) });
  writeFileSync(
    join(out, "ui/moz.build"),
    "# Generated by Neeko's tools/app.ts: the app's UI, bundled at chrome://neeko-ui/content/.\n" +
      'JAR_MANIFESTS += ["jar.mn"]\n'
  );
  writeFileSync(
    join(out, "ui/jar.mn"),
    "# Generated by Neeko's tools/app.ts from the app's ui/ folder.\n" +
      "browser.jar:\n" +
      "% content neeko-ui %content/neeko-ui/\n" +
      files.map(path => `  content/neeko-ui/${path} (${path})\n`).join("")
  );
  addBuildDir(out, "ui");
}

/** Adds one of the generated branding folder's folders to Firefox's build. */
function addBuildDir(out: string, name: string) {
  let mozBuild = join(out, "moz.build");
  let before = read(mozBuild);
  let after = before.replace(/DIRS \+= \[([^\]]*)\]/, (_, dirs) => `DIRS += [${dirs}, "${name}"]`);
  if (after == before) {
    fail(`couldn't add ${name}/ to ${mozBuild}; Firefox's branding moz.build changed.`);
  }
  writeFileSync(mozBuild, after);
}

/**
 * Puts the app's own pages inside the app, at chrome://neeko-pages/content/,
 * which the pages themselves may read (contentaccessible: they run as web
 * content), and names them in the neeko.pages.names pref, so NeekoPages
 * serves pages/<name>.html as about:<name>. Dev launches point
 * neeko.pages.path at the app's pages/ folder instead.
 */
function writePages(app: App, out: string) {
  let dir = join(app.dir, "pages");
  if (!existsSync(dir)) {
    return;
  }
  let files = listFiles(dir);
  for (let path of files) {
    if (!/^[\w.@+\/-]+$/.test(path)) {
      fail(`pages/${path}: file names in pages/ may only use letters, digits and . _ - @ +`);
    }
  }
  let names = files
    .filter(path => /^[a-z0-9-]+\.html$/.test(path))
    .map(path => path.slice(0, -".html".length));
  cpSync(dir, join(out, "pages"), { recursive: true, filter: src => !/\/\.[^/]*$/.test(src) });
  writeFileSync(
    join(out, "pages/moz.build"),
    "# Generated by Neeko's tools/app.ts: the app's pages, bundled at chrome://neeko-pages/content/.\n" +
      'JAR_MANIFESTS += ["jar.mn"]\n'
  );
  writeFileSync(
    join(out, "pages/jar.mn"),
    "# Generated by Neeko's tools/app.ts from the app's pages/ folder.\n" +
      "browser.jar:\n" +
      "% content neeko-pages %content/neeko-pages/ contentaccessible=yes\n" +
      files.map(path => `  content/neeko-pages/${path} (${path})\n`).join("")
  );
  addBuildDir(out, "pages");
  let prefs = join(out, "pref/firefox-branding.js");
  writeFileSync(
    prefs,
    read(prefs) +
      "\n// The app's own pages, pages/<name>.html as about:<name> (added by Neeko's tools/app.ts).\n" +
      `pref("neeko.pages.names", ${JSON.stringify(names.join(","))});\n`
  );
}

/**
 * The app's theme (browser.json's "theme", see readTheme) as CSS custom
 * properties, --neeko-theme-*, with its font files, bundled at
 * chrome://neeko-theme/content/. NeekoTheme finds it there and loads it,
 * with Neeko's own sheets that map these values onto Firefox's styles, into
 * browser windows and Firefox's dialogs. Each color is light-dark(), so it
 * follows the color scheme wherever it's used.
 */
function writeTheme(app: App, out: string) {
  let theme = app.theme;
  if (!theme) {
    return;
  }
  let dir = join(out, "theme");
  mkdirSync(join(dir, "fonts"), { recursive: true });
  let files = ["theme.css"];
  let css = [
    `/* Generated by Neeko's tools/app.ts from ${app.dir}/browser.json ("theme"). */`,
    "",
  ];
  theme.font?.files.forEach((font, i) => {
    let name = `fonts/${i}-${font.file.split("/").pop()}`;
    cpSync(join(app.dir, font.file), join(dir, name));
    files.push(name);
    let format = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" }[
      font.file.split(".").pop()!
    ];
    css.push(
      "@font-face {",
      `  font-family: "${theme.font!.family}";`,
      `  font-weight: ${font.weight};`,
      `  font-style: ${font.style};`,
      `  src: url("${name}") format("${format}");`,
      ...(font.unicodeRange ? [`  unicode-range: ${font.unicodeRange};`] : []),
      "}",
      ""
    );
  });
  // The optional colors, made from the required ones.
  let derived = (colors: Colors, scheme: "light" | "dark"): Colors => ({
    ...colors,
    muted: colors.muted ?? `color-mix(in srgb, ${colors.text} 60%, transparent)`,
    line: colors.line ?? `color-mix(in srgb, ${colors.text} 12%, transparent)`,
    field: colors.field ?? `color-mix(in srgb, ${colors.text} 5%, transparent)`,
    backdrop: colors.backdrop ?? (scheme == "light" ? "rgba(0, 0, 0, 0.25)" : "rgba(0, 0, 0, 0.5)"),
  });
  let light = derived(theme.light, "light");
  let dark = derived(theme.dark, "dark");
  let kebab = (name: string) => name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
  css.push(":root {");
  for (let name of COLOR_NAMES) {
    css.push(`  --neeko-theme-${kebab(name)}: light-dark(${light[name]}, ${dark[name]});`);
  }
  css.push(`  --neeko-theme-radius: ${theme.radius}px;`);
  css.push(`  --neeko-theme-dialog-radius: ${theme.dialogRadius}px;`);
  css.push(`  --neeko-theme-button-height: ${theme.buttonHeight}px;`);
  // Without a font, the system's, which is what Firefox uses.
  css.push(`  --neeko-theme-font: ${theme.font ? `"${theme.font.family}", ` : ""}system-ui, sans-serif;`);
  css.push("}", "");
  writeFileSync(join(dir, "theme.css"), css.join("\n"));
  writeFileSync(
    join(dir, "moz.build"),
    "# Generated by Neeko's tools/app.ts: the app's theme, bundled at chrome://neeko-theme/content/.\n" +
      'JAR_MANIFESTS += ["jar.mn"]\n'
  );
  writeFileSync(
    join(dir, "jar.mn"),
    "# Generated by Neeko's tools/app.ts from the app's browser.json.\n" +
      "browser.jar:\n" +
      "% content neeko-theme %content/neeko-theme/\n" +
      files.map(path => `  content/neeko-theme/${path} (${path})\n`).join("")
  );
  addBuildDir(out, "theme");
}

/**
 * The app's menus (browser.json's "menus", see readMenus) in the neeko.menus
 * pref, where NeekoMenus reads them.
 */
function writeMenus(app: App, out: string) {
  if (!app.menus) {
    return;
  }
  let prefs = join(out, "pref/firefox-branding.js");
  writeFileSync(
    prefs,
    read(prefs) +
      "\n// The app's menus, from browser.json (added by Neeko's tools/app.ts).\n" +
      `pref("neeko.menus", ${JSON.stringify(JSON.stringify(app.menus))});\n`
  );
}

/**
 * The app's containers (browser.json's "containers", see readContainers) in
 * the neeko.containers.builtin pref, where NeekoContainers finds them for a
 * new profile. A browser with containers of its own shows no sign of
 * Firefox's: its container menus, tab indicator and settings go.
 */
function writeContainers(app: App, out: string) {
  if (!app.containers) {
    return;
  }
  let prefs = join(out, "pref/firefox-branding.js");
  writeFileSync(
    prefs,
    read(prefs) +
      "\n// The app's containers, from browser.json (added by Neeko's tools/app.ts).\n" +
      `pref("neeko.containers.builtin", ${JSON.stringify(JSON.stringify(app.containers))});\n` +
      'pref("privacy.userContext.ui.enabled", false);\n'
  );
}

/**
 * The app's version files and build options. configs/common/mozconfig reads
 * app.mozconfig, so the program is named after the app and the profile
 * folder is its own.
 */
function writeBuildSettings(app: App, out: string) {
  writeFileSync(join(out, "version.txt"), firefoxVersion() + "\n");
  writeFileSync(join(out, "version_display.txt"), app.version + "\n");
  let distributionId = app.appId.split(".").slice(0, -1).join(".");
  writeFileSync(
    join(out, "app.mozconfig"),
    [
      `# Generated by Neeko's tools/app.ts from ${app.dir}/browser.json.`,
      `ac_add_options --with-app-basename=${app.name}`,
      `ac_add_options --with-distribution-id=${distributionId}`,
      `ac_add_options --with-version-file-path=browser/branding/${BRAND}`,
      "",
    ].join("\n")
  );
}

function writeBranding(app: App) {
  if (!existsSync(BASE_BRANDING)) {
    fail("there's no Firefox source in engine/ yet. Run `make` in Neeko first.");
  }
  let out = mkdtempSync(join(tmpdir(), "neeko-branding-"));
  try {
    cpSync(BASE_BRANDING, out, { recursive: true });
    writeNames(app, out);
    writePrefs(app, out);
    writeIcons(app, out);
    // After the icons, so a file the app made by hand wins over a generated one.
    copyBrandingFiles(app, out);
    writeUI(app, out);
    writePages(app, out);
    writeTheme(app, out);
    writeMenus(app, out);
    writeContainers(app, out);
    writeBuildSettings(app, out);
    sync(out, BRANDING);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
  // Keep engine/'s own git status clean, as Surfer does for Neeko's files.
  let gitignore = join(ENGINE, ".gitignore");
  for (let entry of [`browser/branding/${BRAND}/`, ".neeko-cache/"]) {
    if (!read(gitignore).split("\n").includes(entry)) {
      appendFileSync(gitignore, `\n${entry}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// dist: <app>/dist/

/**
 * Copies the packaged release build into <app>/dist, named after the app: a
 * .app and a disk image on macOS, the program's archive on Linux.
 */
function copyRelease(app: App) {
  if (process.platform == "linux") {
    copyLinuxRelease(app);
    return;
  }
  let dist = join(ENGINE, "obj-release/dist");
  let apps = existsSync(join(dist, "firefox"))
    ? readdirSync(join(dist, "firefox")).filter(name => name.endsWith(".app"))
    : [];
  let images = existsSync(dist) ? readdirSync(dist).filter(name => name.endsWith(".dmg")) : [];
  if (apps.length != 1 || images.length != 1) {
    fail(`expected one packaged app and one disk image in ${dist}; run \`make release\`.`);
  }
  let target = join(app.dir, "dist");
  mkdirSync(target, { recursive: true });
  let bundle = join(target, `${app.displayName}.app`);
  let image = join(target, `${app.name}-${app.version}.dmg`);
  rmSync(bundle, { recursive: true, force: true });
  // ditto keeps the app bundle's symlinks, permissions and signature intact.
  run("ditto", [join(dist, "firefox", apps[0]), bundle]);
  cpSync(join(dist, images[0]), image);
  console.log(`neeko: ${relative(process.cwd(), bundle)}\nneeko: ${relative(process.cwd(), image)}`);
}

function copyLinuxRelease(app: App) {
  let dist = join(ENGINE, "obj-release/dist");
  let archives = existsSync(dist)
    ? readdirSync(dist).filter(name => /^firefox-.*\.tar\.(xz|bz2)$/.test(name))
    : [];
  if (archives.length != 1) {
    fail(`expected one packaged archive in ${dist}; run \`make release\`.`);
  }
  let target = join(app.dir, "dist");
  mkdirSync(target, { recursive: true });
  let archive = join(
    target,
    `${app.name}-${app.version}-linux-${machine()}.${archives[0].replace(/.*\.(tar\.\w+)$/, "$1")}`
  );
  cpSync(join(dist, archives[0]), archive);
  console.log(`neeko: ${relative(process.cwd(), archive)}`);
}

/** This computer's architecture, as Linux names it. */
function machine(): string {
  return { arm64: "aarch64", x64: "x86_64" }[process.arch as string] ?? process.arch;
}

// ---------------------------------------------------------------------------
// install, uninstall: the app for this user, on Linux

// The first line of what the installer writes, so it only ever replaces or
// removes its own files.
const INSTALLED_BY = "Installed by Neeko's `make install`";

/**
 * Where `make install` puts an app, for this user: the program (replaced by
 * each install), a launcher on the PATH, a desktop entry and icons. Its
 * profiles are Firefox's to keep, in the app's own folder (profileRoot).
 */
function installPaths(app: App) {
  let home = homedir();
  let xdg = (name: string, fallback: string) => {
    let value = process.env[name];
    return value?.startsWith("/") ? value : join(home, fallback);
  };
  let data = xdg("XDG_DATA_HOME", ".local/share");
  let program = join(data, app.name.toLowerCase(), "app");
  // Firefox's: ~/.<vendor>/<name> where that's there already, otherwise
  // under XDG_CONFIG_HOME. The vendor is always Mozilla (see using-neeko.md).
  let legacy = join(home, ".mozilla", app.name.toLowerCase());
  return {
    program,
    appIni: join(program, "browser/application.ini"),
    launcher: join(home, ".local/bin", app.name.toLowerCase()),
    desktop: join(data, "applications", `${app.appId}.desktop`),
    icons: join(data, "icons/hicolor"),
    profileRoot: existsSync(legacy)
      ? legacy
      : join(xdg("XDG_CONFIG_HOME", ".config"), "mozilla", app.name.toLowerCase()),
  };
}

function checkLinux(what: string) {
  if (process.platform != "linux") {
    fail(`${what} is for Linux. On macOS, \`make release\` makes the app in dist/.`);
  }
}

/** A file the installer wrote, which it may replace or remove. */
function isOurs(path: string): boolean {
  return existsSync(path) && read(path).split("\n", 3).some(line => line.includes(INSTALLED_BY));
}

function writeOurs(path: string, contents: string, mode: number) {
  if (existsSync(path) && !isOurs(path)) {
    fail(`${path} is there already, and not from \`make install\`: move it away first.`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { mode });
  chmodSync(path, mode);
}

/**
 * The app's identity for the prebuilt program, which carries Firefox's
 * (name, profile folder, crash reporter): the build's own application.ini
 * (the app's name, no crash reporter), named for the desktop by its
 * RemotingName, the app id, which Firefox gives its windows, notifications,
 * media controls and D-Bus name. The launcher hands it to the program with
 * -app, which takes it from the browser/ folder, where the app's files are.
 */
function appIni(app: App, built: string): string {
  let lines = built.split("\n");
  // Only the [App], [Gecko] and [XRE] sections: none for a crash reporter.
  let keep = false;
  let out: string[] = [`; ${INSTALLED_BY}, from the build's application.ini.`];
  for (let line of lines) {
    let section = line.match(/^\[(.*)\]\s*$/);
    if (section) {
      keep = ["App", "Gecko", "XRE"].includes(section[1]);
    }
    if (keep && !/^RemotingName=/.test(line)) {
      out.push(line);
      if (section?.[1] == "App") {
        out.push(`RemotingName=${app.appId}`);
      }
    }
  }
  if (!out.some(line => /^Name=/.test(line))) {
    fail("the build's application.ini has no [App] Name.");
  }
  return out.join("\n").trimEnd() + "\n";
}

/**
 * Installs the app from the dev build, packaged (`make install` runs
 * browser/installer's stage-package first), as the app: the launcher runs the prebuilt
 * program with the app's application.ini (appIni), so its profiles, windows
 * and everything it tells the desktop are the app's, never Firefox's.
 */
function install(app: App) {
  checkLinux("make install");
  let packages = globDirs(ENGINE, /^obj-(?!release$)/, "dist/firefox").filter(dir =>
    existsSync(join(dir, "firefox"))
  );
  if (!packages.length) {
    fail("no packaged build in engine/obj-*/dist/firefox: run `make install`, not this script.");
  }
  let source = packages.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  let paths = installPaths(app);
  if (isRunning(paths.program)) {
    console.warn(`neeko: ${app.displayName} is running: restart it for the new version.`);
  }

  // The program: copied next to the old one, then swapped in.
  let fresh = `${paths.program}.new`;
  let old = `${paths.program}.old`;
  rmSync(fresh, { recursive: true, force: true });
  rmSync(old, { recursive: true, force: true });
  mkdirSync(dirname(paths.program), { recursive: true });
  run("cp", ["-a", source, fresh]);
  writeFileSync(
    join(fresh, "browser/application.ini"),
    appIni(app, read(join(fresh, "application.ini")))
  );
  if (existsSync(paths.program)) {
    renameSync(paths.program, old);
  }
  renameSync(fresh, paths.program);
  rmSync(old, { recursive: true, force: true });

  writeOurs(
    paths.launcher,
    [
      "#!/bin/sh",
      `# ${INSTALLED_BY}, from ${app.dir}. Runs ${app.displayName}`,
      "# as itself (-app: its name, profiles and desktop identity, not the",
      "# prebuilt program's Firefox ones), with this launcher as the command to",
      "# open links with once it's the default browser.",
      `export MOZ_APP_LAUNCHER=${shellQuote(paths.launcher)}`,
      `exec ${shellQuote(join(paths.program, "firefox"))} -app ${shellQuote(paths.appIni)} ` +
        `--class ${shellQuote(app.appId)} "$@"`,
      "",
    ].join("\n"),
    0o755
  );

  // The icons Firefox shows on the app's windows (writeIcons), in the icon
  // theme for the desktop.
  let icons = 0;
  for (let size of ICON_SIZES) {
    let icon = join(BRANDING, `default${size}.png`);
    if (existsSync(icon)) {
      let to = join(paths.icons, `${size}x${size}/apps/${app.appId}.png`);
      mkdirSync(dirname(to), { recursive: true });
      cpSync(icon, to);
      icons++;
    }
  }
  if (!icons) {
    console.warn("neeko: the build has no window icons, so the desktop shows a generic one.");
  }

  // Which app opens web links and pages now, before the desktop entry says
  // this one can too (keepDefaults). Without GLib's gio to see that, the
  // entry says nothing about them, so it can't move the default either.
  let before = hasGio() ? new Map(MIME_TYPES.map(type => [type, defaultFor(type)])) : null;
  if (!before) {
    console.warn(
      "neeko: no gio (GLib's), so the desktop won't offer the browser as a default browser."
    );
  }
  let exec = desktopExec(paths.launcher);
  writeOurs(
    paths.desktop,
    [
      `# ${INSTALLED_BY}.`,
      "[Desktop Entry]",
      "Type=Application",
      "Version=1.5",
      `Name=${app.displayName}`,
      "GenericName=Web Browser",
      "Comment=Browse the web",
      `Exec=${exec} %u`,
      `TryExec=${exec}`,
      `Icon=${app.appId}`,
      "Terminal=false",
      "StartupNotify=true",
      `StartupWMClass=${app.appId}`,
      "Categories=Network;WebBrowser;",
      "Keywords=web;browser;internet;",
      ...(before ? [`MimeType=${MIME_TYPES.join(";")};`] : []),
      "Actions=new-window;new-private-window;",
      "",
      "[Desktop Action new-window]",
      "Name=New Window",
      `Exec=${exec} --new-window`,
      "",
      "[Desktop Action new-private-window]",
      "Name=New Private Window",
      `Exec=${exec} --private-window`,
      "",
    ].join("\n"),
    0o644
  );
  refreshDesktop(paths);
  if (before) {
    keepDefaults(app, before);
  }

  console.log(
    `neeko: installed ${app.displayName} ${app.version} in ${paths.program}\n` +
      `neeko: open it from the desktop's apps, or run ${paths.launcher}\n` +
      `neeko: its profiles are in ${paths.profileRoot}`
  );
}

/** Removes what `make install` put in place, but the profiles. */
function uninstall(app: App) {
  checkLinux("make uninstall");
  let paths = installPaths(app);
  if (isRunning(paths.program)) {
    fail(`${app.displayName} is running: quit it first.`);
  }
  for (let dir of [paths.program, `${paths.program}.new`, `${paths.program}.old`]) {
    rmSync(dir, { recursive: true, force: true });
  }
  try {
    rmdirSync(dirname(paths.program));
  } catch (e) {
    // Not empty: something else of the app's is in it.
  }
  for (let file of [paths.launcher, paths.desktop]) {
    if (isOurs(file)) {
      rmSync(file);
    }
  }
  for (let size of ICON_SIZES) {
    rmSync(join(paths.icons, `${size}x${size}/apps/${app.appId}.png`), { force: true });
  }
  refreshDesktop(paths);
  console.log(
    `neeko: uninstalled ${app.displayName}. Its profiles are still in ${paths.profileRoot}: ` +
      "delete that folder to remove its data too."
  );
}

/** The folders <root>/<name>/<under> for the names matching a pattern. */
function globDirs(root: string, pattern: RegExp, under: string): string[] {
  return readdirSync(root)
    .filter(name => pattern.test(name))
    .map(name => join(root, name, under))
    .filter(dir => existsSync(dir));
}

function isRunning(program: string): boolean {
  return spawnSync("pgrep", ["-f", `^${program}/`], { stdio: "ignore" }).status == 0;
}

/** A path as a desktop entry's Exec key takes it. */
function desktopExec(path: string): string {
  if (/["`$\\]/.test(path)) {
    fail(`${path}: a desktop entry can't run a path with quotes, $ or backslashes.`);
  }
  return /\s/.test(path) ? `"${path}"` : path;
}

/**
 * Lets the desktop see a changed desktop entry's file types, and a changed
 * icon, where it keeps caches of them. (GNOME notices new entries and icons
 * by itself.)
 */
// What the desktop entry says the browser opens, so the system offers it as
// a default browser (GNOME's Default Apps, neekoPage.defaultBrowser).
const MIME_TYPES = [
  "text/html",
  "text/xml",
  "application/xhtml+xml",
  "x-scheme-handler/http",
  "x-scheme-handler/https",
];

function hasGio(): boolean {
  return spawnSync("gio", ["help"], { stdio: "ignore" }).status == 0;
}

/** The app (its desktop entry's id) that opens a type now, or null. */
function defaultFor(type: string): string | null {
  let result = spawnSync("gio", ["mime", type], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
  });
  return result.stdout?.match(/^Default application for .*: (\S+\.desktop)\s*$/m)?.[1] ?? null;
}

/**
 * Where nobody chose which app opens a type (no default in mimeapps.list,
 * as on a fresh Ubuntu), the desktop takes the first app that says it can,
 * the user's own entries first: a newly installed browser would become the
 * default by itself. So wherever installing moved a type to this app, the
 * app that had it is recorded as the default, as the user's choice (in
 * ~/.config/mimeapps.list). Defaults the user did choose win anyway.
 */
function keepDefaults(app: App, before: Map<string, string | null>) {
  let ours = `${app.appId}.desktop`;
  for (let [type, was] of before) {
    if (was && was != ours && defaultFor(type) == ours) {
      run("gio", ["mime", type, was]);
      console.log(`neeko: ${was} still opens ${type}, as before.`);
    }
  }
}

function refreshDesktop(paths: ReturnType<typeof installPaths>) {
  spawnSync("update-desktop-database", ["-q", dirname(paths.desktop)], { stdio: "ignore" });
  if (existsSync(join(paths.icons, "icon-theme.cache"))) {
    spawnSync("gtk-update-icon-cache", ["-q", "-t", "-f", paths.icons], { stdio: "ignore" });
  }
}

// ---------------------------------------------------------------------------

let [command, appDir] = process.argv.slice(2);
if (!appDir) {
  fail("usage: bun tools/app.ts config|branding|dist|install|uninstall <app folder>");
}
let app = readApp(resolve(appDir));
switch (command) {
  case "config":
    writeSurferConfig(app);
    break;
  case "branding":
    writeBranding(app);
    break;
  case "dist":
    copyRelease(app);
    break;
  case "install":
    install(app);
    break;
  case "uninstall":
    uninstall(app);
    break;
  default:
    fail(`unknown command "${command}"`);
}
