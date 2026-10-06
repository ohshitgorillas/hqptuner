// Behavioral suite for store/ui/faceplate.js, the faceplate's browser-held
// preferences: DAC type, DAC chip, top of page, bottom bar, the page meter's
// Range, the stages hidden from the chain rail, and Allow pinned rates.
//
// Each preference has three halves. On the way in: the value the browser holds
// is the value the page comes up with, and a stored value outside the
// preference's set costs the user that one choice and never reaches the page.
// On the way out: a setter moves the signal and stores the new value, and a
// value outside the set is turned away with the signal and the stored value
// both standing.
//
// The environment is the seam: the module reads its keys once, when it is first
// imported, so the fake storage is installed at file scope, SEEDED, and only
// then is the module pulled in. The load-time values are captured the moment
// the module arrives, so the cases asserting on them do not depend on running
// first. The out-of-set cases need a module that has not read anything yet, so
// they load a second instance under a `.fresh-<tag>.js` specifier, which
// tests/js/support/vendor-resolve.js resolves to the module's own source under
// a URL node has not cached. The specifier is built rather than written
// literally because it names a file that is not on disk.
//
// The storage keys are named here because they ARE the contract a persisted
// preference makes with the browser: a rename drops every user's saved choice.
// The values seeded and set are the preferences' own identifiers, the values
// the faceplate's controls carry, never the labels drawn beside them.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const MODULE = "../../../hqptuner/static/store/ui/faceplate.js";

// One row per choice-of-one preference: its signal's export name, its storage
// key, a value from the set that is not the one a fresh browser starts on, a
// second value from the set, and a stored value from outside it. The outside
// values are plausible on purpose: the mockup's own "0"/"1" encoding of the DAC
// type row, and names that read like a member.
const CHOICES = [
  { pref: "dacType", key: "hqptuner.dacType", pick: "r2r", other: "other", outside: "1" },
  { pref: "dacChip", key: "hqptuner.dacChip", pick: "ess", other: "other", outside: "sabre" },
  { pref: "topOfPage", key: "hqptuner.topOfPage", pick: "spectrum", other: "profile", outside: "matrix" },
  { pref: "bottomBar", key: "hqptuner.bottomBar", pick: "none", other: "switcher", outside: "volume" },
  { pref: "pageRange", key: "hqptuner.pageRange", pick: "240", other: "180", outside: "90" },
];

const K_HIDDEN = "hqptuner.hiddenStages";
const K_PINNED = "hqptuner.allowPinnedRates";

// A stored list naming one hideable stage and one stage the rail cannot hide.
const STORED_HIDDEN = ["speakers", "volume"];

const storage = useStorage();
for (const c of CHOICES) storage.setItem(c.key, c.pick);
storage.setItem(K_HIDDEN, JSON.stringify(STORED_HIDDEN));
storage.setItem(K_PINNED, "1");

// Written literally, so the import graph reaches the module from this suite.
const faceplate = await import("../../../hqptuner/static/store/ui/faceplate.js");

// Each row's signal, setter and offered set, by the row's `pref`.
/** @type {Record<string, { sig: { value: string }, set: (value: string) => void, offered: string[] }>} */
const SURFACE = {
  dacType: { sig: faceplate.dacType, set: faceplate.setDacType, offered: faceplate.DAC_TYPES },
  dacChip: { sig: faceplate.dacChip, set: faceplate.setDacChip, offered: faceplate.DAC_CHIPS },
  topOfPage: { sig: faceplate.topOfPage, set: faceplate.setTopOfPage, offered: faceplate.TOP_OF_PAGE },
  bottomBar: { sig: faceplate.bottomBar, set: faceplate.setBottomBar, offered: faceplate.BOTTOM_BARS },
  pageRange: { sig: faceplate.pageRange, set: faceplate.setPageRange, offered: faceplate.PAGE_RANGES },
};

// Captured before any case can write: what the module came up with, having read
// the seeded storage.
/** @type {Record<string, string>} */
const AT_LOAD = Object.fromEntries(CHOICES.map((c) => [c.pref, SURFACE[c.pref].sig.value]));
const HIDDEN_AT_LOAD = [...faceplate.hiddenStages.value];
const PINNED_AT_LOAD = faceplate.allowPinnedRates.value;

