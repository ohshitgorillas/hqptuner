// Behavioral suite for the Range buttons preference in store/ui/prefs.js: whether the page's spectrum draws its −/+
// Range buttons, a browser-held choice the Display popover sets. A stored choice is in force when the page loads; the
// setter moves the signal and stores the choice.
//
// The module reads its keys once, when it is first imported, so the fake storage is installed at file scope, SEEDED
// with the hidden choice, and only then is the module pulled in; the load-time value is captured the moment it
// arrives. The stored shown choice loads a second instance under a `.fresh-<tag>.js` specifier
// (tests/js/support/vendor-resolve.js). The storage key is named because it is the contract a persisted preference
// makes with the browser; the stored values are the "1" / "0" every boolean preference persists as (loadBool,
// tests/js/store/prefs-loadbool.test.js).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/prefs-rangebuttons.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const MODULE = "../../../hqptuner/static/store/ui/prefs.js";
const KEY = "hqptuner.rangeButtons";

// The boolean preferences' stored encodings.
const SHOWN = "1";
const HIDDEN = "0";

const storage = useStorage();
storage.setItem(KEY, HIDDEN);

const prefs = await import("../../../hqptuner/static/store/ui/prefs.js");
const STORED_HIDDEN_AT_LOAD = prefs.rangeButtons.value;

storage.setItem(KEY, SHOWN);
/** @type {{ rangeButtons: { value: boolean } }} */
const shown = await import(`${MODULE.replace(/\.js$/, ".fresh-rangebuttons-shown.js")}`);
const STORED_SHOWN_AT_LOAD = shown.rangeButtons.value;

test("test_a_stored_range_buttons_choice_is_in_force_at_load", () => {
  assert.deepEqual([STORED_HIDDEN_AT_LOAD, STORED_SHOWN_AT_LOAD], [false, true]);
});

test("test_setting_the_range_buttons_moves_the_signal_to_the_choice", () => {
  prefs.rangeButtons.value = true;
  prefs.setRangeButtons(false);
  const hidden = prefs.rangeButtons.value;
  prefs.setRangeButtons(true);
  assert.deepEqual([hidden, prefs.rangeButtons.value], [false, true]);
});

test("test_setting_the_range_buttons_stores_the_choice", () => {
  storage.removeItem(KEY);
  prefs.setRangeButtons(false);
  const hidden = storage.getItem(KEY);
  prefs.setRangeButtons(true);
  assert.deepEqual([hidden, storage.getItem(KEY)], [HIDDEN, SHOWN]);
});
