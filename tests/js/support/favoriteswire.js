// The fetch fake for the server-backed favorites store (store/narrow/favorites.js).
//
// Favorites are filter NAMES kept in HQPTuner's own state dir and served by one
// REST pair — GET /api/favorites -> {filters: [...]} and
// PUT /api/favorites {filters: [...]} -> {filters: [...]} — with no daemon
// behind it. The fake speaks exactly those paths with exactly those shapes
// (docs/testing.md rule 4); no store function is ever stubbed.
//
// It HOLDS the list the way the backend's store does, and applies the same two
// normalizations the store applies — deduplicate and sort — so "a PUT replaces
// the whole set" and "duplicates collapse" are observable through it rather
// than assumed.
//
// `hold` parks every answer until `release()`, which is how a suite observes
// what the client did BEFORE its request came back (an optimistic star, a
// cleared error) without waiting on a clock.

import { ok, bad } from "./wire.js";

export { settle } from "./livepresetwire.js";

/** @typedef {import("./wire.js").FakeResponse} FakeResponse */
/** @typedef {import("./wire.js").FakeRequest} FakeRequest */

/**
 * @typedef {{
 *   filters: string[],
 *   getStatus: number,
 *   putStatus: number,
 *   getDetail?: string,
 *   putDetail?: string,
 * }} FavoritesWireState
 */

/**
 * @typedef {{
 *   calls: { path: string, method: string, body?: string }[],
 *   filters: string[],
 *   hold: boolean,
 *   release: () => void,
 *   park: (resume: () => void) => void,
 * }} FavoritesWire
 */

/**
 * The global a wire fake installs a `fetch` on, viewed as an optional member:
 * the DOM lib declares it returning a real `Response`, which this fake does not
 * build.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;

/** @param {unknown} names @returns {string[]} */
const normalize = (names) => [...new Set(Array.isArray(names) ? names.map(String) : [])].sort();

/**
 * The PUT bodies a wire was handed, newest last, each as its `filters` member.
 *
 * @param {FavoritesWire} w
 * @returns {string[][]}
 */
export const puts = (w) =>
  w.calls
    .filter((c) => c.path === "/api/favorites" && c.method === "PUT")
    .map((c) => JSON.parse(String(c.body)).filters);

/**
 * The list the fake HOLDS and the calls it was handed, with no `fetch`
 * installed — for the suites whose own wire owns the global and only needs the
 * favorites endpoint routed into it.
 *
 * @param {string[]} [filters]
 * @returns {FavoritesWire}
 */
export function favoritesState(filters = []) {
  /** @type {(() => void)[]} */
  let parked = [];
  return {
    calls: [],
    filters: normalize(filters),
    hold: false,
    release: () => {
      const waiting = parked;
      parked = [];
      for (const resume of waiting) resume();
    },
    park: (resume) => parked.push(resume),
  };
}

/**
 * @param {Partial<FavoritesWireState>} [cfg]
 * @returns {FavoritesWire}
 */
export function favoritesWire(cfg = {}) {
  /** @type {FavoritesWireState} */
  const c = { filters: [], getStatus: 200, putStatus: 200, ...cfg };
  const w = favoritesState(c.filters);
  /** @param {string} method @param {string | undefined} body @returns {FakeResponse} */
  const answer = (method, body) => {
    if (method === "PUT") {
      if (c.putStatus !== 200) return bad(c.putStatus, c.putDetail);
      w.filters = normalize(JSON.parse(String(body)).filters);
      return ok({ filters: w.filters });
    }
    if (c.getStatus !== 200) return bad(c.getStatus, c.getDetail);
    return ok({ filters: w.filters });
  };
  env.fetch = async (/** @type {string} */ path, /** @type {FakeRequest} */ opts = {}) => {
    const method = opts.method || "GET";
    w.calls.push({ path, method, body: opts.body });
    if (path !== "/api/favorites") return ok({});
    if (w.hold) await new Promise((resolve) => w.park(() => resolve(undefined)));
    return answer(method, opts.body);
  };
  return w;
}

/**
 * The same endpoint as a `routes` callback, for the suites whose own wire
 * (`staticWire`, `stagingWire`) must keep answering the staging paths.
 *
 * @param {FavoritesWire} w
 * @returns {(path: string, opts: FakeRequest) => FakeResponse | undefined}
 */
export const favoritesRoutes =
  (w) =>
  (path, opts = {}) => {
    if (path !== "/api/favorites") return undefined;
    const method = opts.method || "GET";
    w.calls.push({ path, method, body: opts.body });
    if (method === "PUT") w.filters = normalize(JSON.parse(String(opts.body)).filters);
    return ok({ filters: w.filters });
  };
