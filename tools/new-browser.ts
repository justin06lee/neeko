/**
 * Starts a new browser built on Neeko: a git repo with Neeko as a pinned
 * submodule and the browser's own files around it (docs/using-neeko.md).
 *
 *   bun tools/new-browser.ts <folder> [--name Name] [--neeko URL] [--ref REF]
 *
 * - --name: the browser's name (letters and digits). Default: the folder's.
 * - --neeko: where to get Neeko from. Default: this checkout's `origin`
 *   remote, or this checkout's own folder if it has none.
 * - --ref: the Neeko version to pin. Default: the newest vX.Y.Z tag here,
 *   or the current commit if there are no tags yet.
 *
 * It writes browser.json, a copy of Neeko's demo UI as the starting point,
 * branding/prefs.js, a Makefile that hands everything to Neeko, a README and
 * a .gitignore, then makes the first commit. Then: cd <folder> && make.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

const NEEKO = resolve(import.meta.dir, "..");

function fail(message: string): never {
  console.error(`new-browser: ${message}`);
  process.exit(1);
}

function git(args: string[], cwd: string, { allowFail = false } = {}): string {
  let result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status != 0 && !allowFail) {
    fail(`git ${args.join(" ")} failed:\n${result.stderr}`);
  }
  return result.status == 0 ? result.stdout.trim() : "";
}

function parseArgs() {
  let args = process.argv.slice(2);
  let options: Record<string, string> = {};
  let positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    let match = args[i].match(/^--(name|neeko|ref)(?:=(.*))?$/);
    if (match) {
      options[match[1]] = match[2] ?? args[++i];
    } else if (args[i].startsWith("-")) {
      fail(`unknown option ${args[i]}`);
    } else {
      positional.push(args[i]);
    }
  }
  if (positional.length != 1) {
    fail("usage: bun tools/new-browser.ts <folder> [--name Name] [--neeko URL] [--ref REF]");
  }
  return { folder: resolve(positional[0]), ...options };
}

let { folder, name, neeko, ref } = parseArgs();

name ??= basename(folder)
  .replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ?? "").toUpperCase())
  .replace(/^./, c => c.toUpperCase());
if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name)) {
  fail(`"${name}" can't be a browser name: use letters and digits, starting with a letter (--name).`);
}
if (existsSync(folder) && readdirSync(folder).length) {
  fail(`${folder} already exists and isn't empty.`);
}

neeko ??= git(["remote", "get-url", "origin"], NEEKO, { allowFail: true }) || NEEKO;
ref ??=
  git(["tag", "--list", "v*", "--sort=-v:refname"], NEEKO).split("\n")[0] ||
  git(["rev-parse", "HEAD"], NEEKO);
// Git refuses local-path submodules unless told they're fine.
let local = isAbsolute(neeko) || neeko.startsWith("file:") || neeko.startsWith(".");
let allowLocal = local ? ["-c", "protocol.file.allow=always"] : [];

mkdirSync(folder, { recursive: true });
git(["init", "-b", "master"], folder);
git([...allowLocal, "submodule", "add", neeko, "neeko"], folder);
git(["checkout", "--quiet", ref], join(folder, "neeko"));

let lower = name.toLowerCase();
let files: Record<string, string> = {
  "browser.json":
    JSON.stringify(
      { name, vendor: name, appId: `com.example.${lower}`, version: "0.1.0" },
      null,
      2
    ) + "\n",

  "branding/prefs.js": `// ${name}'s own default prefs. Firefox reads them after Neeko's, so anything
// set here wins over Neeko's defaults, privacy ones included. Use Firefox's
// pref() syntax, one per line, with a comment saying why.
`,

  Makefile: `# Builds ${name} with Neeko (the neeko/ submodule). Neeko's Makefile does
# the work; APP tells it where this browser's own files are.

NEEKO := $(MAKE) -C neeko APP=$(CURDIR)

.PHONY: all build run release update stop

# Build and launch with a throwaway dev profile.
all: neeko/Makefile
	$(NEEKO)

# build: build only. run: launch. update: quit, rebuild, relaunch.
# stop: quit the dev build. release: a full build, packaged into dist/.
build run release update stop: neeko/Makefile
	$(NEEKO) $@

# A clone made without --recursive has an empty neeko/ folder.
neeko/Makefile:
	git submodule update --init
`,

  ".gitignore": `# Release builds (make release)
dist/

.DS_Store
`,

  "README.md": `<div align="center">

# ${name}

**A web browser built on [Neeko](neeko/README.md).**

</div>

---

${name}'s interface is plain HTML, CSS and JavaScript in \`ui/\`. Neeko (the
\`neeko/\` submodule) runs it on top of Firefox and gives it the \`neeko\` API
for tabs, navigation and more.

## Usage

\`\`\`sh
git clone --recursive <this repo>
make
\`\`\`

The first \`make\` downloads Firefox's source into \`neeko/engine/\` (about 10 GB)
and builds it, which takes about 15 minutes. After that, rebuilds take under
a minute, and changes to \`ui/\` only need a relaunch.

| Command        | What it does                                           |
| -------------- | ------------------------------------------------------ |
| \`make\`         | Set up if needed, build, and launch                    |
| \`make build\`   | Build only                                             |
| \`make update\`  | Quit a running dev build, rebuild, and relaunch it     |
| \`make release\` | Full build from source, packaged into \`dist/\` (hours)  |

## What's here

\`\`\`
${lower}/
├── browser.json   Name, vendor, app id and version
├── ui/            The browser's UI (started as a copy of Neeko's demo UI)
├── branding/      prefs.js, and icon.png (a square PNG, 1024 px) when you have one
├── neeko/         Neeko itself, pinned to a release
└── Makefile       Hands everything to neeko/
\`\`\`

- **The UI:** \`ui/index.html\` and whatever it loads. The API is documented in
  [neeko/docs/api.md](neeko/docs/api.md).
- **Identity:** set \`appId\` in \`browser.json\` to your own reverse-DNS id
  before you ship. \`name\` names the profile folder, so pick it once.
- **Icon:** put a square \`branding/icon.png\` (at least 1024 pixels) there and
  rebuild. Until then the app uses Firefox's unofficial icon.
- **Prefs:** \`branding/prefs.js\` overrides Neeko's defaults.

## Updating Neeko

Neeko pins the Firefox version, so this is also how Firefox updates arrive:

\`\`\`sh
git -C neeko fetch --tags
git -C neeko checkout vX.Y.Z
git commit -am "chore: update Neeko to vX.Y.Z"
\`\`\`

To add an API feature ${name} needs, work inside \`neeko/\` (a normal Neeko
checkout), send it to Neeko, and point this repo at the release that has it.

## Testing

After \`make build\`: \`python3 neeko/tools/test_api.py\` checks the API, and
\`python3 neeko/tools/test_privacy.py\` checks that nothing is sent anywhere
Neeko turns off, with this browser's UI. After \`make release\`,
\`python3 neeko/tools/test_release.py dist/${name}.app\` checks the packaged
app is its own browser.

## Privacy

${name} inherits Neeko's privacy defaults: no telemetry, studies, ads or
crash reports, from the first launch.
[neeko/PRIVACY.md](neeko/PRIVACY.md) lists every connection it makes, in
plain language. If you change a privacy default in \`branding/prefs.js\`,
say so in your own privacy notice.
`,
};
for (let [path, contents] of Object.entries(files)) {
  mkdirSync(join(folder, path, ".."), { recursive: true });
  writeFileSync(join(folder, path), contents);
}
cpSync(join(folder, "neeko/ui"), join(folder, "ui"), { recursive: true });

git(["add", "-A"], folder);
let pinned = git(["describe", "--tags", "--match", "v*", "--always"], join(folder, "neeko"));
git(["commit", "--quiet", "-m", `chore: start ${name} on Neeko ${pinned}`], folder);

console.log(`Created ${name} in ${folder}, with Neeko ${pinned} from ${neeko}.

Next:
  cd ${folder}
  make

Set your own appId in browser.json before you ship.`);
