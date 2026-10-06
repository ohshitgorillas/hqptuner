// Behavioral suite for store/easy/easyview.js's knob record: the knob positions
// each preset was last written at (`rememberKnobs` / `knobsFor`), remembered for
// the next visit. Nothing is stored under the retired `hqptuner.easyGrid` key.
//
// The environment is the seam: a working fake localStorage is installed at file
// scope and only then is the module pulled in, so the module's load-time read
// meets it. Nothing of HQPTuner's is stubbed.
//
// The stored ENCODING is not pinned, so persistence is read as a round trip: set
// it, load a SECOND instance of the module against the same storage, and ask what
// that instance came up with. The second instance arrives under a
// `.fresh-<tag>.js` specifier, which tests/js/support/vendor-resolve.js resolves
// to easyview.js's own source under a URL node has not cached. The specifier is
// built rather than written literally because it names a file that is not on
// disk, which `tsc -p jsconfig.json` refuses as a literal (TS2307).
//
// Every case sets up the state it reads, whatever ran before it.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easyview.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

// The key the retired grid choice was kept under. Named so that "nothing is
// stored there any more" can be read at all — a key name is contract with the
// browser, and a card that still wrote one would leave a value behind on every
// install.
const GRID_KEY = "hqptuner.easyGrid";

const MODULE = "../../../hqptuner/static/store/easy/easyview.js";

// A browser that has never seen Easy Mode: storage present and working, both
// keys absent.
const storage = useStorage();

const view = await import(MODULE);

/**
 * A second, independently loaded instance of the module — what the next page
 * load gets, reading whatever this session left in storage.
 *
 * @param {string} tag
 * @returns {Promise<{
 *   knobsFor: (presetId: string) => Record<string, string>,
 * }>}
 */
const reload = (tag) => import(`${MODULE.replace(/\.js$/, `.fresh-${tag}.js`)}`);

// The key that is no longer written: there is nothing to choose between, so the
// knob setter leaves that key empty — a module still keeping a grid there would
// be keeping a choice the user is never given.
test("test_the_knob_setter_writes_nothing_to_the_retired_easy_grid_key", () => {
  storage.removeItem(GRID_KEY);
  view.rememberKnobs("lifelike", { emphasis: "transients" });
  assert.equal(storage.getItem(GRID_KEY), null);
});

// --- the knob positions a preset's tile was last written at ---------------------------
//
// The other thing this store keeps: for each preset, the knob positions it was
// last written at, recorded by `rememberKnobs` and read back by `knobsFor` —
// under the preset's id alone, there being no grid to key it by. What USES the
// record is the tile: a tile that is not lit shows what was recorded for it
// instead of its knobs' defaults, and that half is
// tests/js/components/easytiles-knobs.test.js's. These cases are about the
// record itself: what a preset nothing was written for reads back as, that each
// preset keys it separately, and that it is still there next visit.
//
// The stored ENCODING is not pinned, for the same reason the flag's is not: how
// a preset is spelt into a key, and where the record lives inside storage, is
// the writer's business. Every case reads through `knobsFor`, and the reload
// case reads through a second instance of the module the same way the flag does.
// The STORAGE KEY NAME is not pinned either, unlike the flag's — the spec this
// file was written from does not name one, so there is nothing to pin, and a
// name invented here would be a guess asserted as contract.
//
// Preset ids are wire identifiers and are named outright. `concert-hall` and
// `purist` are the two nothing here ever records for, which is what makes them
// the ones the "nothing recorded" cases ask about.

const RECORDED = { material: "lossy", emphasis: "transients" };

test("test_a_preset_nothing_was_ever_recorded_for_reads_back_as_no_positions", () => {
  assert.deepEqual(view.knobsFor("concert-hall"), {});
});

test("test_the_positions_recorded_for_a_preset_are_the_positions_it_reads_back_at", () => {
  view.rememberKnobs("lifelike", RECORDED);
  assert.deepEqual(view.knobsFor("lifelike"), RECORDED);
});

// Recording again is a fresh answer, not an addition to the last one: the tile
// shows where it was written LAST, so a store that merged the two would show a
// knob at a position no single write ever put it in.
test("test_recording_a_preset_again_replaces_the_positions_it_reads_back_at", () => {
  view.rememberKnobs("lifelike", RECORDED);
  view.rememberKnobs("lifelike", { material: "lossless", emphasis: "space" });
  assert.deepEqual(view.knobsFor("lifelike"), { material: "lossless", emphasis: "space" });
});

test("test_positions_recorded_for_one_preset_are_not_recorded_for_another", () => {
  view.rememberKnobs("lifelike", RECORDED);
  assert.deepEqual(view.knobsFor("purist"), {});
});

// The round trip, read the way the flag above is read: a SECOND instance of the
// module, loaded against the storage this session left behind.
test("test_the_positions_a_session_recorded_are_the_positions_a_reload_reads_back", async () => {
  view.rememberKnobs("lifelike", RECORDED);
  assert.deepEqual((await reload("knobs")).knobsFor("lifelike"), RECORDED);
});

test("test_a_reload_reads_back_no_positions_for_a_preset_the_session_never_recorded", async () => {
  view.rememberKnobs("lifelike", RECORDED);
  assert.deepEqual((await reload("knobsother")).knobsFor("purist"), {});
});
