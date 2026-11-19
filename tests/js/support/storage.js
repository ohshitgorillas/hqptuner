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

// The three members our code reads, over a map a case can inspect directly, holding `seed` to begin with.
/** @param {Record<string, string>} [seed] */
export function fakeStorage(seed = {}) {
  /** @type {Map<string, string>} */
  const map = new Map(Object.entries(seed));
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
/** @param {Record<string, string>} [seed] */
export function useStorage(seed) {
  const storage = fakeStorage(seed);
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
export function throwingStorage() {
  return {
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
}

export function useThrowingStorage() {
  const storage = throwingStorage();
  env.localStorage = storage;
  return storage;
}

// The display-format ids the plate suites choose between.
export const AUTO = "auto";
export const EXPANDED = "expanded";
export const NORMAL = "normal";
export const COMPACT = "compact";

// A window smaller than Normal and Expanded, a little bigger than Compact in height only, which Auto lays out at Compact.
const SMALL = { w: 1080, h: 810 };
// A window larger than every format.
export const LARGE = { w: 1500, h: 1100 };

/**
 * The plate suites' rig over the fake storage: `choose` makes a display-format choice through the prefs module's
 * setter, read with optional access so a prefs module without one fails the cases on their assertions, and `reset`
 * installs a fresh storage, chooses Auto and puts the window at SMALL. The modules are handed in, so this one loads
 * neither before a suite has installed its storage.
 *
 * @param {{ prefs: { setDisplayFormat?(v: string): void }, viewport: { value: { w: number, h: number } } }} modules
 */
export function displayFormatRig({ prefs, viewport }) {
  /** @param {string} format */
  const choose = (format) => prefs.setDisplayFormat?.(format);
  const reset = () => {
    useStorage();
    choose(AUTO);
    viewport.value = SMALL;
  };
  return { choose, reset };
}
