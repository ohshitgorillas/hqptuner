// The server side of three of HQPTuner's own state stores, as one route table for a `stagingWire`: profile
// descriptions (GET/PUT /api/descriptions, `{profiles}` both ways), favorites (GET/PUT /api/favorites,
// `{filters, modulators}`) and narrowing (GET/PUT /api/narrowing, `{facets}` both ways). Each answers with the shape
// its real route answers, from this file's own table: an area the table names as refusing answers its PUT with a
// refusal in FastAPI's `detail` shape, and every other request with the stored value unchanged.
//
// Alongside the routes, one user action per area that saves through the store's own public API: a description typed
// and flushed, a filter starred, a facet moved and flushed. A save the table refuses is how a failed save reaches the
// store, and a save it accepts is how that area next succeeds.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { ok, bad } from "./wire.js";
import { NARROWING_DEFAULTS } from "./narrowingwire.js";
import { fakeClock } from "../clock.js";
import {
  descriptions,
  descriptionError,
  queueDescription,
  flushDescriptions,
} from "../../../../hqptuner/static/store/matrix/descriptions.js";
import { favoriteFilters, favoritesError, toggleFavorite } from "../../../../hqptuner/static/store/narrow/favorites.js";
import { nQuality, resetNarrowing } from "../../../../hqptuner/static/store/narrow/state.js";
import {
  narrowingError,
  hydrateNarrowing,
  flushNarrowing,
  initNarrowing,
} from "../../../../hqptuner/static/store/narrow/persist.js";

/** @typedef {import("./wire.js").FakeResponse} FakeResponse */
/** @typedef {import("./wire.js").FakeRequest} FakeRequest */
/** @typedef {"description" | "favorite" | "narrowing"} Area */

/** Each area's REST path. */
/** @type {Record<Area, string>} */
const PATHS = { description: "/api/descriptions", favorite: "/api/favorites", narrowing: "/api/narrowing" };

/** The status a refused save answers with. */
const REFUSAL_STATUS = 500;

/** The profile a description is typed for, and two texts typed for it. */
const PROFILE = "Living Room";
const TEXTS = ["Wide stereo, gentle tilt below 200 Hz.", "Near field, flat."];

/** The stamp the server puts on a description it accepts. */
const STAMP = "2026-02-03T04:05:06+00:00";

/** A filter name to star, as the engine enumerates it. */
const FILTER = "poly-sinc-gauss-xla";

/** Two in-domain quality picks, alternated so every move is a change. */
const QUALITY_PICKS = [4, 5];

/**
 * The fake server's table: the area whose saves it refuses, if any, and how many refusals it has answered, so every
 * refusal carries a detail of its own.
 *
 * @type {{ refusing: Area | null, refusals: number }}
 */
const table = { refusing: null, refusals: 0 };

/** Every action so far, so each save carries a value that differs from the one before it. */
let moves = 0;

initNarrowing(fakeClock().clock);

/**
 * The PUT answer for an area: a refusal while the table names it, the stored value otherwise.
 *
 * @param {Area} area
 * @param {FakeResponse} stored
 * @returns {FakeResponse}
 */
function answer(area, stored) {
  if (table.refusing !== area) return stored;
  table.refusals += 1;
  return bad(REFUSAL_STATUS, `State directory is read-only (${table.refusals}).`);
}

/**
 * The route table for a `stagingWire`: answers the three areas' paths, and falls through on every other path.
 *
 * @param {string} path
 * @param {FakeRequest} opts
 * @returns {FakeResponse | undefined}
 */
export function saveRoutes(path, opts) {
  const put = opts.method === "PUT";
  const bare = path.split("?")[0];
  if (bare === PATHS.description) {
    const stored = ok({ profiles: put ? { [PROFILE]: { text: TEXTS[0], updated: STAMP } } : {} });
    return put ? answer("description", stored) : stored;
  }
  if (bare === PATHS.favorite) {
    const stored = ok({ filters: put ? JSON.parse(String(opts.body)).filters : [], modulators: [] });
    return put ? answer("favorite", stored) : stored;
  }
  if (bare === PATHS.narrowing) {
    const stored = ok({ facets: { ...NARROWING_DEFAULTS, ...(put ? JSON.parse(String(opts.body)).facets : {}) } });
    return put ? answer("narrowing", stored) : stored;
  }
  return undefined;
}

/**
 * One save in an area through the store's public API, the next value each time.
 *
 * @type {Record<Area, () => Promise<unknown>>}
 */
const SAVES = {
  description: async () => {
    queueDescription(PROFILE, TEXTS[moves % TEXTS.length], fakeClock().clock);
    await flushDescriptions();
  },
  favorite: () => toggleFavorite(FILTER),
  narrowing: async () => {
    nQuality.value = QUALITY_PICKS[moves % QUALITY_PICKS.length];
    await flushNarrowing();
  },
};

/** Every area, in a fixed order. */
/** @type {Area[]} */
export const AREAS = ["description", "favorite", "narrowing"];

/**
 * Save once in `area`, refused by the server when `refused`, accepted otherwise.
 *
 * @param {Area} area
 * @param {boolean} refused
 * @returns {Promise<void>}
 */
export async function save(area, refused) {
  table.refusing = refused ? area : null;
  moves += 1;
  await SAVES[area]();
  table.refusing = null;
}

/**
 * Put the three stores back to a stated start: nothing queued or outstanding to write, narrowing hydrated at its
 * defaults, no description, no star and no error in any area. Expects the case's wire, carrying `saveRoutes`, already
 * installed and accepting every save.
 *
 * @returns {Promise<void>}
 */
export async function resetSaves() {
  table.refusing = null;
  await flushDescriptions();
  resetNarrowing();
  await flushNarrowing();
  await hydrateNarrowing();
  descriptions.value = {};
  favoriteFilters.value = new Set();
  descriptionError.value = "";
  favoritesError.value = "";
  narrowingError.value = "";
}
