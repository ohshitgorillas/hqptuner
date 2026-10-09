// Rendered suite for what a landed state import leaves the page holding, driven through the state upload in
// hqptuner/static/components/faceplate/settings/About.js: every one of HQPTuner's own stores the page shows is read
// from the server again, so nothing the page held before the import is written back over the imported state.
//
// Driven at the wire: a staging wire answers the real REST paths, and the server side of each store is a table. Before
// the import the server serves one table; POST /api/state-import swaps in the imported one, which is what the import
// does to the stores on disk. The page reaches its pre-import state the way the app does, by reading the first table
// and by the user moving a facet. No store function is stubbed. The upload's change is fired through the renderer's
// vnode seam, since render-to-string fires no events; the control is located by `data-testid="state-import"`.
//
// Favorites and matrix modes are read when their stores load, so the wire is installed at module scope and the stores
// are pulled in by dynamic import after it. One import lands at load, before any case runs, and every case reads a
// different store, so no case depends on another having run.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-settings/about-state-import-stores.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { health, config, matrixConfig } from "../../../../hqptuner/static/store/signals.js";
import { renderTree } from "../../support/vnodeseam.js";
import { ok, stagingWire, quiesce } from "../../support/wire/wire.js";
import { rec, STATE } from "../../support/wire/livepresetwire.js";
import { NARROWING_DEFAULTS } from "../../support/wire/narrowingwire.js";

/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */

const PAYLOAD = {
  reachable: true,
  info: { product: "Signalyst HQPlayer Embedded", engine: "6.0.4", platform: "Linux" },
  release: "6.0.2",
  app_version: "9.8.7",
};

const STATION = "Night";
const STAMP = "2026-02-03T04:05:06+00:00";
const FIELDS = [{ name: "volume_max", value: "-3" }];

const PRE_FAVORITE = "pre-import-filter";
const IMPORTED_FAVORITE = "imported-filter";
const STARRED_AFTER = "starred-after-import";

const PHASE_BEFORE = ["linear"];
const PHASE_IMPORTED = ["minimum"];

const PRE_NOTE = "pre-import note";
const IMPORTED_NOTE = "imported note";

const PRE_SNAPSHOT = "Pre Snap";
const IMPORTED_SNAPSHOT = "Imported Snap";

/**
 * One table of the server's stores, as each store's GET answers it.
 *
 * @typedef {{
 *   favorites: { filters: string[], modulators: string[] },
 *   facets: Record<string, unknown>,
 *   descriptions: Record<string, { text: string, updated: string }>,
 *   snapshots: ReturnType<typeof rec>[],
 *   modes: Record<string, string>,
 * }} Stores
 */

/** @returns {Stores} */
const preImport = () => ({
  favorites: { filters: [PRE_FAVORITE], modulators: [] },
  facets: { ...NARROWING_DEFAULTS },
  descriptions: { [STATION]: { text: PRE_NOTE, updated: STAMP } },
  snapshots: [rec(PRE_SNAPSHOT, "pcm")],
  modes: { [STATION]: "speakers" },
});

/** @returns {Stores} */
const imported = () => ({
  favorites: { filters: [IMPORTED_FAVORITE], modulators: [] },
  facets: { ...NARROWING_DEFAULTS, phase: PHASE_IMPORTED },
  descriptions: { [STATION]: { text: IMPORTED_NOTE, updated: STAMP } },
  snapshots: [rec(IMPORTED_SNAPSHOT, "pcm")],
  modes: { [STATION]: "headphones" },
});

/** The stores the server holds right now. */
let server = preImport();

/** Every request a store route was handed, in arrival order. @type {{ path: string, method: string, body?: string }[]} */
const CALLS = [];

/** A JSON request body, parsed. */
const bodyOf = (/** @type {{ body?: unknown }} */ opts) => JSON.parse(String(opts.body));

/**
 * A store write, applied to the table the way each route stores it: favorites and facets replace what the body
 * carries, a description and a matrix mode replace one entry.
 *
 * @param {string} path
 * @param {{ body?: unknown }} opts
 */
function write(path, opts) {
  const body = bodyOf(opts);
  if (path === "/api/favorites") server.favorites = { ...server.favorites, ...body };
  if (path === "/api/narrowing") server.facets = { ...NARROWING_DEFAULTS, ...body.facets };
  if (path === "/api/descriptions") server.descriptions[body.name] = { text: body.text, updated: STAMP };
  if (path === "/api/matrixmodes") server.modes[body.name] = body.mode;
}

/**
 * What each store route answers, read straight from the table.
 *
 * @param {string} path
 * @returns {unknown}
 */
function read(path) {
  if (path === "/api/favorites") return server.favorites;
  if (path === "/api/narrowing") return { facets: server.facets };
  if (path === "/api/descriptions") return { profiles: server.descriptions };
  if (path === "/api/matrixmodes") return { presets: server.modes };
  const book = Object.fromEntries(server.snapshots.map(({ name, ...record }) => [name, record]));
  return { station: "", presets: server.snapshots, stations: { "": book } };
}

