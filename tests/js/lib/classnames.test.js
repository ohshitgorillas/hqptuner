// Behavioral suite for lib/dom.js classNames: a class list joined from the names that apply.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/classnames.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { classNames } from "../../../hqptuner/static/lib/dom.js";

//: State classes the test writes, and the attribute two of them make.
const CUR = "cur";
const FOLD = "fold";
const CUR_FOLD = "cur fold";

test("test_class_names_join_the_names_that_apply", () => {
  assert.equal(classNames(CUR, false, FOLD), CUR_FOLD);
});

test("test_class_names_skip_every_falsy_entry", () => {
  assert.equal(classNames(null, CUR, undefined, "", 0, FOLD), CUR_FOLD);
});

test("test_class_names_with_nothing_applying_is_empty", () => {
  assert.equal(classNames(false, null), "");
});
