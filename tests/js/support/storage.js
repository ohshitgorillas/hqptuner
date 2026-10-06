// The localStorage stand-in for the suites that persist through it. This
// process has no localStorage at all (plain node), which is itself the
// storage-disabled case, so a suite installs the fake only for the cases that
// need storage to work and takes it away again after every one.

/**
 * The global the fake is installed on, viewed as an optional member: the DOM lib
 * declares `localStorage` as a full, always-present `Storage`, which this fake
 * does not build.
 *
 * @type {{ localStorage?: unknown }}
 */
const env = globalThis;

// The three members our code reads, over a map a case can inspect directly.
function fakeStorage() {
  /** @type {Map<string, string>} */
  const map = new Map();
  return {
    map,
    /** @param {string} k */
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    /** @param {string} k @param {string} v */
    setItem: (k, v) => map.set(k, v),
    /** @param {string} k */
    removeItem: (k) => map.delete(k),
  };
}

// Install a fresh fake, and hand it back so a case can read what was written.
export function useStorage() {
  const storage = fakeStorage();
  env.localStorage = storage;
  return storage;
}

// Back to the storage-disabled environment.
export function dropStorage() {
  delete env.localStorage;
}

// A storage that is PRESENT and refuses every operation — what a browser with
// storage blocked by policy, or a full quota, hands over: the member exists and
// throws on use. Distinct from having no localStorage at all, which `dropStorage`
// leaves behind.
export function useThrowingStorage() {
  const storage = {
    /** @param {string} k */
    getItem(k) {
      throw new Error(`storage is unavailable (getItem ${k})`);
    },
    /** @param {string} k @param {string} v */
    setItem(k, v) {
      throw new Error(`storage is unavailable (setItem ${k}=${v})`);
    },
    /** @param {string} k */
    removeItem(k) {
      throw new Error(`storage is unavailable (removeItem ${k})`);
    },
  };
  env.localStorage = storage;
  return storage;
}
