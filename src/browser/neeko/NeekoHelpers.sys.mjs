/**
 * Helpers: programs an app ships inside its browser (browser.json's
 * "helpers"), such as a local server for its AI features. Neeko starts one
 * the first time the UI or one of the app's pages asks it something, never
 * before, and carries their requests to it over HTTP on 127.0.0.1, streamed
 * both ways, with what Neeko knows about the caller and a token the caller
 * never sees. docs/api.md ("Helpers") has the contract a helper follows.
 *
 * One process per helper for the whole session, shared by every window; it
 * starts again after a crash, with a growing delay, and goes when the
 * browser quits or the app stops it.
 */

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AsyncShutdown: "resource://gre/modules/AsyncShutdown.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  Subprocess: "resource://gre/modules/Subprocess.sys.mjs",
});

// A helper's name, as browser.json gives it, and its file's name.
const NAME = /^[a-z][a-z0-9-]{0,31}$/;
// Where builds put helpers, next to the browser's own program.
const FOLDER = "neeko-helpers";
// A folder of helpers to use instead (the API test's).
const PATH_PREF = "neeko.helpers.path";

// How long a helper has to say which port it listens on.
const START_TIMEOUT = 15000;
// After it fails (crashes, or doesn't start), it waits this long before
// starting again, doubling each time up to the last, and stops restarting by
// itself after this many failures in a row within the window.
const FIRST_DELAY = 1000;
const LAST_DELAY = 30000;
const MAX_FAILURES = 5;
const FAILURE_WINDOW = 120000;
// How long a helper has to exit after it's asked to, before it's killed.
const KILL_TIMEOUT = 2000;

// The only parts of the browser's environment a helper gets: who and where
// the user is (home, shell, folders, language, time zone), and how they
// reach the network (certificates, proxies).
const KEPT_ENV =
  /^(HOME|USER|LOGNAME|SHELL|TMPDIR|TZ|LANG|LANGUAGE|LC_[A-Z]+|XDG_[A-Z_]+|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE|(HTTP|HTTPS|ALL|NO)_PROXY|(http|https|all|no)_proxy)$/;
// Its PATH: the user's login shell's (an app opened from the Finder gets a
// bare one), then where command-line tools usually are, then the system's.
const TOOL_DIRS = [
  "~/.local/bin",
  "~/.bun/bin",
  "~/.cargo/bin",
  "~/.npm-global/bin",
  "/opt/homebrew/bin",
  "/usr/local/bin",
];
const SYSTEM_PATH = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
// How long the login shell has to say its PATH.
const SHELL_TIMEOUT = 3000;
const PATH_MARK = "__NEEKO_PATH__";

const REQUEST_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const MAX_BODY = 16 * 1024 * 1024;
const MAX_PATH = 8192;
// A path on the helper: from its root, no host, no backslashes (which URLs
// read as slashes), no spaces or control characters.
const PATH = /^\/(?!\/)[^\s\\\x00-\x1f\x7f]*$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
// Headers callers can't send: Neeko's own (X-Neeko-* and Authorization,
// which the helper relies on), and the ones about the connection, which
// fetch sets.
const RESERVED_HEADER =
  /^(x-neeko-.*|authorization|host|connection|keep-alive|content-length|transfer-encoding|te|trailer|upgrade|cookie|cookie2|proxy-.*)$/i;

const PLATFORMS = { macosx: "macos", win: "windows", linux: "linux" };