const STORE_ROUTES = new Set([
  "/api/favorites",
  "/api/narrowing",
  "/api/descriptions",
  "/api/matrixmodes",
  "/api/livepresets",
]);

/** @type {StagingWire} */
const W = stagingWire({
  routes: (path, opts) => {
    const method = opts.method || "GET";
    const bare = path.split("?")[0];
    if (bare === "/api/state-import") {
      server = imported();
      return ok({ ok: true });
    }
    if (bare === "/api/health") return ok({ ...PAYLOAD });
    if (bare === "/api/state") return ok({ stale: false, loaded_at: 1, data: STATE("pcm") });
    if (bare === "/api/config") return ok({ data: { fields: FIELDS, file: {}, active: "", profiles: null } });
    if (!STORE_ROUTES.has(bare)) return undefined;
    CALLS.push({ path: bare, method, body: typeof opts.body === "string" ? opts.body : undefined });
    if (method === "PUT") write(bare, opts);
    return ok(read(bare));
  },
});

health.value = { ...PAYLOAD };
config.value = { fields: FIELDS, file: {}, active: "", profiles: null };
matrixConfig.value = {
  fields: [
    { name: "post_bauer_enabled", value: "1" },
    { name: "post_bauer_preset", value: "default" },
  ],
  rows: [],
};

const { About } = await import("../../../../hqptuner/static/components/faceplate/settings/About.js");
const { toggleFavorite, hydrateFavorites } = await import("../../../../hqptuner/static/store/narrow/favorites.js");
const { nPhase, nQuality } = await import("../../../../hqptuner/static/store/narrow/state.js");
const { hydrateNarrowing, flushNarrowing } = await import("../../../../hqptuner/static/store/narrow/persist.js");
const { descriptions, descriptionFor } = await import("../../../../hqptuner/static/store/matrix/descriptions.js");
const { livePresets } = await import("../../../../hqptuner/static/store/live/presets.js");
const { liveMode } = await import("../../../../hqptuner/static/store/ui/prefs.js");
const { matrixMode } = await import("../../../../hqptuner/static/store/matrix/mode.js");

/** The state upload's change handler, or a no-op when the page draws no state upload. */
function onChange() {
  const { seen } = renderTree(html`<${About} />`);
  const fn = seen.find((v) => v.props["data-testid"] === "state-import")?.props.onChange;
  return typeof fn === "function" ? /** @type {(e: unknown) => unknown} */ (fn) : async () => undefined;
}

// The page before the import: every store read from the pre-import table, a facet the user moved and saved, and the
// matrix tab sitting on the side the pre-import map records for the station.
await hydrateFavorites();
await hydrateNarrowing();
nPhase.value = PHASE_BEFORE;
await flushNarrowing();
descriptions.value = { ...server.descriptions };
liveMode.value = true;
matrixMode.value = "speakers";
await quiesce(W);

await onChange()({ target: { files: [new File([new Uint8Array(8)], "hqptuner-state.zip")], value: "" } });
await quiesce(W);

/** The PUT bodies a store route was handed after the import landed, newest last. */
const putsTo = (/** @type {string} */ path) =>
  CALLS.filter((c) => c.path === path && c.method === "PUT").map((c) => JSON.parse(String(c.body)));

test("test_a_star_toggled_after_an_import_writes_the_imported_favorites_and_not_the_ones_before_it", async () => {
  await toggleFavorite(STARRED_AFTER);
  await quiesce(W);
  assert.deepEqual([...(putsTo("/api/favorites").at(-1)?.filters || [])].sort(), [IMPORTED_FAVORITE, STARRED_AFTER]);
});

test("test_a_facet_changed_after_an_import_writes_the_imported_facets_and_not_the_ones_before_it", async () => {
  nQuality.value = 4;
  await flushNarrowing();
  await quiesce(W);
  assert.deepEqual(putsTo("/api/narrowing").at(-1)?.facets.phase, PHASE_IMPORTED);
});

test("test_a_profile_description_after_an_import_is_the_imported_one", () => {
  assert.equal(descriptionFor(STATION)?.text, IMPORTED_NOTE);
});

test("test_the_live_snapshots_after_an_import_are_the_imported_ones", () => {
  assert.deepEqual(
    (livePresets.value || []).map((/** @type {{ name: string }} */ p) => p.name),
    [IMPORTED_SNAPSHOT],
  );
});

test("test_a_station_looked_at_after_an_import_takes_the_matrix_mode_the_import_recorded", async () => {
  config.value = { fields: FIELDS, file: {}, active: STATION, profiles: null };
  await quiesce(W);
  assert.equal(matrixMode.value, "headphones");
});