// A second instance, loaded against a storage holding every out-of-set value.
for (const c of CHOICES) storage.setItem(c.key, c.outside);
const outsider = await import(`${MODULE.replace(/\.js$/, ".fresh-outside.js")}`);

// A third instance, loaded against a storage holding no page Range at all.
storage.removeItem("hqptuner.pageRange");
const unset = await import(`${MODULE.replace(/\.js$/, ".fresh-unset.js")}`);

// --- what the browser had stored is what the page comes up with -----------------

for (const c of CHOICES) {
  test(`test_a_stored_${c.pref}_is_the_${c.pref}_the_page_loads_with`, () => {
    assert.equal(AT_LOAD[c.pref], c.pick);
  });

  test(`test_a_stored_${c.pref}_outside_the_set_loads_a_${c.pref}_inside_it`, () => {
    assert.ok(SURFACE[c.pref].offered.includes(outsider[c.pref].value));
  });
}

test("test_a_stored_hidden_stage_list_loads_without_the_stage_the_rail_cannot_hide", () => {
  assert.deepEqual(HIDDEN_AT_LOAD, ["speakers"]);
});

test("test_a_browser_with_no_stored_page_range_loads_the_range_a_stored_one_outside_the_set_falls_back_to", () => {
  assert.equal(unset.pageRange.value, outsider.pageRange.value);
});

test("test_a_stored_pinned_rates_opt_in_loads_on", () => {
  assert.equal(PINNED_AT_LOAD, true);
});

// --- a setter moves the signal and stores the value -------------------------------

for (const c of CHOICES) {
  test(`test_a_${c.pref}_outside_the_set_leaves_the_chosen_${c.pref}_standing`, () => {
    SURFACE[c.pref].set(c.other);
    SURFACE[c.pref].set(c.outside);
    assert.equal(SURFACE[c.pref].sig.value, c.other);
  });

  test(`test_choosing_a_${c.pref}_stores_it`, () => {
    SURFACE[c.pref].set(c.other);
    SURFACE[c.pref].set(c.pick);
    assert.equal(storage.getItem(c.key), c.pick);
  });
}

// Every stage shown again, so a case starts from an empty hidden set whatever
// the load or an earlier case left behind.
function showEveryStage() {
  for (const stage of faceplate.HIDEABLE_STAGES) {
    faceplate.setStageHidden(stage, false);
  }
}

test("test_hiding_a_stage_puts_it_in_the_hidden_set", () => {
  showEveryStage();
  faceplate.setStageHidden("crossfeed", true);
  assert.deepEqual(faceplate.hiddenStages.value, ["crossfeed"]);
});

test("test_hiding_a_hidden_stage_again_holds_it_once", () => {
  showEveryStage();
  faceplate.setStageHidden("dsd", true);
  faceplate.setStageHidden("dsd", true);
  assert.deepEqual(faceplate.hiddenStages.value, ["dsd"]);
});

test("test_showing_a_stage_takes_it_out_of_the_hidden_set", () => {
  showEveryStage();
  faceplate.setStageHidden("dsd", true);
  faceplate.setStageHidden("loudness", true);
  faceplate.setStageHidden("loudness", false);
  assert.deepEqual(faceplate.hiddenStages.value, ["dsd"]);
});

test("test_hiding_a_stage_the_rail_cannot_hide_leaves_the_hidden_set_standing", () => {
  showEveryStage();
  faceplate.setStageHidden("speakers", true);
  faceplate.setStageHidden("volume", true);
  assert.deepEqual(faceplate.hiddenStages.value, ["speakers"]);
});

test("test_hiding_a_stage_stores_the_hidden_set", () => {
  showEveryStage();
  faceplate.setStageHidden("correction", true);
  assert.deepEqual(JSON.parse(storage.getItem(K_HIDDEN) ?? "null"), ["correction"]);
});

test("test_turning_pinned_rates_on_moves_the_signal", () => {
  faceplate.setAllowPinnedRates(false);
  faceplate.setAllowPinnedRates(true);
  assert.equal(faceplate.allowPinnedRates.value, true);
});

test("test_turning_pinned_rates_on_stores_it_on", () => {
  storage.removeItem(K_PINNED);
  faceplate.setAllowPinnedRates(true);
  assert.equal(storage.getItem(K_PINNED), "1");
});
