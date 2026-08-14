// The fetch fake behind the narrowing persistence suites: the server side of
// the GET/PUT /api/narrowing pair, holding the facet map the way the backend's
// store does (docs/testing.md rule 4 — real path, real shapes, nothing of ours
// stubbed). Shared by tests/js/store/narrowing-persist.test.js and
// tests/js/store/narrowing-rate.test.js.

import { ok, bad } from "./wire.js";

const PATH = "/api/narrowing";

/**
 * The global the fetch fake is installed on, viewed as an optional member: the
 * DOM lib declares `fetch` returning a real `Response`, which this fake does
 * not build.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;

/** @typedef {Record<string, unknown>} Facets */

/**
 * @typedef {{
 *   calls: { path: string, method: string, body?: string }[],
 *   facets: Facets,
 *   hold: boolean,
 *   release: () => void,
 * }} NarrowingWire
 */

/**
 * The persisted facets at their documented defaults — the contract table. The
 * rate half is the three switches that replaced the retired single-select
 * `ratio` and `upsample_only` facets: the tri-state `hide_limited` and the two
 * booleans `odd_rate_only` and `downsafe_only`, wire keys pinned by name.
 */
/** @type {Facets} */
export const NARROWING_DEFAULTS = {
  genre: [],
  genre_mode: "and",
  quality: 0,
  focus: [],
  focus_mode: "or",
  phase: "",
  length: "",
  hide_limited: "auto",
  odd_rate_only: false,
  downsafe_only: false,
  apod_1x: "only",
  apod_nx: "all",
  hires_1x: "hide",
  hires_nx: "all",
};

/**
 * The PUT bodies the wire was handed, newest last, each as its `facets` member.
 *
 * @param {NarrowingWire} w
 * @returns {Facets[]}
 */
export const puts = (w) =>
  w.calls.filter((c) => c.path === PATH && c.method === "PUT").map((c) => JSON.parse(String(c.body)).facets);

/**
 * A fake of the server side of the pair: it holds the facet map, replaces the
 * whole map on a PUT, and answers `{facets}` either way — which is what the
 * real routes do. `hold` parks every answer until `release()`, which is how a
 * case observes what the client did BEFORE its request came back without
 * waiting on a clock.
 *
 * @param {{ facets?: Facets, getStatus?: number, getDetail?: string, putStatus?: number, putDetail?: string }} [cfg]
 * @returns {NarrowingWire}
 */
export function narrowingWire(cfg = {}) {
  /** @type {(() => void)[]} */
  let parked = [];
  /** @type {NarrowingWire} */
  const w = {
    calls: [],
    facets: { ...NARROWING_DEFAULTS, ...(cfg.facets || {}) },
    hold: false,
    release: () => {
      const waiting = parked;
      parked = [];
      for (const resume of waiting) resume();
    },
  };
  const getStatus = cfg.getStatus || 200;
  const putStatus = cfg.putStatus || 200;
  env.fetch = async (/** @type {string} */ path, /** @type {{method?: string, body?: string}} */ opts = {}) => {
    const method = opts.method || "GET";
    w.calls.push({ path, method, body: opts.body });
    if (path !== PATH) return ok({});
    if (w.hold) await new Promise((resolve) => parked.push(() => resolve(undefined)));
    if (method !== "PUT") {
      if (getStatus !== 200) return bad(getStatus, cfg.getDetail);
      return ok({ facets: w.facets });
    }
    if (putStatus !== 200) return bad(putStatus, cfg.putDetail);
    w.facets = { ...NARROWING_DEFAULTS, ...JSON.parse(String(opts.body)).facets };
    return ok({ facets: w.facets });
  };
  return w;
}
