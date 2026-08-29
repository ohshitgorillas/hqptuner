// Behavioral suite for Easy Mode's view state — store/easyview.js: the flag that
// says whether the Easy Mode card is showing (`easyMode` / `setEasyMode`),
// remembered for the next visit under `hqptuner.easyMode`; the help panel, which
// is NOT remembered; and the knob positions each preset's tile was last written
// at (`rememberKnobs` / `knobsFor`), which are.
//
// THERE IS NO GRID ANY MORE. The card lays out one set of tiles, so nothing
// chooses between two and nothing is stored under `hqptuner.easyGrid` — which is
// read here as a fact about the browser's storage rather than about the module's
// exports, at the foot of the first section.
//
// The environment is the seam (tests/js/store/liveorder.test.js settled the
// pattern): a working fake localStorage is installed at file scope and only then
// is the module pulled in, so the module's load-time read meets it. Nothing of
// HQPTuner's is stubbed — the setters under test are the ones the card's own
// controls call.
//
// WHAT IS PINNED, AND WHAT IS NOT
//
//   * The storage KEY `hqptuner.easyMode` is named here because a key IS the
//     contract a persisted choice makes with the browser: a rename silently
//     drops what every user had saved.
//   * The stored ENCODING is not pinned. How a boolean is spelt inside the value
//     is the writer's business, so persistence is read as a round trip instead:
//     set it, load a SECOND instance of the module against the same storage, and
//     ask what that instance came up with. The second instance arrives under a
//     `.fresh-<tag>.js` specifier, which tests/js/support/vendor-resolve.js
//     resolves to easyview.js's own source under a URL node has not cached. The
//     specifier is built rather than written literally because it names a file
//     that is not on disk, which `tsc -p jsconfig.json` refuses as a literal
//     (TS2307).
//   * Both defaults are asserted: the flag starts DOWN and the help panel starts
//     CLOSED. An install that has never heard of Easy Mode opens on the full
//     controls, which are what exists today.
//   * The help panel is the one piece of view state that is NOT remembered, so
//     it is read twice: closed at load, and closed again through a fresh
//     instance after a session left it open.
//
// Every case sets up the state it reads, whatever ran before it. The cases share
// one storage and node runs them in declaration order, but nothing here leans on
// that: the "left off" reload raises the flag itself before lowering it, so it
// stays non-vacuous run alone or reordered.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easyview.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage, useThrowingStorage, installStorage } from "../support/storage.js";

const MODE_KEY = "hqptuner.easyMode";

// The key the retired grid choice was kept under. Named so that "nothing is
// stored there any more" can be read at all — a key name is contract with the
// browser, and a card that still wrote one would leave a value behind on every
// install.
const GRID_KEY = "hqptuner.easyGrid";

const MODULE = "../../../hqptuner/static/store/easyview.js";

// A browser that has never seen Easy Mode: storage present and working, both
// keys absent.
const storage = useStorage();

const view = await import(MODULE);

// Captured the moment the module arrived, so the case reading it does not depend
// on running before anything writes.
const MODE_AT_LOAD = view.easyMode.value;
const HELP_AT_LOAD = view.easyHelp.value;

/**
 * A second, independently loaded instance of the module — what the next page
 * load gets, reading whatever this session left in storage.
 *
 * @param {string} tag
 * @returns {Promise<{
 *   easyMode: { value: boolean },
 *   easyHelp: { value: boolean },
 *   knobsFor: (presetId: string) => Record<string, string>,
 * }>}
 */
const reload = (tag) => import(`${MODULE.replace(/\.js$/, `.fresh-${tag}.js`)}`);

// --- where a first-time visitor starts ------------------------------------------

// An install that has never heard of Easy Mode opens on the full controls.
test("test_a_browser_that_has_stored_no_choice_comes_up_with_easy_mode_off", () => {
  assert.equal(MODE_AT_LOAD, false);
});

