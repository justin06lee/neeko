/**
 * The keychain's side of NeekoSecrets, on a thread of its own, since the
 * system can hold a keychain call to ask the user something. It keeps,
 * reads, finds and deletes one secret at a time in macOS's Keychain
 * (Security.framework) or a Linux keyring (libsecret's Secret Service),
 * through js-ctypes, and nowhere else: no file, no log, and no value in an
 * error message.
 *
 * Every call gets the item NeekoSecrets describes:
 * { platform, app, profile, name, label }.
 */

"use strict";

importScripts("resource://gre/modules/workers/require.js");

var PromiseWorker = require("resource://gre/modules/workers/PromiseWorker.js");

var worker = new PromiseWorker.AbstractWorker();
worker.dispatch = function (method, args = []) {
  let [item] = args;
  let keychain = (keychains[item.platform] ??= KEYCHAINS[item.platform]());
  return keychain[method](...args);
};
worker.postMessage = function (message, ...transfers) {
  self.postMessage(message, ...transfers);
};
worker.close = function () {
  self.close();
};
worker.log = function () {};

self.addEventListener("message", message => worker.handleMessage(message));
self.addEventListener("unhandledrejection", error => {
  throw error.reason;
});

const keychains = {};
const KEYCHAINS = { macosx: macKeychain, linux: linuxKeychain };

/** Text as UTF-8 bytes, in memory of ctypes', and how many. */
function bytesOf(text) {
  let bytes = new TextEncoder().encode(text);
  let buffer = ctypes.uint8_t.array(bytes.length + 1)();
  for (let i = 0; i < bytes.length; i++) {
    buffer[i] = bytes[i];
  }
  return [buffer, bytes.length];
}

/** Overwrites what a buffer held (a secret's value). */
function wipe(buffer) {
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = 0;
  }
}

