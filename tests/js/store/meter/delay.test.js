// Behavioral suite for store/meter/delay.js: the spectrum delay as the user types it, clamped to 0 to 5 s, text that
// is no number ignored, and the value persisted in localStorage. A fake localStorage is installed where a case needs
// working storage and removed after every case.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/delay.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { setSpectrumDelay, spectrumDelay } from "../../../../hqptuner/static/store/meter/delay.js";
import { useStorage, dropStorage } from "../../support/storage.js";

afterEach(dropStorage);

// --- the spectrum delay setter ------------------------------------------------------------

test("test_a_spectrum_delay_above_the_range_clamps_to_its_top", () => {
  setSpectrumDelay("7");
  assert.equal(spectrumDelay.value, 5);
});

test("test_a_spectrum_delay_below_the_range_clamps_to_zero", () => {
  spectrumDelay.value = 1.5;
  setSpectrumDelay("-1");
  assert.equal(spectrumDelay.value, 0);
});

test("test_a_spectrum_delay_that_is_not_a_number_leaves_the_delay_standing", () => {
  setSpectrumDelay("0.5");
  setSpectrumDelay("abc");
  assert.equal(spectrumDelay.value, 0.5);
});

test("test_a_spectrum_delay_persists_as_its_number_when_storage_works", () => {
  useStorage();
  setSpectrumDelay("0.5");
  assert.equal(globalThis.localStorage.getItem("hqptuner.spectrumDelay"), "0.5");
});
