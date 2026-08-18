// Behavioral suite for the width-class hook of the "Simplified names" option
// style: while the pref is ON (Simplified), a schema entry that carries a
// `plainNames` property picks up the `plain` token in the class string
// `widthClasses(entry)` returns; with Standard active the token is absent, and
// an entry without a `plainNames` property never gets it in either mode. The
// token is ADDITIVE — whatever width tokens an entry earns otherwise are the
// same in both modes.
//
// The pref is driven through its exported setter (setPlainNames), same seam
// the dropdown suite uses (combobox-plainnames.test.js); each case sets the
// mode it needs so order cannot leak.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/field-plain-width.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { widthClasses } from "../../../hqptuner/static/components/Field.js";
import { setPlainNames } from "../../../hqptuner/static/store/prefs.js";

/** @typedef {import("../../../hqptuner/static/components/Field.js").FieldEntry} FieldEntry */

// Minimal schema entries: one that participates in the simplified style, one
// that does not, and one that both participates AND earns width tokens of its
// own (the wide/span shape tests/js/components/field.test.js pins on log_file),
// so additivity is checked against a non-empty token list.
const PLAIN_ENTRY = /** @type {FieldEntry} */ ({ widget: "select", plainNames: "filters" });
const OTHER_ENTRY = /** @type {FieldEntry} */ ({ widget: "select" });
const WIDE_PLAIN_ENTRY = /** @type {FieldEntry} */ ({
  widget: "select",
  wide: true,
  span: true,
  plainNames: "filters",
});

/**
 * The class string as the tokens a class attribute means.
 *
 * @param {FieldEntry} entry
 * @returns {string[]}
 */
const tokens = (entry) => (widthClasses(entry) || "").split(/\s+/).filter(Boolean);

test("test_simplified_mode_adds_the_plain_class_to_a_plain_names_entry", () => {
  setPlainNames(true);
  assert.equal(tokens(PLAIN_ENTRY).includes("plain"), true);
});

test("test_standard_mode_leaves_the_plain_class_off_a_plain_names_entry", () => {
  setPlainNames(false);
  assert.equal(tokens(PLAIN_ENTRY).includes("plain"), false);
});

test("test_an_entry_without_plain_names_never_gets_the_class_in_simplified_mode", () => {
  setPlainNames(true);
  assert.equal(tokens(OTHER_ENTRY).includes("plain"), false);
});

test("test_an_entry_without_plain_names_never_gets_the_class_in_standard_mode", () => {
  setPlainNames(false);
  assert.equal(tokens(OTHER_ENTRY).includes("plain"), false);
});

// The companion pin below proves this fixture EARNS tokens in standard mode, so
// this case cannot pass by comparing empty to empty; token order is a class
// string's non-fact, so both sides are sorted.
test("test_the_plain_class_is_additive_other_width_tokens_survive_the_toggle", () => {
  setPlainNames(false);
  const standard = tokens(WIDE_PLAIN_ENTRY).sort();
  setPlainNames(true);
  assert.deepEqual(
    tokens(WIDE_PLAIN_ENTRY)
      .filter((t) => t !== "plain")
      .sort(),
    standard,
  );
});

test("test_the_additivity_fixture_earns_wide_and_span_in_standard_mode", () => {
  setPlainNames(false);
  assert.deepEqual(tokens(WIDE_PLAIN_ENTRY).sort(), ["span", "wide"]);
});