// The help panel is the other piece of view state, and the only one that is NOT
// remembered. Read at load rather than after a setter, because "closed until
// asked for" is the whole claim: a build that shipped the panel open would greet
// every user with it, and a component-level case cannot catch that — the card's
// own suite puts the signal down before each render, so it can only read what
// the card does with a signal that is already false.
test("test_a_fresh_load_comes_up_with_the_help_panel_closed", () => {
  assert.equal(HELP_AT_LOAD, false);
});

// And it stays un-remembered: a session that left the panel open hands the next
// load a closed one. Read through a second instance of the module the same way
// the flag is, which is what makes it the opposite claim to the flag's rather
// than a restatement of the default above.
test("test_a_help_panel_left_open_is_closed_again_after_a_reload", async () => {
  view.easyHelp.value = true;
  assert.equal((await reload("helpopen")).easyHelp.value, false);
});

// --- the setter moves its signal ----------------------------------------------

test("test_turning_easy_mode_on_raises_the_flag", () => {
  view.setEasyMode(true);
  assert.equal(view.easyMode.value, true);
});

test("test_turning_easy_mode_off_lowers_the_flag", () => {
  view.setEasyMode(true);
  view.setEasyMode(false);
  assert.equal(view.easyMode.value, false);
});

// --- the key NAME the choice is kept under ----------------------------------------
//
// Narrow on purpose, and narrower than it looks: what a choice is worth on the
// next visit is the round trip below, which this says nothing about. What it
// pins is the NAME — a key renamed drops every user's saved choice on the floor,
// and the round trip cannot see that, because a renamed key round-trips through
// itself perfectly.

test("test_the_easy_mode_flag_is_kept_under_the_hqptuner_easy_mode_key_name", () => {
  storage.removeItem(MODE_KEY);
  view.setEasyMode(true);
  assert.notEqual(storage.getItem(MODE_KEY), null);
});

// And the key that is no longer written. The card has one set of tiles and
// nothing to choose between, so a session that exercises everything the store
// offers leaves that key empty — a module still keeping a grid there would be
// keeping a choice the user is never given.
test("test_nothing_is_written_to_the_retired_easy_grid_key", () => {
  storage.removeItem(GRID_KEY);
  view.setEasyMode(true);
  view.rememberKnobs("lifelike", { emphasis: "transients" });
  assert.equal(storage.getItem(GRID_KEY), null);
});

// --- and what was kept is what the next load comes up with ---------------------------

test("test_easy_mode_left_on_is_still_on_after_a_reload", async () => {
  view.setEasyMode(true);
  assert.equal((await reload("modeon")).easyMode.value, true);
});

// The flag is raised inside the case before it is lowered, so what storage holds
// at the reload can only be the LOWERING: a module that persists the on-state and
// leaves the off-state to the default is red here whatever order this file runs
// in, and so is one that never clears the key.
test("test_easy_mode_left_off_is_off_after_a_reload", async () => {
  view.setEasyMode(true);
  view.setEasyMode(false);
  assert.equal((await reload("modeoff")).easyMode.value, false);
});

// --- storage that refuses ------------------------------------------------------------
//
// A browser with storage blocked by policy, or a full quota: the member is there
// and throws on use. The session goes on regardless — the choice the user just
// made drives this page, it simply is not there next time. The working storage is
// put back in a finally, so a case that throws does not take the rest of the file
// with it.

test("test_a_storage_that_refuses_writes_leaves_the_easy_mode_flag_driving_the_session", () => {
  view.setEasyMode(false);
  useThrowingStorage();
  let on;
  try {
    view.setEasyMode(true);
    on = view.easyMode.value;
  } finally {
    installStorage(storage);
  }
  assert.equal(on, true);
});

// A read that throws is the load-time half: whether the page opens into Easy
// Mode at all.

test("test_a_storage_that_refuses_reads_comes_up_with_easy_mode_off", async () => {
  useThrowingStorage();
  let on;
  try {
    on = (await reload("throwmode")).easyMode.value;
  } finally {
    installStorage(storage);
  }
  assert.equal(on, false);
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
