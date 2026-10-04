// Behavioral suite for hqptuner/static/store/faceplate/settings/hardware.js: the hardware settings' own form. The six
// engine attributes are read from the daemon into a base and a draft, edited in the draft, read back as whether the
// draft differs from the base, sent through the engine's own POST and re-based only on a verified apply, and put back by
// a discard. The all-stations switch rides the POST and never stages.
//
// The wire is the seam: `GET /api/engine` answers the engine table a case hands the fake, and `POST /api/engine`
// records the body it was handed and answers the report the case chose. The draft is reset through `discardHardware`,
// the switch through `setAllStations`, and the base through a fresh load on every case.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-settings/hardware.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULTS,
  HARDWARE_KEYS,
  allStations,
  applyHardware,
  discardHardware,
  hardwareDraft,
  loadHardware,
  setAllStations,
  setHardware,
  staged,
} from "../../../../hqptuner/static/store/faceplate/settings/hardware.js";
import { ok, quiesce, stagingWire } from "../../support/wire/wire.js";

/**
 * @typedef {Record<string, string | number>} EngineTable  the engine attributes as `GET /api/engine` carries them
 * @typedef {{ overrides: Record<string, unknown>, all_presets: unknown }} ApplyBody  a `POST /api/engine` body
 */

//: The engine as the daemon reports it, every attribute off the daemon's default.
const ENGINE = { cuda: "1", multicore: "0", ecores: "pool", nblocks: "4", cuda_dev: "0", cuda_cdev: "1" };

//: The same engine with `multicore` absent from its config.
const NO_MULTICORE = { cuda: "1", ecores: "pool", nblocks: "4", cuda_dev: "0", cuda_cdev: "1" };

//: The same engine with `nblocks` carried as a JSON number.
const NUMERIC_NBLOCKS = { ...ENGINE, nblocks: 4 };

// Read before any case loads or sets anything: what the module comes up with.
const LOADED_AT_IMPORT = hardwareDraft().loaded;
const ALL_STATIONS_AT_IMPORT = allStations.value;

/**
 * A daemon answering the engine's read with `engine` and its write with `report`; returns the write bodies it was
 * handed and the wire, to wait on.
 *
 * @param {{ engine?: EngineTable, report?: unknown }} [d]
 */
function daemon({ engine = ENGINE, report = { verified: { applied: true } } } = {}) {
  /** @type {ApplyBody[]} */
  const bodies = [];
  const wire = stagingWire({
    routes: (path, opts) => {
      if (path !== "/api/engine") return undefined;
      if (opts.method !== "POST") return ok({ engine });
      bodies.push(JSON.parse(String(opts.body)));
      return ok({ report });
    },
  });
  return { bodies, wire };
}

/**
 * Load the engine a daemon reports, over a draft and switch already reset.
 *
 * @param {{ engine?: EngineTable, report?: unknown }} [d]
 */
async function load(d) {
  const w = daemon(d);
  await loadHardware();
  return w;
}

/**
 * Apply the draft against a daemon answering `report`; returns the bodies it was handed.
 *
 * @param {unknown} report
 */
async function apply(report) {
  const { bodies, wire } = daemon({ report });
  await applyHardware();
  await quiesce(wire);
  return bodies;
}

beforeEach(async () => {
  daemon();
  discardHardware();
  setAllStations(false);
  await loadHardware();
});

// --- the keys and the daemon's defaults --------------------------------------------------------------------------

test("test_the_hardware_keys_are_the_six_engine_attributes", () => {
  assert.deepEqual([...HARDWARE_KEYS].sort(), ["cuda", "cuda_cdev", "cuda_dev", "ecores", "multicore", "nblocks"]);
});

test("test_the_defaults_are_the_daemons_own_for_an_absent_attribute", () => {
  assert.deepEqual(DEFAULTS, {
    cuda: "0",
    multicore: "auto",
    ecores: "default",
    nblocks: "0",
    cuda_dev: "-1",
    cuda_cdev: "-1",
  });
});

// --- the load ----------------------------------------------------------------------------------------------------

test("test_the_draft_reads_unloaded_until_the_engine_is_read", () => {
  assert.deepEqual([LOADED_AT_IMPORT, hardwareDraft().loaded], [false, true]);
});

test("test_a_load_reads_the_engines_attributes_into_the_draft", () => {
  assert.deepEqual(hardwareDraft().values, ENGINE);
});

test("test_a_load_reads_the_engines_attributes_into_the_base", () => {
  assert.deepEqual(hardwareDraft().base, ENGINE);
});

