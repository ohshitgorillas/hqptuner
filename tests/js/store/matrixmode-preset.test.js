// Behavioral suite for the Matrix tab's speakers/headphones choice belonging to
// the PRESET rather than to the browser (store/matrixmode.js).
//
// A preset is a whole hqplayerd config, so which transducer it is for is a
// property of that preset. hqplayerd re-serializes its config from its own model
// and would drop an attribute of ours (docs/matrix-spec.md:31), so the choice
// lives in HQPTuner's own sidecar, keyed by preset NAME — the stable join key
// (docs/architecture.md §2) — and reaches the client over one REST pair,
// GET/PUT /api/matrixmodes.
//
// The map is read ONCE, when the store module loads, the way favorites and
// descriptions are: nothing polls. That is why the wire fake below is installed
// at module scope and the store is then pulled in with a dynamic import — a
// plain `import` would hoist above the fake and the load-time read would go out
// over node's real fetch. The whole file therefore shares one wire and one
// already-read map, seeded with every preset the cases name.
//
// The map does not replace the old global choice, it sits beside it: localStorage
// under `hqptuner.dspMode` still answers "what side was I last on", for a preset
// with no entry and for the moments there is no preset at all.
//
// The wire is faked, never a store function (docs/testing.md rule 4): it speaks
// the real paths with the real shapes, HOLDS the map the way the backend's store
// does, and records the PUT bodies it is handed. Which preset the view follows is
// driven the way the app drives it — `config.active` for the applied one,
// `pendingPreset` for a preview.
//
// Module-level signals outlive a test, so `reset()` reassigns every tree this
// suite touches and empties the staged buffer through `discardAll()`.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/matrixmode-preset.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { config, matrixConfig, pendingPreset } from "../../../hqptuner/static/store/signals.js";
import { stagedCount } from "../../../hqptuner/static/store/resolve.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { ok, stagingWire, quiesce } from "../support/wire.js";
import { useStorage, dropStorage } from "../support/storage.js";

/** @typedef {import("../support/wire.js").StagingWire} StagingWire */

const PATH = "/api/matrixmodes";
const MODE_KEY = "hqptuner.dspMode";
const SPK = "Night"; // recorded as speakers
const HP = "Studio"; // recorded as headphones
const UNRECORDED = "Attic"; // in the picker, absent from the map

/** The map the wire holds, as the backend's store would hold it. @type {Record<string, string>} */
const MODES = { [SPK]: "speakers", [HP]: "headphones" };

/** The PUT bodies the wire was handed, newest last. @type {{ name: string, mode: string }[]} */
const PUTS = [];

// The server side of the pair, over the staging wire the rest of the client
// needs. Installed BEFORE the store is imported, so the load-time read of the
// map is answered by it.
/** @type {StagingWire} */
const W = stagingWire({
  routes: (path, opts) => {
    if (path !== PATH) return undefined;
    if ((opts.method || "GET") !== "PUT") return ok({ presets: MODES });
    const body = JSON.parse(String(opts.body));
    PUTS.push(body);
    MODES[body.name] = body.mode;
    return ok({ presets: MODES });
  },
});

const { matrixMode, setMatrixMode } = await import("../../../hqptuner/static/store/matrixmode.js");

/**
 * Put the module back to a stated starting state: the config naming the applied
 * preset, nothing staged, the preview the case asked for, and the switcher
 * sitting on `mode`.
 *
 * The preview is set AFTER `discardAll()`, which throws away every staged edit
 * and the previewed preset with it — seeding it earlier would leave the fixture
 * claiming a preview the store no longer has.
 *
 * Crossfeed is left ON in the matrix config on purpose: the HAND-driven switcher
 * suppresses it on the way to speakers (tests/js/components/speakers.test.js),
 * so a preset-driven switch that went through that path stages an edit and the
 * staged-count cases see it.
 *
 * @param {{ mode?: string, active?: string, pending?: string | null }} [seams]
 * @returns {Promise<void>}
 */
async function reset({ mode = "headphones", active = "", pending = null } = {}) {
  PUTS.length = 0;
  pendingPreset.value = null;
  config.value = { fields: [], file: {}, active, profiles: null };
  matrixConfig.value = {
    fields: [
      { name: "post_bauer_enabled", value: "1" },
      { name: "post_bauer_preset", value: "default" },
    ],
    rows: [],
  };
  await discardAll();
  pendingPreset.value = pending;
  matrixMode.value = mode;
  await quiesce(W);
  PUTS.length = 0;
}

/**
 * Make `name` the applied preset the view follows, the way the app does — a
 * FRESH config object, since writing the same reference to a signal does not
 * notify.
 *
 * @param {string} name
 * @returns {Promise<void>}
 */
async function lookAt(name) {
  config.value = { fields: [], file: {}, active: name, profiles: null };
  await quiesce(W);
}

// --- the preset carries the choice ------------------------------------------------

