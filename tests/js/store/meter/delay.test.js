// Behavioral suite for store/meter/delay.js: the spectrum offset as the user types it, clamped to -5 to 5 s, text that
// is no number ignored, and the value persisted in localStorage; the engine's reported output delay, microseconds on
// the wire, read as seconds; and the effective delay the meters run behind, the two summed and floored at zero.
//
// The engine delay is driven by assigning engineStatus as a poll would. A fake localStorage is installed where a case
// needs working storage and removed after every case. What the offset comes up with is read from second instances of
// the module, loaded at the top of the file against a storage set up for them, under the `.fresh-<tag>.js` specifier
// tests/js/support/vendor-resolve.js resolves to the module's own source; the specifier is built rather than written
// literally because it names a file that is not on disk.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/delay.test.js

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  effectiveDelay,
  engineDelay,
  setSpectrumOffset,
  spectrumOffset,
} from "../../../../hqptuner/static/store/meter/delay.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { useStorage, dropStorage } from "../../support/storage.js";

const MODULE = "../../../../hqptuner/static/store/meter/delay.js";
const KEY = "hqptuner.spectrumOffset";

const unset = await (() => {
  useStorage();
  return import(`${MODULE.replace(/\.js$/, ".fresh-unset.js")}`);
})();
const stored = await (() => {
  useStorage().setItem(KEY, "-1.5");
  return import(`${MODULE.replace(/\.js$/, ".fresh-stored.js")}`);
})();
dropStorage();

/**
 * A polled status, playing, carrying `output_delay` as given, or no `output_delay` at all where it is undefined.
 *
 * @param {string} [outputDelay]
 */
function reporting(outputDelay) {
  return { status: outputDelay === undefined ? { state: "2" } : { state: "2", output_delay: outputDelay } };
}

beforeEach(() => {
  engineStatus.value = null;
  spectrumOffset.value = 0;
});

afterEach(dropStorage);

// --- the spectrum offset ----------------------------------------------------------------

test("test_with_no_offset_stored_the_effective_delay_is_the_engines_output_delay", () => {
  engineStatus.value = reporting("250000");
  assert.equal(unset.effectiveDelay.value, 0.25);
});

test("test_a_stored_offset_is_what_the_offset_comes_up_with", () => {
  assert.equal(stored.spectrumOffset.value, -1.5);
});

test("test_a_typed_offset_persists_as_its_number_under_its_key", () => {
  const storage = useStorage();
  setSpectrumOffset("-0.75");
  assert.equal(storage.map.get(KEY), "-0.75");
});

test("test_an_offset_above_the_range_clamps_to_its_top", () => {
  setSpectrumOffset("7");
  assert.equal(spectrumOffset.value, 5);
});

test("test_an_offset_below_the_range_clamps_to_its_bottom", () => {
  setSpectrumOffset("-7");
  assert.equal(spectrumOffset.value, -5);
});

test("test_an_offset_that_is_not_a_number_leaves_the_offset_standing", () => {
  setSpectrumOffset("0.5");
  setSpectrumOffset("abc");
  assert.equal(spectrumOffset.value, 0.5);
});

// --- the engine's output delay ----------------------------------------------------------

test("test_the_engines_output_delay_reads_in_seconds_from_its_microseconds", () => {
  engineStatus.value = reporting("250000");
  assert.equal(engineDelay.value, 0.25);
});

test("test_a_status_without_an_output_delay_reads_as_no_engine_delay", () => {
  engineStatus.value = reporting();
  assert.equal(engineDelay.value, null);
});

test("test_an_output_delay_that_is_not_a_number_reads_as_no_engine_delay", () => {
  engineStatus.value = reporting("abc");
  assert.equal(engineDelay.value, null);
});

test("test_an_output_delay_of_zero_reads_as_no_engine_delay", () => {
  engineStatus.value = reporting("0");
  assert.equal(engineDelay.value, null);
});

// --- the effective delay ----------------------------------------------------------------

test("test_the_effective_delay_is_the_engines_output_delay_plus_the_offset", () => {
  engineStatus.value = reporting("250000");
  spectrumOffset.value = 0.5;
  assert.equal(effectiveDelay.value, 0.75);
});

test("test_an_offset_further_back_than_the_engines_output_delay_floors_the_effective_delay_at_zero", () => {
  engineStatus.value = reporting("250000");
  spectrumOffset.value = -1;
  assert.equal(effectiveDelay.value, 0);
});

test("test_with_no_engine_delay_the_effective_delay_is_the_offset", () => {
  spectrumOffset.value = 0.5;
  assert.equal(effectiveDelay.value, 0.5);
});
