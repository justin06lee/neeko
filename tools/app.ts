/**
 * The build's app step. It turns an app folder (a browser built on Neeko, or
 * Neeko's own demo app) into what Surfer and Firefox's build need. The
 * Makefile runs it; nothing else should need to.
 *
 *   bun tools/app.ts config   <app>   write surfer.json (before Surfer runs)
 *   bun tools/app.ts branding <app>   write the app's Firefox branding folder
 *                                     (after `surfer import`)
 *   bun tools/app.ts dist     <app>   copy a finished release into <app>/dist
 *
 * An app folder holds:
 *
 *   browser.json  name, vendor, appId and version (see readApp)
 *   ui/           the browser's UI: index.html and everything it loads
 *   pages/        optional: the browser's own pages, <name>.html as
 *                 about:<name> (start.html is the New Tab and home page)
 *
 * browser.json can also give the browser's look for what Firefox still
 * draws itself, its "theme" (see readTheme), and which of Firefox's menus
 * and items to keep, its "menus" (see readMenus).
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
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
  };
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

// Files made from the app's icon.
const ICON_FILES = [
  "firefox.icns",
  "Assets.car",
  ...[16, 22, 24, 32, 48, 64, 128, 256].map(size => `default${size}.png`),
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
    if (process.platform != "darwin") {
      console.warn("neeko: app icons are only generated on macOS for now; keeping Firefox's.");
      return;
    }
    rmSync(ICON_CACHE, { recursive: true, force: true });
    makeIcons(png, svg, cache);
  }
  for (let file of ICON_FILES) {
    cpSync(join(cache, file), join(out, file));
  }
}

function makeIcons(png: string, svg: string, out: string) {
  let work = mkdtempSync(join(tmpdir(), "neeko-icon-"));
  mkdirSync(join(out, "content"), { recursive: true });
  try {
    let resize = (size: number, to: string) =>
      run("sips", ["-z", `${size}`, `${size}`, png, "--out", to]);

    // firefox.icns (older macOS) and Assets.car (current macOS, which looks
    // for the "AppIcon" in it first).
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

    for (let size of [16, 22, 24, 32, 48, 64, 128, 256]) {
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

/** Copies the packaged release build into <app>/dist, named after the app. */
function copyRelease(app: App) {
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

// ---------------------------------------------------------------------------

let [command, appDir] = process.argv.slice(2);
if (!appDir) {
  fail("usage: bun tools/app.ts config|branding|dist <app folder>");
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
  default:
    fail(`unknown command "${command}"`);
}
