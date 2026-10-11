// Behavioral suite for the display-format choice as store/ui/prefs.js holds it: Auto, Expanded, Normal or Compact,
// held by the browser. On the way in: the stored choice is the choice the page comes up with, and a stored value
// outside the set costs the user that one choice and never reaches the page. On the way out: the setter stores the
// new choice, and a value outside the set is turned away with the choice standing.
//
// The module reads its keys once, when it is first imported, so the fake storage is installed and seeded at file
// scope before the module is pulled in, and what it came up with is captured the moment it arrives. The out-of-set
// case loads a second instance under a `.fresh-<tag>.js` specifier (tests/js/support/vendor-resolve.js), built rather
// than written literally because it names a file that is not on disk. The signal and setter are read off the module
// namespace with optional access, so a module without them fails these cases on their assertions.
//
// The storage key is named here because it is the contract a persisted preference makes with the browser: a rename
// drops every user's saved choice. The values are the format ids.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/prefs-display-format.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const MODULE = "../../../hqptuner/static/store/ui/prefs.js";
const KEY = "hqptuner.displayFormat";

const FORMATS = ["auto", "expanded", "normal", "compact"];
// A chosen format that is not the one a fresh browser starts on, and a second one.
const PICK = "compact";
const OTHER = "normal";
// The former smallest size, which a browser may still hold.
const OUTSIDE = "10.2";

/** @typedef {{ [k: string]: unknown, displayFormat?: { value: string }, setDisplayFormat?(v: string): void }} DisplayFormatPrefs */

const storage = useStorage();
storage.setItem(KEY, PICK);

// Written literally, so the import graph reaches the module from this suite.
/** @type {DisplayFormatPrefs} */
const prefs = await import("../../../hqptuner/static/store/ui/prefs.js");
const AT_LOAD = prefs.displayFormat?.value;

storage.setItem(KEY, OUTSIDE);
/** @type {DisplayFormatPrefs} */
const outsider = await import(`${MODULE.replace(/\.js$/, ".fresh-outside.js")}`);

test("test_a_stored_display_format_is_the_display_format_the_page_loads_with", () => {
  assert.equal(AT_LOAD, PICK);
});

test("test_a_stored_display_format_outside_the_set_loads_a_display_format_inside_it", () => {
  assert.equal(FORMATS.includes(String(outsider.displayFormat?.value)), true);
});

test("test_choosing_a_display_format_stores_it", () => {
  prefs.setDisplayFormat?.(PICK);
  prefs.setDisplayFormat?.(OTHER);
  assert.equal(storage.getItem(KEY), OTHER);
});

test("test_a_display_format_outside_the_set_leaves_the_chosen_display_format_standing", () => {
  prefs.setDisplayFormat?.(OTHER);
  prefs.setDisplayFormat?.(OUTSIDE);
  assert.equal(prefs.displayFormat?.value, OTHER);
});
