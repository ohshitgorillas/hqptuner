// Behavioral suite for the Range buttons preference in store/ui/prefs.js, at load: a choice already stored in the
// browser when the module is first imported is the choice in force. The shown choice is the one that tells a stored
// read from the default, which is hidden.
//
// The module reads its keys once, when it is first imported, so the stored choice is seeded at file scope and only then
// is the module pulled in. Setting the choice is tests/js/store/prefs/prefs-rangebuttons.test.js.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/prefs/prefs-rangebuttons-load.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../../support/storage.js";

// The boolean preferences' stored encoding of shown.
const SHOWN = "1";

useStorage().setItem("hqptuner.rangeButtons", SHOWN);

const { rangeButtons } = await import("../../../../hqptuner/static/store/ui/prefs.js");

test("test_a_range_buttons_choice_stored_shown_before_load_is_the_choice_in_force", () => {
  assert.equal(rangeButtons.value, true);
});