function randomToken() {
  let bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

function checkName(name) {
  if (typeof name != "string" || !NAME.test(name)) {
    throw new TypeError(
      "Expected a helper's name: lowercase letters, digits and dashes, as browser.json has it."
    );
  }
  return name;
}

/** The folder helpers are in: the pref's, or the build's. */
function helpersFolder() {
  let override = Services.prefs.getStringPref(PATH_PREF, "");
  return override || PathUtils.join(Services.dirsvc.get("GreBinD", Ci.nsIFile).path, FOLDER);
}

/** A helper's program, or null if this build has none by that name. */
async function helperFile(name) {
  let path = PathUtils.join(helpersFolder(), name);
  try {
    let info = await IOUtils.stat(path);
    return info.type == "regular" && info.permissions & 0o111 ? path : null;
  } catch (e) {
    return null;
  }
}

/**
 * The PATH the user's login shell sets up ($SHELL -l), asked once a session,
 * at the first helper's start: the shell reads the user's profile files
 * (not their interactive ones), with a moment to answer. "" if it doesn't.
 */
let loginPath = null;
function askLoginShell(env) {
  loginPath ??= (async () => {
    if (!env.SHELL?.startsWith("/")) {
      return "";
    }
    let proc = await lazy.Subprocess.call({
      command: env.SHELL,
      arguments: ["-l", "-c", `printf '\\n${PATH_MARK}%s${PATH_MARK}\\n' "$PATH"`],
      environment: { ...env, PATH: SYSTEM_PATH.join(":") },
      environmentAppend: false,
      stderr: "ignore",
    });
    proc.stdin.close();
    let timer = lazy.setTimeout(() => proc.kill(0), SHELL_TIMEOUT);
    let out = "";
    let chunk;
    while ((chunk = await proc.stdout.readString())) {
      out += chunk;
    }
    lazy.clearTimeout(timer);
    await proc.wait();
    return new RegExp(`${PATH_MARK}(.*)${PATH_MARK}`).exec(out)?.[1] ?? "";
  })().catch(e => {
    console.warn("Neeko: couldn't ask the login shell for its PATH.", e);
    return "";
  });
  return loginPath;
}

/**
 * What a helper's environment is: what it keeps of the browser's (KEPT_ENV),
 * the login shell's PATH, and Neeko's.
 */
async function environment(name, token, dataDir) {
  let env = {};
  for (let [key, value] of Object.entries(lazy.Subprocess.getEnvironment())) {
    if (KEPT_ENV.test(key)) {
      env[key] = value;
    }
  }
  let home = env.HOME ?? "";
  let path = [
    ...(await askLoginShell(env)).split(":"),
    ...TOOL_DIRS.map(dir => dir.replace(/^~(?=\/)/, home)),
    ...SYSTEM_PATH,
  ].filter((dir, i, all) => dir.startsWith("/") && all.indexOf(dir) == i);
  return {
    ...env,
    PATH: path.join(":"),
    NEEKO_HELPER_NAME: name,
    NEEKO_HELPER_TOKEN: token,
    NEEKO_HELPER_DATA: dataDir,
    NEEKO_PARENT_PID: String(Services.appinfo.processID),
    NEEKO_PLATFORM: PLATFORMS[AppConstants.platform] ?? AppConstants.platform,
  };
}

/**
 * Reads a pipe line by line, handing each line on, until it closes.
 */
async function readLines(pipe, onLine) {
  let pending = "";
  for (;;) {
    let chunk;
    try {
      chunk = await pipe.readString();
    } catch (e) {
      return;
    }
    if (!chunk) {
      if (pending) {
        onLine(pending);
      }
      return;
    }
    pending += chunk;
    let lines = pending.split("\n");
    pending = lines.pop();
    for (let line of lines) {
      onLine(line);
    }
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("stopped"));
      return;
    }
    if (!ms) {
      resolve();
      return;
    }
    let timer = lazy.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      lazy.clearTimeout(timer);
      reject(new Error("stopped"));
    });
  });
}

/** Kills every running helper as the browser quits. */
let shutdownBlocker = null;
function blockShutdown() {
  if (shutdownBlocker) {
    return;
  }
  shutdownBlocker = () => Promise.all([...helpers.values()].map(h => h.stop()));
  lazy.AsyncShutdown.profileBeforeChange.addBlocker(
    "Neeko: stop the app's helpers",
    shutdownBlocker
  );
}