test("test_an_attribute_the_engine_omits_loads_at_the_daemons_default", async () => {
  await load({ engine: NO_MULTICORE });
  assert.equal(hardwareDraft().values.multicore, "auto");
});

test("test_an_attribute_the_engine_omits_is_based_at_the_daemons_default", async () => {
  await load({ engine: NO_MULTICORE });
  assert.equal(hardwareDraft().base.multicore, "auto");
});

test("test_a_fresh_load_drops_the_drafts_edits", async () => {
  setHardware("cuda", "convolution");
  await load();
  assert.deepEqual(hardwareDraft().values, ENGINE);
});

// --- the draft over the base -------------------------------------------------------------------------------------

test("test_an_edit_lands_on_its_own_key_only", () => {
  setHardware("ecores", "filter");
  assert.deepEqual(hardwareDraft().values, { ...ENGINE, ecores: "filter" });
});

test("test_an_edit_leaves_the_base_where_the_engine_put_it", () => {
  setHardware("ecores", "filter");
  assert.deepEqual(hardwareDraft().base, ENGINE);
});

test("test_an_edit_makes_the_draft_differ_from_the_base", () => {
  const before = hardwareDraft().differs;
  setHardware("nblocks", "16");
  assert.deepEqual([before, hardwareDraft().differs], [false, true]);
});

test("test_an_edit_back_to_the_base_value_no_longer_differs", () => {
  setHardware("cuda_dev", "2");
  const edited = hardwareDraft().differs;
  setHardware("cuda_dev", "0");
  assert.deepEqual([edited, hardwareDraft().differs], [true, false]);
});

test("test_a_value_equal_to_the_base_as_a_string_does_not_differ", async () => {
  await load({ engine: NUMERIC_NBLOCKS });
  setHardware("nblocks", "4");
  const same = hardwareDraft().differs;
  setHardware("nblocks", "5");
  assert.deepEqual([same, hardwareDraft().differs], [false, true]);
});

test("test_staged_reads_whether_the_draft_differs", () => {
  const before = staged.value;
  setHardware("multicore", "1");
  assert.deepEqual([before, staged.value], [false, true]);
});

// --- the all-stations switch -------------------------------------------------------------------------------------

test("test_all_stations_is_off_until_set", () => {
  setAllStations(true);
  assert.deepEqual([ALL_STATIONS_AT_IMPORT, allStations.value], [false, true]);
});

test("test_all_stations_never_makes_the_draft_differ", () => {
  setAllStations(true);
  const switched = hardwareDraft().differs;
  setHardware("cuda_cdev", "3");
  assert.deepEqual([switched, hardwareDraft().differs], [false, true]);
});

// --- discard -----------------------------------------------------------------------------------------------------

test("test_a_discard_puts_every_edited_value_back_to_the_base", () => {
  setHardware("cuda", "convolution");
  setHardware("nblocks", "16");
  discardHardware();
  assert.deepEqual(hardwareDraft().values, ENGINE);
});

// --- apply -------------------------------------------------------------------------------------------------------

test("test_an_apply_sends_the_draft_as_its_overrides", async () => {
  setHardware("cuda", "convolution");
  const bodies = await apply({ verified: { applied: true } });
  assert.deepEqual(
    bodies.map((b) => b.overrides),
    [{ ...ENGINE, cuda: "convolution" }],
  );
});

test("test_an_apply_sends_all_stations_as_all_presets", async () => {
  const off = (await apply({ verified: { applied: true } })).map((b) => b.all_presets);
  setAllStations(true);
  const on = (await apply({ verified: { applied: true } })).map((b) => b.all_presets);
  assert.deepEqual([off, on], [[false], [true]]);
});

test("test_a_verified_apply_rebases_onto_the_values_sent", async () => {
  setHardware("ecores", "filter");
  await apply({ verified: { applied: true } });
  assert.deepEqual(hardwareDraft().base, { ...ENGINE, ecores: "filter" });
});

test("test_an_apply_the_daemon_did_not_verify_keeps_the_base", async () => {
  setHardware("ecores", "filter");
  await apply({ verified: { applied: false } });
  assert.deepEqual(hardwareDraft().base, ENGINE);
});

test("test_an_apply_the_daemon_did_not_verify_stays_staged", async () => {
  setHardware("ecores", "filter");
  await apply({ verified: { applied: false } });
  assert.equal(staged.value, true);
});

test("test_an_applied_flag_outside_the_verified_report_does_not_rebase", async () => {
  setHardware("ecores", "filter");
  await apply({ applied: true });
  assert.deepEqual(hardwareDraft().base, ENGINE);
});
