// The fetch fake behind the narrowing persistence suites: the server side of
// the GET/PUT /api/narrowing pair, holding the facet map the way the backend's
// store does.
// Shared by tests/js/store/narrow/narrowing-persist.test.js and
// tests/js/store/narrow/narrowing-rate.test.js.
//
// It also carries the facet suites' rig: the live filter items and the static overlay the facets are read from, and the
// dropdown options the narrowing is applied to.

import { enums, metadata } from "../../../../hqptuner/static/store/signals.js";
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
 * booleans `odd_rate_only` and `downsafe_only`, wire keys pinned by name. The
 * 1x half is the apodizing tri-state, now neutral at `all`, and the three-state
 * lossy-source control `lossy_1x`, neutral at `both`; the retired `hires_1x` /
 * `hires_nx` pair is no longer part of the record. `src_format` is the source
 * format the user's library is in, `pcm` or `both`, neutral at `pcm`. `phase`
 * and `length` are multi-select like genre and focus: a JSON list of picked
 * tokens, empty meaning "any".
 */
/** @type {Facets} */
export const NARROWING_DEFAULTS = {
  genre: [],
  genre_mode: "or",
  quality: 0,
  focus: [],
  focus_mode: "and",
  phase: [],
  length: [],
  hide_limited: "auto",
  odd_rate_only: false,
  downsafe_only: false,
  apod_1x: "all",
  apod_nx: "all",
  lossy_1x: "both",
  src_format: "pcm",
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

/**
 * A static overlay row as filters.json ships it.
 *
 * @typedef {{ genre?: string[], quality?: number, focus?: string[], phase?: string, description?: string, length?: string, adaptive?: boolean }} OverlayRow
 */

/**
 * One `<FiltersItem/>` as the backend serves it: the engine's enumeration fields plus the backend-merged overlay row
 * under `static` (undefined on an overlay miss).
 *
 * @param {string} name
 * @param {number} index
 * @param {OverlayRow} [staticRow]
 */
export const filterItem = (name, index, staticRow) => ({
  index: String(index),
  name,
  value: String(index),
  arg: 0,
  description: "3/5 ⥮ Any",
  apodizing: false,
  static: staticRow,
});

/**
 * Reseed the static overlay the facets join by name — module-level signals outlive a test, so every case reassigns it in
 * full.
 *
 * @param {Record<string, unknown>} [overlay]
 */
export function seedOverlay(overlay = {}) {
  metadata.value = {
    settings: {},
    filters: { filters: overlay, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
}

/**
 * Reseed both source signals: `items` are the live enum's filters, `overlay` the static rows for names the engine did
 * not enumerate.
 *
 * @param {ReturnType<typeof filterItem>[]} items
 * @param {Record<string, OverlayRow>} [overlay]
 */
export function seedFilters(items, overlay = {}) {
  enums.value = { filters: items };
  seedOverlay(overlay);
}

/**
 * The options of a dropdown offering the live `filters` plus any `extras`: names the live enumeration does not carry,
 * the way a dropdown offers the filters of the inactive mode.
 *
 * @param {[string, ...unknown[]][]} filters
 * @param {string[]} [extras]
 */
export function dropdownOptions(filters, extras = []) {
  const live = filters.map(([name], i) => ({ label: name, value: String(i) }));
  return live.concat(extras.map((name, i) => ({ label: name, value: String(filters.length + i) })));
}