class Helper {
  /** The running process, from when it starts until it exits. */
  #proc = null;
  /** { port, token } while it listens. */
  #listening = null;
  /** The start under way, which requests wait for. */
  #starting = null;
  /** Aborts the start under way (stop()). */
  #abort = null;
  /** When it last failed, for the delay before starting again. */
  #failures = [];
  #stopped = true;

  constructor(name) {
    this.name = name;
  }

  get running() {
    return !!this.#listening;
  }

  /**
   * Resolves to { port, token } once the helper listens, starting it if it
   * isn't running. Rejects if it can't start.
   */
  ready() {
    if (this.#listening) {
      return Promise.resolve(this.#listening);
    }
    if (!this.#starting) {
      this.#stopped = false;
      this.#abort = new AbortController();
      this.#starting = this.#start(this.#abort.signal).finally(() => {
        this.#starting = null;
      });
    }
    return this.#starting;
  }

  /** How long to wait before the next start, after recent failures. */
  #delay() {
    let now = Date.now();
    this.#failures = this.#failures.filter(t => now - t < FAILURE_WINDOW);
    let count = this.#failures.length;
    return count ? Math.min(LAST_DELAY, FIRST_DELAY * 2 ** (count - 1)) : 0;
  }

  async #start(signal) {
    await sleep(this.#delay(), signal);
    let file = await helperFile(this.name);
    if (!file) {
      throw new Error(`This build has no helper named "${this.name}" for this system.`);
    }
    let dataDir = PathUtils.join(PathUtils.profileDir, FOLDER, this.name);
    await IOUtils.makeDirectory(dataDir, { permissions: 0o700 });
    await IOUtils.setPermissions(dataDir, 0o700);
    signal.throwIfAborted();
    let token = randomToken();
    let proc = await lazy.Subprocess.call({
      command: file,
      arguments: [],
      environment: await environment(this.name, token, dataDir),
      environmentAppend: false,
      workdir: dataDir,
      stderr: "pipe",
      // Not disclaimed (macOS): the helper is part of the browser to the
      // system's permissions, as an app's helpers are. Disclaimed, a script
      // on an external disk waited forever for permission to be read.
    });
    if (signal.aborted) {
      proc.kill(KILL_TIMEOUT);
      throw new Error(`The helper "${this.name}" was stopped while it started.`);
    }
    this.#proc = proc;
    blockShutdown();
    proc.wait().then(({ exitCode }) => this.#exited(proc, exitCode));
    let log = line => line && console.log(`Neeko helper "${this.name}": ${line}`);
    readLines(proc.stderr, log);

    // Its first line on stdout says which port it listens on.
    let port;
    try {
      port = await new Promise((resolve, reject) => {
        let timer = lazy.setTimeout(
          () => reject(new Error(`didn't say which port it listens on within ${START_TIMEOUT / 1000} seconds`)),
          START_TIMEOUT
        );
        let first = true;
        readLines(proc.stdout, line => {
          if (!first) {
            log(line);
            return;
          }
          first = false;
          lazy.clearTimeout(timer);
          let reported = null;
          try {
            reported = JSON.parse(line).port;
          } catch (e) {}
          if (Number.isInteger(reported) && reported > 0 && reported < 65536) {
            resolve(reported);
          } else {
            reject(new Error(`said ${JSON.stringify(line.slice(0, 200))} instead of {"port": <port>}`));
          }
        }).then(() => {
          lazy.clearTimeout(timer);
          reject(new Error("exited before saying which port it listens on"));
        });
        signal.addEventListener("abort", () => reject(new Error("stopped")));
      });
    } catch (e) {
      if (!signal.aborted) {
        this.#failures.push(Date.now());
      }
      proc.kill(KILL_TIMEOUT);
      throw new Error(`The helper "${this.name}" didn't start: it ${e.message}.`);
    }
    this.#listening = { port, token };
    return this.#listening;
  }

  #exited(proc, exitCode) {
    if (this.#proc != proc) {
      return;
    }
    let wasListening = !!this.#listening;
    this.#proc = null;
    this.#listening = null;
    if (this.#stopped || !wasListening) {
      return;
    }
    console.warn(`Neeko helper "${this.name}" exited (${exitCode}).`);
    this.#failures.push(Date.now());
    // Started again, after a delay, unless it keeps failing: then the next
    // request tries.
    this.#delay();
    if (this.#failures.length >= MAX_FAILURES) {
      console.error(`Neeko helper "${this.name}" keeps exiting; it starts again on the next request.`);
      return;
    }
    this.ready().catch(e => console.error(e.message));
  }

  /** Stops it, if it runs. Requests start it again. */
  async stop() {
    this.#stopped = true;
    this.#abort?.abort();
    this.#listening = null;
    let proc = this.#proc;
    this.#proc = null;
    if (proc) {
      await proc.kill(KILL_TIMEOUT);
    }
  }
}

