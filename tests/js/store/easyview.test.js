// Behavioral suite for Easy Mode's view state — store/easyview.js: the flag that
// says whether the Easy Mode card is showing (`easyMode` / `setEasyMode`) and
// which of its two grids is on screen (`easyGrid` / `setEasyGrid`). Both are
// remembered for the next visit, under `hqptuner.easyMode` and
// `hqptuner.easyGrid`.
//
// The environment is the seam (tests/js/store/liveorder.test.js settled the
// pattern): a working fake localStorage is installed at file scope and only then
// is the module pulled in, so the module's load-time read meets it. Nothing of
// HQPTuner's is stubbed — the setters under test are the ones the card's own
// controls call.
//
// WHAT IS PINNED, AND WHAT IS NOT
//
//   * The two storage KEYS are named here because a key IS the contract a
//     persisted choice makes with the browser: a rename silently drops what
//     every user had saved.
//   * The stored ENCODING is not pinned. How a boolean or a grid name is spelt
//     inside the value is the writer's business, so persistence is read as a
//     round trip instead: set it, load a SECOND instance of the module against
//     the same storage, and ask what that instance came up with. The second
//     instance arrives under a `.fresh-<tag>.js` specifier, which
//     tests/js/support/vendor-resolve.js resolves to easyview.js's own source
//     under a URL node has not cached. The specifier is built rather than
//     written literally because it names a file that is not on disk, which
//     `tsc -p jsconfig.json` refuses as a literal (TS2307).
//   * Both defaults are asserted: the grid starts on "album" and the flag starts
//     DOWN. An install that has never heard of Easy Mode opens on the full
//     controls, which are what exists today.
//
// Cases run in declaration order and share one storage, so the two "after a
// reload" cases are deliberately sequenced: the OFF case runs after a reload has
// already been shown to come up ON, which is what keeps a module that persists
// only the on-state from passing it.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easyview.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage, useThrowingStorage, installStorage } from "../support/storage.js";

const MODE_KEY = "hqptuner.easyMode";
const GRID_KEY = "hqptuner.easyGrid";

const MODULE = "../../../hqptuner/static/store/easyview.js";

// A browser that has never seen Easy Mode: storage present and working, both
// keys absent.
const storage = useStorage();

const view = await import(MODULE);

// Captured the moment the module arrived, so the case reading it does not depend
// on running before anything writes.
const GRID_AT_LOAD = view.easyGrid.value;
const MODE_AT_LOAD = view.easyMode.value;

/**
 * A second, independently loaded instance of the module — what the next page
 * load gets, reading whatever this session left in storage.
 *
 * @param {string} tag
 * @returns {Promise<{ easyMode: { value: boolean }, easyGrid: { value: string } }>}
 */
const reload = (tag) => import(`${MODULE.replace(/\.js$/, `.fresh-${tag}.js`)}`);

// --- where a first-time visitor starts ------------------------------------------

test("test_a_browser_that_has_stored_no_grid_comes_up_on_the_album_grid", () => {
  assert.equal(GRID_AT_LOAD, "album");
});

// An install that has never heard of Easy Mode opens on the full controls.
test("test_a_browser_that_has_stored_no_choice_comes_up_with_easy_mode_off", () => {
  assert.equal(MODE_AT_LOAD, false);
});

// --- the setters move their signals ----------------------------------------------

test("test_choosing_the_playlist_grid_moves_the_grid", () => {
  view.setEasyGrid("playlist");
  assert.equal(view.easyGrid.value, "playlist");
});

test("test_choosing_the_album_grid_moves_the_grid_back", () => {
  view.setEasyGrid("playlist");
  view.setEasyGrid("album");
  assert.equal(view.easyGrid.value, "album");
});

test("test_turning_easy_mode_on_raises_the_flag", () => {
  view.setEasyMode(true);
  assert.equal(view.easyMode.value, true);
});

test("test_turning_easy_mode_off_lowers_the_flag", () => {
  view.setEasyMode(true);
  view.setEasyMode(false);
  assert.equal(view.easyMode.value, false);
});

// --- a value that is not a grid leaves the grid alone ------------------------------
//
// The card renders one grid container keyed by this value, so a grid set to
// something neither table answers to would leave the user looking at an empty
// card. Each case starts from the NON-default grid, so a setter that "refused"
// by falling back to "album" fails rather than passing.

for (const junk of ["shuffle", "", "albums", "ALBUM"]) {
  test(`test_a_grid_set_to_${junk || "nothing"}_stays_where_it_was`, () => {
    view.setEasyGrid("playlist");
    view.setEasyGrid(junk);
    assert.equal(view.easyGrid.value, "playlist");
  });
}

// --- the keys the choices are kept under -------------------------------------------

test("test_the_chosen_grid_is_written_to_the_browsers_easy_grid_key", () => {
  storage.removeItem(GRID_KEY);
  view.setEasyGrid("playlist");
  assert.notEqual(storage.getItem(GRID_KEY), null);
});

test("test_the_easy_mode_flag_is_written_to_the_browsers_easy_mode_key", () => {
  storage.removeItem(MODE_KEY);
  view.setEasyMode(true);
  assert.notEqual(storage.getItem(MODE_KEY), null);
});

// --- and what was kept is what the next load comes up with ---------------------------

test("test_the_grid_a_session_ended_on_is_the_grid_a_reload_comes_up_on", async () => {
  view.setEasyGrid("playlist");
  assert.equal((await reload("gridplaylist")).easyGrid.value, "playlist");
});

test("test_easy_mode_left_on_is_still_on_after_a_reload", async () => {
  view.setEasyMode(true);
  assert.equal((await reload("modeon")).easyMode.value, true);
});

test("test_easy_mode_left_off_is_off_after_a_reload", async () => {
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

test("test_a_storage_that_refuses_writes_leaves_the_chosen_grid_driving_the_session", () => {
  view.setEasyGrid("album");
  useThrowingStorage();
  let grid;
  try {
    view.setEasyGrid("playlist");
    grid = view.easyGrid.value;
  } finally {
    installStorage(storage);
  }
  assert.equal(grid, "playlist");
});

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

test("test_a_storage_that_refuses_reads_comes_up_on_the_album_grid", async () => {
  useThrowingStorage();
  let grid;
  try {
    grid = (await reload("throwing")).easyGrid.value;
  } finally {
    installStorage(storage);
  }
  assert.equal(grid, "album");
});
