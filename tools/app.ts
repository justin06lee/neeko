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
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

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
};

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

// Files made from the app's icon, and the macOS tools that make them.
const ICON_FILES = [
  "firefox.icns",
  "Assets.car",
  ...[16, 22, 24, 32, 48, 64, 128, 256].map(size => `default${size}.png`),
  "content/about-logo.png",
  "content/about-logo@2x.png",
  "content/about-logo.svg",
];
const ICON_STAMP = ".neeko-icon";

/**
 * Makes the app icon (macOS app icon, window icons, the logo on Firefox's
 * own pages) from branding/icon.png, a square PNG of at least 1024 pixels.
 * branding/icon.svg, if there, is used where Firefox wants an SVG logo.
 * Skipped when nothing changed, since it takes a few seconds.
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
  let cached = join(BRANDING, ICON_STAMP);
  if (existsSync(cached) && read(cached) == hash && ICON_FILES.every(f => existsSync(join(BRANDING, f)))) {
    for (let file of ICON_FILES) {
      cpSync(join(BRANDING, file), join(out, file));
    }
    writeFileSync(join(out, ICON_STAMP), hash);
    return;
  }
  if (process.platform != "darwin") {
    console.warn("neeko: app icons are only generated on macOS for now; keeping Firefox's.");
    return;
  }

  let work = mkdtempSync(join(tmpdir(), "neeko-icon-"));
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
      "actool", "--compile", out, "--platform", "macosx",
      "--minimum-deployment-target", "10.15", "--app-icon", "AppIcon",
      "--output-partial-info-plist", join(work, "partial.plist"),
      join(work, "Icon.xcassets"),
    ]);
    // actool also writes AppIcon.icns next to Assets.car; firefox.icns is it.
    rmSync(join(out, "AppIcon.icns"), { force: true });

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
    writeFileSync(join(out, ICON_STAMP), hash);
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
  let mozBuild = join(out, "moz.build");
  writeFileSync(
    mozBuild,
    read(mozBuild).replace(
      'DIRS += ["content", "locales"]',
      'DIRS += ["content", "locales", "ui"]'
    )
  );
  if (!read(mozBuild).includes('"ui"')) {
    fail(`couldn't add the UI to ${mozBuild}; Firefox's branding moz.build changed.`);
  }
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
    copyBrandingFiles(app, out);
    writeIcons(app, out);
    writeUI(app, out);
    writeBuildSettings(app, out);
    sync(out, BRANDING);
    // The stamp is a dotfile, which sync() skips.
    if (existsSync(join(out, ICON_STAMP))) {
      writeIfChanged(join(BRANDING, ICON_STAMP), read(join(out, ICON_STAMP)));
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
  // Keep engine/'s own git status clean, as Surfer does for Neeko's files.
  let gitignore = join(ENGINE, ".gitignore");
  let entry = `browser/branding/${BRAND}/`;
  if (!read(gitignore).split("\n").includes(entry)) {
    appendFileSync(gitignore, `\n${entry}\n`);
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