/** The helpers asked for this session, by name. */
const helpers = new Map();

function helper(name) {
  checkName(name);
  let found = helpers.get(name);
  if (!found) {
    found = new Helper(name);
    helpers.set(name, found);
  }
  return found;
}

/**
 * Checks a request for a helper: { method, headers, body }, with headers as
 * [name, value] pairs (the API's sides turn a Headers object or a plain one
 * into those) and the body a string or bytes.
 */
function checkRequest(path, options) {
  if (typeof path != "string" || path.length > MAX_PATH || !PATH.test(path)) {
    throw new TypeError(`Expected a path on the helper, such as "/answer?q=fox".`);
  }
  if (options !== undefined && options !== null && (typeof options != "object" || Array.isArray(options))) {
    throw new TypeError("Expected a helper request's options: { method, headers, body }.");
  }
  for (let key of Object.keys(options ?? {})) {
    if (!["method", "headers", "body"].includes(key)) {
      throw new TypeError(`Unknown option "${key}".`);
    }
  }
  let { method = "GET", headers = [], body = null } = options ?? {};
  if (typeof method != "string" || !REQUEST_METHODS.includes(method.toUpperCase())) {
    throw new TypeError(`A helper request's method is one of: ${REQUEST_METHODS.join(", ")}.`);
  }
  method = method.toUpperCase();
  if (!Array.isArray(headers)) {
    throw new TypeError("Expected headers as [name, value] pairs.");
  }
  let checked = {};
  for (let pair of headers) {
    let [name, value] = Array.isArray(pair) ? pair : [];
    if (typeof name != "string" || !HEADER_NAME.test(name) || typeof value != "string" || /[\r\n\0]/.test(value)) {
      throw new TypeError("Expected headers as [name, value] pairs of text.");
    }
    if (RESERVED_HEADER.test(name)) {
      throw new TypeError(`A helper request can't set the ${name} header.`);
    }
    let key = name.toLowerCase();
    checked[key] = key in checked ? `${checked[key]}, ${value}` : value;
  }
  if (body !== null && body !== undefined) {
    if (method == "GET" || method == "HEAD") {
      throw new TypeError(`A ${method} request has no body.`);
    }
    let size = typeof body == "string" ? body.length * 3 : body?.byteLength;
    let bytes = ArrayBuffer.isView(body) || body instanceof ArrayBuffer;
    if (typeof body != "string" && !bytes) {
      throw new TypeError("A helper request's body is text or bytes.");
    }
    if (size > MAX_BODY && (typeof body != "string" || new TextEncoder().encode(body).length > MAX_BODY)) {
      throw new TypeError(`A helper request's body is at most ${MAX_BODY / 1024 / 1024} MB.`);
    }
  } else {
    body = null;
  }
  return { path, method, headers: checked, body };
}