function macKeychain() {
  const cf = ctypes.open("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
  const sec = ctypes.open("/System/Library/Frameworks/Security.framework/Security");
  const Ref = ctypes.voidptr_t;
  const CFIndex = ctypes.long;
  const OSStatus = ctypes.int32_t;
  // Only their addresses are used.
  const KeyCallBacks = ctypes.StructType("CFDictionaryKeyCallBacks", [
    { version: CFIndex },
    { retain: Ref },
    { release: Ref },
    { copyDescription: Ref },
    { equal: Ref },
    { hash: Ref },
  ]);
  const ValueCallBacks = ctypes.StructType("CFDictionaryValueCallBacks", [
    { version: CFIndex },
    { retain: Ref },
    { release: Ref },
    { copyDescription: Ref },
    { equal: Ref },
  ]);
  const UTF8 = 0x08000100;
  const errSecItemNotFound = -25300;
  const REFUSALS = new Map([
    [-128, "the user didn't allow it"],
    [-25293, "the user didn't allow it"],
    [-25291, "there's no keychain to use"],
    [-25294, "there's no keychain to use"],
    [-25308, "the keychain is locked and can't ask the user now"],
    [-34018, "this build isn't allowed to use the keychain"],
  ]);

  let fn = (lib, name, returns, ...args) => lib.declare(name, ctypes.default_abi, returns, ...args);
  let CFRelease = fn(cf, "CFRelease", ctypes.void_t, Ref);
  let CFStringCreateWithBytes = fn(
    cf,
    "CFStringCreateWithBytes",
    Ref,
    Ref,
    ctypes.uint8_t.ptr,
    CFIndex,
    ctypes.uint32_t,
    ctypes.uint8_t
  );
  let CFDataCreate = fn(cf, "CFDataCreate", Ref, Ref, ctypes.uint8_t.ptr, CFIndex);
  let CFDataGetLength = fn(cf, "CFDataGetLength", CFIndex, Ref);
  let CFDataGetBytePtr = fn(cf, "CFDataGetBytePtr", ctypes.uint8_t.ptr, Ref);
  let CFDictionaryCreate = fn(
    cf,
    "CFDictionaryCreate",
    Ref,
    Ref,
    Ref.ptr,
    Ref.ptr,
    CFIndex,
    KeyCallBacks.ptr,
    ValueCallBacks.ptr
  );
  let SecItemAdd = fn(sec, "SecItemAdd", OSStatus, Ref, Ref.ptr);
  let SecItemCopyMatching = fn(sec, "SecItemCopyMatching", OSStatus, Ref, Ref.ptr);
  let SecItemUpdate = fn(sec, "SecItemUpdate", OSStatus, Ref, Ref);
  let SecItemDelete = fn(sec, "SecItemDelete", OSStatus, Ref);
  let keyCallBacks = cf.declare("kCFTypeDictionaryKeyCallBacks", KeyCallBacks);
  let valueCallBacks = cf.declare("kCFTypeDictionaryValueCallBacks", ValueCallBacks);
  let constant = (lib, name) => lib.declare(name, Ref);
  let kCFBooleanTrue = constant(cf, "kCFBooleanTrue");
  let kSecClass = constant(sec, "kSecClass");
  let kSecClassGenericPassword = constant(sec, "kSecClassGenericPassword");
  let kSecAttrService = constant(sec, "kSecAttrService");
  let kSecAttrAccount = constant(sec, "kSecAttrAccount");
  let kSecAttrLabel = constant(sec, "kSecAttrLabel");
  let kSecValueData = constant(sec, "kSecValueData");
  let kSecReturnData = constant(sec, "kSecReturnData");
  let kSecMatchLimit = constant(sec, "kSecMatchLimit");
  let kSecMatchLimitOne = constant(sec, "kSecMatchLimitOne");

  let check = status => {
    if (status != 0) {
      let why = REFUSALS.get(status) ?? "it failed";
      throw new Error(`The keychain didn't do it: ${why} (OSStatus ${status}).`);
    }
  };

  /**
   * Runs body(query, keep) with the query that finds the item (its app's
   * service, its profile and name as the account); keep() takes a Core
   * Foundation object made for the call, released afterwards.
   */
  let withItem = (item, body) => {
    let made = [];
    let keep = ref => {
      if (ref.isNull()) {
        throw new Error("The keychain didn't do it: out of memory.");
      }
      made.push(ref);
      return ref;
    };
    let string = text => {
      let [buffer, length] = bytesOf(text);
      return keep(CFStringCreateWithBytes(null, buffer.addressOfElement(0), length, UTF8, 0));
    };
    let dictionary = entries => {
      let keys = Ref.array(entries.length)();
      let values = Ref.array(entries.length)();
      entries.forEach(([key, value], i) => {
        keys[i] = key;
        values[i] = value;
      });
      return keep(
        CFDictionaryCreate(
          null,
          keys.addressOfElement(0),
          values.addressOfElement(0),
          entries.length,
          keyCallBacks.address(),
          valueCallBacks.address()
        )
      );
    };
    try {
      let query = [
        [kSecClass, kSecClassGenericPassword],
        [kSecAttrService, string(`${item.app} secrets`)],
        [kSecAttrAccount, string(`${item.profile}/${item.name}`)],
      ];
      return body({ query, keep, string, dictionary });
    } finally {
      for (let ref of made) {
        CFRelease(ref);
      }
    }
  };

  return {
    has(item) {
      return withItem(item, ({ query, dictionary }) => {
        let status = SecItemCopyMatching(dictionary(query), null);
        if (status == errSecItemNotFound) {
          return false;
        }
        check(status);
        return true;
      });
    },

    read(item) {
      return withItem(item, ({ query, keep, dictionary }) => {
        let result = Ref();
        let status = SecItemCopyMatching(
          dictionary([...query, [kSecReturnData, kCFBooleanTrue], [kSecMatchLimit, kSecMatchLimitOne]]),
          result.address()
        );
        if (status == errSecItemNotFound) {
          return null;
        }
        check(status);
        let data = keep(result);
        let length = Number(CFDataGetLength(data).toString());
        let bytes = new Uint8Array(length);
        if (length) {
          let stored = ctypes.cast(CFDataGetBytePtr(data), ctypes.uint8_t.array(length).ptr).contents;
          for (let i = 0; i < length; i++) {
            bytes[i] = stored[i];
          }
        }
        let value = new TextDecoder().decode(bytes);
        bytes.fill(0);
        return value;
      });
    },

    set(item, value) {
      let [buffer, length] = bytesOf(value);
      try {
        withItem(item, ({ query, keep, string, dictionary }) => {
          let data = keep(CFDataCreate(null, buffer.addressOfElement(0), length));
          let label = string(item.label);
          let status = SecItemUpdate(
            dictionary(query),
            dictionary([
              [kSecValueData, data],
              [kSecAttrLabel, label],
            ])
          );
          if (status == errSecItemNotFound) {
            status = SecItemAdd(
              dictionary([...query, [kSecAttrLabel, label], [kSecValueData, data]]),
              null
            );
          }
          check(status);
        });
      } finally {
        wipe(buffer);
      }
    },

    delete(item) {
      return withItem(item, ({ query, dictionary }) => {
        let status = SecItemDelete(dictionary(query));
        if (status == errSecItemNotFound) {
          return false;
        }
        check(status);
        return true;
      });
    },
  };
}

function linuxKeychain() {
  let secret;
  try {
    secret = ctypes.open("libsecret-1.so.0");
  } catch (e) {
    throw new Error("This system has no keyring to keep secrets in: libsecret isn't installed.");
  }
  const glib = ctypes.open("libglib-2.0.so.0");
  const GError = ctypes.StructType("GError", [
    { domain: ctypes.uint32_t },
    { code: ctypes.int },
    { message: ctypes.char.ptr },
  ]);
  const SchemaAttribute = ctypes.StructType("SecretSchemaAttribute", [
    { name: ctypes.char.ptr },
    { type: ctypes.int },
  ]);
  const Schema = ctypes.StructType("SecretSchema", [
    { name: ctypes.char.ptr },
    { flags: ctypes.int },
    { attributes: SchemaAttribute.array(32) },
    { reserved: ctypes.int },
    { reserved1: ctypes.voidptr_t },
    { reserved2: ctypes.voidptr_t },
    { reserved3: ctypes.voidptr_t },
    { reserved4: ctypes.voidptr_t },
    { reserved5: ctypes.voidptr_t },
    { reserved6: ctypes.voidptr_t },
    { reserved7: ctypes.voidptr_t },
  ]);
  const ATTRIBUTES = ["app", "profile", "name"];

  let fn = (lib, name, returns, ...args) => lib.declare(name, ctypes.default_abi, returns, ...args);
  let store = fn(
    secret,
    "secret_password_store_sync",
    ctypes.int,
    Schema.ptr,
    ctypes.char.ptr,
    ctypes.char.ptr,
    ctypes.char.ptr,
    ctypes.voidptr_t,
    GError.ptr.ptr,
    "..."
  );
  let lookup = fn(
    secret,
    "secret_password_lookup_sync",
    ctypes.char.ptr,
    Schema.ptr,
    ctypes.voidptr_t,
    GError.ptr.ptr,
    "..."
  );
  let clear = fn(
    secret,
    "secret_password_clear_sync",
    ctypes.int,
    Schema.ptr,
    ctypes.voidptr_t,
    GError.ptr.ptr,
    "..."
  );
  let free = fn(secret, "secret_password_free", ctypes.void_t, ctypes.char.ptr);
  let freeError = fn(glib, "g_error_free", ctypes.void_t, GError.ptr);

  // C strings, kept alive as long as what points to them.
  let constants = [];
  let cString = (text, keep) => {
    let [buffer] = bytesOf(text);
    keep.push(buffer);
    return ctypes.cast(buffer.address(), ctypes.char.ptr);
  };
  let schema = new Schema();
  schema.name = cString("neeko.Secret", constants);
  schema.flags = 0;
  ATTRIBUTES.forEach((name, i) => {
    schema.attributes[i].name = cString(name, constants);
    schema.attributes[i].type = 0;
  });

  // The attributes that find the item, as the calls' variable arguments.
  let attributes = (item, keep) => [
    ...ATTRIBUTES.flatMap(name => [cString(name, keep), cString(item[name], keep)]),
    ctypes.char.ptr(0),
  ];
  let check = error => {
    if (!error.isNull()) {
      let message = error.contents.message.isNull() ? "" : error.contents.message.readString();
      freeError(error);
      throw new Error(`The keyring didn't do it: ${message || "it failed"}.`);
    }
  };

  return {
    has(item) {
      return this.read(item) !== null;
    },

    read(item) {
      let keep = [];
      let error = GError.ptr();
      try {
        let value = lookup(schema.address(), null, error.address(), ...attributes(item, keep));
        check(error);
        if (value.isNull()) {
          return null;
        }
        try {
          return value.readString();
        } finally {
          free(value);
        }
      } finally {
        keep.length = 0;
      }
    },

    set(item, value) {
      let keep = [];
      let error = GError.ptr();
      let [buffer] = bytesOf(value);
      try {
        let stored = store(
          schema.address(),
          cString("default", keep),
          cString(item.label, keep),
          ctypes.cast(buffer.address(), ctypes.char.ptr),
          null,
          error.address(),
          ...attributes(item, keep)
        );
        check(error);
        if (!stored) {
          throw new Error("The keyring didn't do it: it failed.");
        }
      } finally {
        wipe(buffer);
        keep.length = 0;
      }
    },

    delete(item) {
      let keep = [];
      let error = GError.ptr();
      try {
        let removed = clear(schema.address(), null, error.address(), ...attributes(item, keep));
        check(error);
        return !!removed;
      } finally {
        keep.length = 0;
      }
    },
  };
}
