// Rendered suite for what a landed state import does to an edit the server never accepted, driven through the state
// upload in hqptuner/static/components/faceplate/settings/About.js: a narrowing facet or a profile description whose
// save failed before the import is still owed when the import lands, and it must not reach the server afterwards. The
// page shows the imported value, and neither the next flush nor the next save writes the owed edit over it.
//
// Driven at the wire: a staging wire answers the real REST paths, and the server side of each store is a table. Before
// the import the server refuses every store write, which is how an edit comes to be owed; POST /api/state-import swaps
// in the imported table and the server accepts writes from then on. No store function is stubbed. The upload's change
// is fired through the renderer's vnode seam, since render-to-string fires no events; the control is located by
// `data-testid="state-import"`.
//
// Stores that read when they load are pulled in by dynamic import after the wire is installed. One import lands at
// load, before any case runs. The narrowing cases run in file order: the flush case before the save case.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-settings/about-state-import-owed.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { health, config } from "../../../../hqptuner/static/store/signals.js";
import { renderTree } from "../../support/vnodeseam.js";
import { ok, bad, stagingWire, quiesce } from "../../support/wire/wire.js";
import { STATE } from "../../support/wire/livepresetwire.js";
import { NARROWING_DEFAULTS } from "../../support/wire/narrowingwire.js";

/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */

const PAYLOAD = {
  reachable: true,
  info: { product: "Signalyst HQPlayer Embedded", engine: "6.0.4", platform: "Linux" },
  release: "6.0.2",
  app_version: "9.8.7",
};

const PROFILE = "Night";
const STAMP = "2026-02-03T04:05:06+00:00";
const FIELDS = [{ name: "volume_max", value: "-3" }];

const PHASE_OWED = ["linear"];
const PHASE_IMPORTED = ["minimum"];

const PRE_NOTE = "pre-import note";
const OWED_NOTE = "owed note";
const IMPORTED_NOTE = "imported note";

const READ_ONLY = "State directory is read-only.";

/**
 * One table of the server's stores, as each store's GET answers it.
 *
 * @typedef {{
 *   facets: Record<string, unknown>,
 *   descriptions: Record<string, { text: string, updated: string }>,
 * }} Stores
 */

/** The stores the server holds right now. @type {Stores} */
let server = {
  facets: { ...NARROWING_DEFAULTS },
  descriptions: { [PROFILE]: { text: PRE_NOTE, updated: STAMP } },
};

/** Whether the server refuses store writes; it does until the import lands. */
let refusing = true;

/**
 * A store write, applied to the table the way each route stores it: facets replace the whole map, a description
 * replaces one entry.
 *
 * @param {string} path
 * @param {{ body?: unknown }} opts
 */
function write(path, opts) {
  const body = JSON.parse(String(opts.body));
  if (path === "/api/narrowing") server.facets = { ...NARROWING_DEFAULTS, ...body.facets };
  if (path === "/api/descriptions") server.descriptions[body.name] = { text: body.text, updated: STAMP };
}

/** What each store route answers, read straight from the table. */
const read = (/** @type {string} */ path) =>
  path === "/api/narrowing" ? { facets: server.facets } : { profiles: server.descriptions };

const STORE_ROUTES = new Set(["/api/narrowing", "/api/descriptions"]);

/** @type {StagingWire} */
const W = stagingWire({
  routes: (path, opts) => {
    const method = opts.method || "GET";
    const bare = path.split("?")[0];
    if (bare === "/api/state-import") {
      server = {
        facets: { ...NARROWING_DEFAULTS, phase: PHASE_IMPORTED },
        descriptions: { [PROFILE]: { text: IMPORTED_NOTE, updated: STAMP } },
      };
      refusing = false;
      return ok({ ok: true });
    }
    if (bare === "/api/health") return ok({ ...PAYLOAD });
    if (bare === "/api/state") return ok({ stale: false, loaded_at: 1, data: STATE("pcm") });
    if (bare === "/api/config") return ok({ data: { fields: FIELDS, file: {}, active: "", profiles: null } });
    if (!STORE_ROUTES.has(bare)) return undefined;
    if (method !== "PUT") return ok(read(bare));
    if (refusing) return bad(500, READ_ONLY);
    write(bare, opts);
    return ok(read(bare));
  },
});

health.value = { ...PAYLOAD };
config.value = { fields: FIELDS, file: {}, active: "", profiles: null };

const { About } = await import("../../../../hqptuner/static/components/faceplate/settings/About.js");
const { nPhase, nQuality } = await import("../../../../hqptuner/static/store/narrow/state.js");
const { hydrateNarrowing, flushNarrowing } = await import("../../../../hqptuner/static/store/narrow/persist.js");
const { descriptions, queueDescription, flushDescriptions } =
  await import("../../../../hqptuner/static/store/matrix/descriptions.js");

/** The state upload's change handler, or a no-op when the page draws no state upload. */
function onChange() {
  const { seen } = renderTree(html`<${About} />`);
  const fn = seen.find((v) => v.props["data-testid"] === "state-import")?.props.onChange;
  return typeof fn === "function" ? /** @type {(e: unknown) => unknown} */ (fn) : async () => undefined;
}

// The page before the import: both stores read from the server, then a facet moved and a description typed, each
// flushed against a server that refuses the write, so both are still owed.
await hydrateNarrowing();
descriptions.value = { ...server.descriptions };
nPhase.value = PHASE_OWED;
await flushNarrowing();
queueDescription(PROFILE, OWED_NOTE);
await flushDescriptions();
await quiesce(W);

await onChange()({ target: { files: [new File([new Uint8Array(8)], "hqptuner-state.zip")], value: "" } });
await quiesce(W);

test("test_a_facet_owed_before_an_import_shows_the_imported_value", () => {
  assert.deepEqual(nPhase.value, PHASE_IMPORTED);
});

test("test_the_next_flush_after_an_import_does_not_write_a_facet_owed_before_it", async () => {
  await flushNarrowing();
  await quiesce(W);
  assert.deepEqual(server.facets.phase, PHASE_IMPORTED);
});

test("test_the_next_facet_save_after_an_import_does_not_write_a_facet_owed_before_it", async () => {
  nQuality.value = 4;
  await flushNarrowing();
  await quiesce(W);
  assert.deepEqual(server.facets.phase, PHASE_IMPORTED);
});

test("test_the_next_flush_after_an_import_does_not_write_a_description_owed_before_it", async () => {
  await flushDescriptions();
  await quiesce(W);
  assert.equal(server.descriptions[PROFILE]?.text, IMPORTED_NOTE);
});