export const NeekoHelpers = {
  /**
   * The helpers this build has (whether or not they run): [{ name, running }].
   */
  async list() {
    let names = [];
    try {
      for (let path of await IOUtils.getChildren(helpersFolder())) {
        let name = PathUtils.filename(path);
        if (NAME.test(name) && (await helperFile(name))) {
          names.push(name);
        }
      }
    } catch (e) {
      // No helpers folder: no helpers.
    }
    return names.sort().map(name => ({ name, running: !!helpers.get(name)?.running }));
  },

  /** Stops a helper, if it runs. The next request starts it again. */
  async stop(name) {
    await helpers.get(checkName(name))?.stop();
  },

  /**
   * Sends a request to a helper, starting it first if needed, and resolves
   * with fetch's Response once the helper's answer starts (its body still
   * coming).
   *
   * @param {object} caller What the helper may rely on about who asks:
   *   { caller: "ui" | "page:<name>", userContextId, private }.
   * @param {AbortSignal} signal Cancels it, even while the helper starts.
   */
  async fetch(name, path, options, caller, signal) {
    let request = checkRequest(path, options);
    let { port, token } = await helper(name).ready();
    signal?.throwIfAborted();
    let url = new URL(request.path, `http://127.0.0.1:${port}`);
    if (url.origin != `http://127.0.0.1:${port}`) {
      throw new TypeError("Expected a path on the helper.");
    }
    return fetch(url.href, {
      method: request.method,
      headers: {
        ...request.headers,
        Authorization: `Bearer ${token}`,
        "X-Neeko-Caller": caller.caller,
        "X-Neeko-Container": String(caller.userContextId ?? 0),
        "X-Neeko-Private": caller.private ? "1" : "0",
      },
      body: request.body,
      signal,
      // Nothing of the browser's goes along, and nothing comes back to keep;
      // a redirect would take Neeko's headers elsewhere.
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  },
};

/**
 * One caller's requests to helpers (a UI page's, or an app page's), each
 * with an id the caller picks, whose answers stream back as messages:
 * send("chunk", { stream, chunk }) for each piece of the body, as bytes, then
 * send("end", { stream, error }), error null if it all arrived.
 */
export class HelperStreams {
  /** The requests under way, by id: their AbortController. */
  #streams = new Map();
  #send;

  constructor(send) {
    this.#send = send;
  }

  /**
   * Starts a request. Resolves with { status, statusText, headers } (headers
   * as [name, value] pairs) once the answer starts; its body follows as
   * messages.
   */
  async fetch(id, name, path, options, caller) {
    if (!Number.isInteger(id) || id < 1 || this.#streams.has(id)) {
      throw new TypeError("Expected a new request id.");
    }
    let controller = new AbortController();
    this.#streams.set(id, controller);
    let response;
    try {
      response = await NeekoHelpers.fetch(name, path, options, caller, controller.signal);
    } catch (e) {
      this.#streams.delete(id);
      throw controller.signal.aborted ? new Error("Cancelled.") : e;
    }
    this.#pump(id, response, controller);
    return {
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers],
    };
  }

  async #pump(id, response, controller) {
    let error = null;
    try {
      let reader = response.body?.getReader();
      while (reader) {
        let { done, value } = await reader.read();
        if (done) {
          break;
        }
        this.#send("chunk", { stream: id, chunk: value });
      }
    } catch (e) {
      error = controller.signal.aborted ? "Cancelled." : e.message || String(e);
    }
    this.#streams.delete(id);
    this.#send("end", { stream: id, error });
  }

  /** Cancels a request: the helper sees its connection close. */
  cancel(id) {
    this.#streams.get(id)?.abort();
  }

  /** Cancels every request (the caller is going away). */
  destroy() {
    for (let controller of this.#streams.values()) {
      controller.abort();
    }
    this.#streams.clear();
  }
}