test("test_looking_at_a_preset_recorded_as_speakers_puts_the_tab_on_speakers", async () => {
  await reset({ mode: "headphones" });
  await lookAt(SPK);
  assert.equal(matrixMode.value, "speakers");
});

test("test_looking_at_a_preset_recorded_as_headphones_puts_the_tab_on_headphones", async () => {
  await reset({ mode: "speakers" });
  await lookAt(HP);
  assert.equal(matrixMode.value, "headphones");
});

test("test_a_preset_takes_its_own_recorded_mode_and_not_the_one_before_it", async () => {
  await reset({ mode: "speakers" });
  await lookAt(SPK);
  await lookAt(HP);
  assert.equal(matrixMode.value, "headphones");
});

// --- a preview is what is on screen ------------------------------------------------
// A staged-but-not-applied preset is what the user is looking at, so it is the
// one the view follows; the applied preset is the fallback.

test("test_a_previewed_preset_outranks_the_applied_one", async () => {
  await reset({ mode: "headphones", active: HP });
  pendingPreset.value = SPK;
  await quiesce(W);
  assert.equal(matrixMode.value, "speakers");
});

// --- binding the view to the preset stages nothing ------------------------------------
// A preset carries its own pipelines and crossfeed in its own config, so landing
// on it must not stage the pipeline and crossfeed edits the hand-driven switcher
// makes.

test("test_landing_on_a_preset_recorded_as_speakers_stages_no_edit", async () => {
  await reset({ mode: "headphones" });
  await lookAt(SPK);
  assert.equal(stagedCount.value, 0);
});

test("test_landing_on_a_preset_recorded_as_headphones_stages_no_edit", async () => {
  await reset({ mode: "speakers" });
  await lookAt(HP);
  assert.equal(stagedCount.value, 0);
});

// --- a preset with nothing recorded ---------------------------------------------------
// Existing presets are not migrated, and a preset that never chose must not jump
// the user to the other half of the tab.

test("test_looking_at_a_preset_with_no_recorded_mode_leaves_headphones_alone", async () => {
  await reset({ mode: "headphones" });
  await lookAt(UNRECORDED);
  assert.equal(matrixMode.value, "headphones");
});

test("test_looking_at_a_preset_with_no_recorded_mode_leaves_speakers_alone", async () => {
  await reset({ mode: "speakers" });
  await lookAt(UNRECORDED);
  assert.equal(matrixMode.value, "speakers");
});

// --- the hand-driven switcher records the choice ----------------------------------------

test("test_switching_by_hand_records_the_new_mode_for_the_preset_being_looked_at", async () => {
  await reset({ mode: "speakers", active: SPK });
  await setMatrixMode("headphones");
  await quiesce(W);
  assert.deepEqual(PUTS.at(-1), { name: SPK, mode: "headphones" });
});

test("test_switching_by_hand_sends_exactly_one_put", async () => {
  await reset({ mode: "speakers", active: SPK });
  await setMatrixMode("headphones");
  await quiesce(W);
  assert.equal(PUTS.length, 1);
});

test("test_switching_by_hand_records_the_choice_against_a_previewed_preset", async () => {
  await reset({ mode: "speakers", active: HP, pending: SPK });
  await setMatrixMode("headphones");
  await quiesce(W);
  assert.deepEqual(PUTS.at(-1), { name: SPK, mode: "headphones" });
});

// --- nothing to key the choice to ----------------------------------------------------------

test("test_switching_by_hand_with_no_preset_being_looked_at_records_nothing", async () => {
  await reset({ mode: "speakers", active: "" });
  await setMatrixMode("headphones");
  await quiesce(W);
  assert.deepEqual(PUTS, []);
});

test("test_switching_by_hand_with_no_preset_being_looked_at_still_moves_the_tab", async () => {
  await reset({ mode: "speakers", active: "" });
  await setMatrixMode("headphones");
  await quiesce(W);
  assert.equal(matrixMode.value, "headphones");
});

// --- a backend that cannot be reached -------------------------------------------------------
// The read happens once at load, so the unreachable case is a load-time one: a
// SECOND instance of the module is pulled in behind a fetch that rejects the way
// an unreachable backend does. The tab comes up on the last-used mode, the one
// `hqptuner.dspMode` held before this change, rather than failing — so an upgrade
// with the backend down still lands the user on the side they left.

test("test_a_backend_that_cannot_be_reached_leaves_the_tab_on_the_last_used_mode", async () => {
  const env = /** @type {{ fetch?: unknown }} */ (globalThis);
  const saved = env.fetch;
  useStorage().setItem(MODE_KEY, "headphones");
  env.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  // The specifier is assembled at runtime: a literal one with a query string is
  // not statically resolvable, and `tsc -p jsconfig.json` refuses it (TS2307).
  const copy = `${new URL("../../../hqptuner/static/store/matrixmode.js", import.meta.url).href}?offline`;
  const offline = await import(copy);
  env.fetch = saved;
  dropStorage();
  assert.equal(offline.matrixMode.value, "headphones");
});
