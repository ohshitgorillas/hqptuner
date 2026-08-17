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
import { discardAll, edit } from "../../../hqptuner/static/store/actions.js";
import { ok, stagingWire, quiesce } from "../support/wire.js";
import { useStorage, dropStorage } from "../support/storage.js";

/** @typedef {import("../support/wire.js").StagingWire} StagingWire */

const PATH = "/api/matrixmodes";
const MODE_KEY = "hqptuner.dspMode";
const SPK = "Night"; // recorded as speakers
const HP = "Studio"; // recorded as headphones
const UNRECORDED = "Attic"; // in the picker, absent from the map

// One ordinary daemon field, carried by every config this file assigns so that
// an edit staged against it keeps its baseline across a change of preset.
const FIELDS = [{ name: "volume_max", value: "-3" }];

/** The map as the backend holds it before anything in this file writes. @type {Record<string, string>} */
const PRISTINE = { [SPK]: "speakers", [HP]: "headphones" };

/** The map the wire is holding right now; `reset()` puts it back. @type {Record<string, string>} */
const MODES = { ...PRISTINE };

/** The PUT bodies the wire was handed, newest last. @type {{ name: string, mode: string }[]} */
const PUTS = [];

/** Every read of the map the wire has been asked for, over the whole file. @type {string[]} */
const GETS = [];

// The server side of the pair, over the staging wire the rest of the client
// needs. Installed BEFORE the store is imported, so the load-time read of the
// map is answered by it.
//
// Reads are counted for the life of the file and NOT reset between cases: "read
// once when the module loads" is a claim about the whole session, and a store
// that re-read on every preset change would leave every individual case looking
// innocent.
/** @type {StagingWire} */
const W = stagingWire({
  routes: (path, opts) => {
    if (path !== PATH) return undefined;
    const method = opts.method || "GET";
    if (method !== "PUT") {
      GETS.push(method);
      return ok({ presets: MODES });
    }
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
  for (const name of Object.keys(MODES)) delete MODES[name];
  Object.assign(MODES, PRISTINE);
  pendingPreset.value = null;
  config.value = { fields: FIELDS, file: {}, active, profiles: null };
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
  config.value = { fields: FIELDS, file: {}, active: name, profiles: null };
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
//
// The claim is that the count is UNCHANGED, not that it is zero, so each case
// stages one unrelated edit of its own first: a count read against an empty
// buffer cannot tell "stages nothing" from "throws the buffer away".

test("test_landing_on_a_preset_recorded_as_speakers_leaves_the_staged_count_where_it_was", async () => {
  await reset({ mode: "headphones" });
  await edit("volume_max", "-9");
  await lookAt(SPK);
  assert.equal(stagedCount.value, 1);
});

test("test_landing_on_a_preset_recorded_as_headphones_leaves_the_staged_count_where_it_was", async () => {
  await reset({ mode: "speakers" });
  await edit("volume_max", "-9");
  await lookAt(HP);
  assert.equal(stagedCount.value, 1);
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

// Every click records, including one on the half already displayed: that is how
// a preset with no recorded mode gets bound to the side it opened on. A store
// that skipped the write when the requested mode matches the current one leaves
// that preset unbound for ever, and no case that flips sides can see it.
test("test_clicking_the_half_already_displayed_still_records_it", async () => {
  await reset({ mode: "speakers", active: UNRECORDED });
  await setMatrixMode("speakers");
  await quiesce(W);
  assert.deepEqual(PUTS.at(-1), { name: UNRECORDED, mode: "speakers" });
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

// With no preset to key the choice to, the browser's own memory is all there is:
// the click still has to leave the last-used side behind, or a reload with no
// preset lands the user back on the other half.
test("test_switching_by_hand_with_no_preset_being_looked_at_still_remembers_the_side", async () => {
  const storage = useStorage();
  await reset({ mode: "speakers", active: "" });
  await setMatrixMode("headphones");
  await quiesce(W);
  const stored = storage.getItem(MODE_KEY);
  dropStorage();
  assert.equal(stored, "headphones");
});

// --- the map is read once, when the module loads ---------------------------------------
// Nothing polls it: a choice made in another browser turns up on reload, not by
// itself. The count is over the whole file, and the one read it allows is the
// load-time one every case above already depended on.

test("test_the_map_is_read_once_and_not_again_as_presets_come_and_go", async () => {
  await reset({ mode: "headphones" });
  await lookAt(SPK);
  await lookAt(HP);
  await lookAt(UNRECORDED);
  assert.equal(GETS.length, 1);
});

// --- what the tab comes up on --------------------------------------------------------------
// The map is read at load, so anything about the STARTING mode is a load-time
// claim and the already-loaded instance above cannot state it. Each case below
// pulls in a second instance behind a stated fetch and a stated storage.
//
// Both halves are covered every time, deliberately: seeded with only one, a
// build that never reads storage at all still passes whenever that half happens
// to be the module's own default.

/**
 * Load another instance of the store behind a stated fetch, and let its
 * load-time read settle before handing it back.
 *
 * The specifier is assembled at runtime rather than written as a literal: a
 * literal one naming a `.fresh-<tag>.js` file is not on disk and
 * `tsc -p jsconfig.json` refuses it (TS2307). The `.fresh-<tag>.js` suffix is
 * what makes it a fresh instance — tests/js/support/vendor-resolve.js resolves
 * it to a URL node has not cached, and loads the real module's source under
 * that URL.
 *
 * @param {string} tag
 * @param {() => Promise<unknown>} fetchImpl
 * @returns {Promise<{ matrixMode: { value: string } }>}
 */
async function loadCopy(tag, fetchImpl) {
  const env = /** @type {{ fetch?: unknown }} */ (globalThis);
  const saved = env.fetch;
  env.fetch = fetchImpl;
  const copy = new URL(`../../../hqptuner/static/store/matrixmode.fresh-${tag}.js`, import.meta.url).href;
  const loaded = await import(copy);
  await quiesce(W);
  env.fetch = saved;
  return loaded;
}

/** A backend that is up and holds no recorded mode for anything. */
const emptyMap = async () => ok({ presets: {} });

/** A backend that cannot be reached, failing the way `fetch` itself does. */
const unreachable = async () => {
  throw new TypeError("fetch failed");
};

for (const side of ["speakers", "headphones"]) {
  // Nothing recorded for any preset, so the browser's own memory is what is
  // left: `hqptuner.dspMode`, the key that held the single global choice before
  // this change, so an upgrade lands the user on the side they left.
  test(`test_the_tab_comes_up_on_the_last_used_side_${side}`, async () => {
    useStorage().setItem(MODE_KEY, side);
    const fresh = await loadCopy(`initial-${side}`, emptyMap);
    dropStorage();
    assert.equal(fresh.matrixMode.value, side);
  });

  // The map cannot be read at all. The fallback is the same one, and reaching it
  // rather than failing is the point: the tab still opens.
  test(`test_a_backend_that_cannot_be_reached_leaves_the_tab_on_${side}`, async () => {
    useStorage().setItem(MODE_KEY, side);
    const offline = await loadCopy(`offline-${side}`, unreachable);
    dropStorage();
    assert.equal(offline.matrixMode.value, side);
  });
}
