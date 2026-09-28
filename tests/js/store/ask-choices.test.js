// toggleChoice flips an offered option by value and leaves a disabled one as
// offered; answer() resolves the checked values in option order.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/ask-choices.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { askChoices, toggleChoice, answer } from "../../../hqptuner/static/store/ask.js";

/** @type {ChoiceOption[]} */
const OPTIONS = [
  { value: "a", label: "A", checked: true, disabled: false },
  { value: "b", label: "B", checked: false, disabled: false },
  { value: "c", label: "C", checked: false, disabled: true },
];

// Each toggle kills a different wrong implementation: a no-op toggle resolves
// ["a"], one that sets instead of flipping resolves ["a", "b"], and one that
// ignores `disabled` resolves ["b", "c"].
test("test_toggling_flips_enabled_choices_and_leaves_a_disabled_one_as_offered", async () => {
  const asked = askChoices("ask-choices-store-test", "Pick", OPTIONS);
  toggleChoice("a");
  toggleChoice("b");
  toggleChoice("c");
  answer();
  assert.deepEqual(await asked, ["b"]);
});
