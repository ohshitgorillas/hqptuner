// Behavioral suite for the Range buttons preference in store/ui/prefs.js: whether the page's spectrum draws its −/+
// Range buttons, a browser-held choice the Display popover sets. The setter stores the choice.
//
// The module reads its keys once, when it is first imported, so the fake storage is installed at file scope, and only
// then is the module pulled in. The storage key is named because it is the contract a persisted preference makes with
// the browser; the stored values are the "1" / "0" every boolean preference persists as (loadBool,
// tests/js/store/prefs-loadbool.test.js).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/prefs-rangebuttons.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const KEY = "hqptuner.rangeButtons";

// The boolean preferences' stored encodings.
const SHOWN = "1";
const HIDDEN = "0";

const storage = useStorage();

const prefs = await import("../../../hqptuner/static/store/ui/prefs.js");

test("test_setting_the_range_buttons_hidden_stores_the_hidden_choice", () => {
  storage.removeItem(KEY);
  prefs.setRangeButtons(false);
  assert.equal(storage.getItem(KEY), HIDDEN);
});

test("test_setting_the_range_buttons_shown_stores_the_shown_choice", () => {
  storage.removeItem(KEY);
  prefs.setRangeButtons(false);
  prefs.setRangeButtons(true);
  assert.equal(storage.getItem(KEY), SHOWN);
});
