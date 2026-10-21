// Behavioral suite for hqptuner/static/model/store/draft.js: which keys of an engine form's draft differ from the form as
// read, among the keys asked about.
//
// The answer lists the keys asked about whose draft value differs, in the order they were asked, each once. Two values
// are the same edit when the form would post the same text for both: a number, text or flag by its text, an array member
// by member in order, a plain object member by member with a missing member read as null. Null, undefined and a key the
// form lacks are the same as each other and as nothing else. A key the draft lacks is no edit at all.
//
// Every row whose answer would be empty carries a second key that did change, so no row passes on an answer of nothing.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/store/draft.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { draftDiffers } from "../../../../hqptuner/static/model/store/draft.js";

/**
 * One form as read, its draft, the keys asked about, and the keys owed back in order.
 *
 * @typedef {object} Row
 * @property {string} name
 * @property {Record<string, unknown>} base
 * @property {Record<string, unknown>} values
 * @property {string[]} keys
 * @property {string[]} want
 */

/** @type {Row[]} */
const ROWS = [
  {
    name: "of_two_keys_asked_about_only_the_changed_one_is_returned",
    base: { gain: 2, delay: 7 },
    values: { gain: 2, delay: 9 },
    keys: ["gain", "delay"],
    want: ["delay"],
  },
  {
    name: "every_changed_key_asked_about_is_returned",
    base: { gain: 2, delay: 7, trim: 1 },
    values: { gain: 4, delay: 9, trim: 1 },
    keys: ["gain", "delay", "trim"],
    want: ["gain", "delay"],
  },
  {
    name: "a_changed_key_not_asked_about_is_left_out",
    base: { gain: 2, delay: 7, trim: 1 },
    values: { gain: 4, delay: 9, trim: 1 },
    keys: ["gain", "trim"],
    want: ["gain"],
  },
  {
    name: "a_number_changed_to_zero_differs",
    base: { gain: 2, delay: 7 },
    values: { gain: 0, delay: 7 },
    keys: ["gain", "delay"],
    want: ["gain"],
  },
  {
    name: "a_number_changed_from_zero_differs",
    base: { gain: 0, delay: 7 },
    values: { gain: 3, delay: 7 },
    keys: ["gain", "delay"],
    want: ["gain"],
  },
  {
    name: "a_flag_cleared_differs",
    base: { enabled: true, delay: 7 },
    values: { enabled: false, delay: 7 },
    keys: ["enabled", "delay"],
    want: ["enabled"],
  },
  {
    name: "a_text_emptied_differs",
    base: { label: "left", delay: 7 },
    values: { label: "", delay: 7 },
    keys: ["label", "delay"],
    want: ["label"],
  },
  {
    name: "a_text_changed_differs",
    base: { label: "left", delay: 7 },
    values: { label: "right", delay: 7 },
    keys: ["label", "delay"],
    want: ["label"],
  },
  {
    name: "a_key_asked_about_twice_is_returned_once",
    base: { gain: 2, delay: 7 },
    values: { gain: 4, delay: 7 },
    keys: ["gain", "delay", "gain"],
    want: ["gain"],
  },
  {
    name: "a_number_and_its_text_are_the_same_edit",
    base: { rate: 48000, delay: 7 },
    values: { rate: "48000", delay: 9 },
    keys: ["rate", "delay"],
    want: ["delay"],
  },
  {
    name: "a_flag_and_its_text_are_the_same_edit",
    base: { enabled: true, delay: 7 },
    values: { enabled: "true", delay: 9 },
    keys: ["enabled", "delay"],
    want: ["delay"],
  },
  {
    name: "a_text_of_the_same_number_written_differently_differs",
    base: { rate: 48000, delay: 7 },
    values: { rate: "48000.0", delay: 7 },
    keys: ["rate", "delay"],
    want: ["rate"],
  },
  {
    name: "a_text_that_is_true_only_as_a_truth_value_differs_from_a_set_flag",
    base: { enabled: true, delay: 7 },
    values: { enabled: "1", delay: 7 },
    keys: ["enabled", "delay"],
    want: ["enabled"],
  },
  {
    name: "an_array_whose_members_post_the_same_text_is_the_same_edit",
    base: { outputs: [0, 1], delay: 7 },
    values: { outputs: ["0", "1"], delay: 9 },
    keys: ["outputs", "delay"],
    want: ["delay"],
  },
  {
    name: "an_array_reordered_differs",
    base: { outputs: [0, 1], delay: 7 },
    values: { outputs: [1, 0], delay: 7 },
    keys: ["outputs", "delay"],
    want: ["outputs"],
  },
  {
    name: "an_array_grown_differs",
    base: { outputs: [0, 1], delay: 7 },
    values: { outputs: [0, 1, 2], delay: 7 },
    keys: ["outputs", "delay"],
    want: ["outputs"],
  },
  {
    name: "an_array_shortened_differs",
    base: { outputs: [0, 1, 2], delay: 7 },
    values: { outputs: [0, 1], delay: 7 },
    keys: ["outputs", "delay"],
    want: ["outputs"],
  },
  {
    name: "an_array_whose_members_join_to_the_same_text_but_split_differently_differs",
    base: { names: ["a,b"], delay: 7 },
    values: { names: ["a", "b"], delay: 7 },
    keys: ["names", "delay"],
    want: ["names"],
  },
  {
    name: "a_plain_object_whose_members_post_the_same_text_is_the_same_edit",
    base: { route: { left: 0, right: 1 }, delay: 7 },
    values: { route: { left: "0", right: "1" }, delay: 9 },
    keys: ["route", "delay"],
    want: ["delay"],
  },
  {
    name: "a_plain_object_with_its_members_written_in_another_order_is_the_same_edit",
    base: { route: { left: 0, right: 1 }, delay: 7 },
    values: { route: { right: 1, left: 0 }, delay: 9 },
    keys: ["route", "delay"],
    want: ["delay"],
  },
  {
    name: "a_plain_object_with_one_member_changed_differs",
    base: { route: { left: 0, right: 1 }, delay: 7 },
    values: { route: { left: 0, right: 2 }, delay: 7 },
    keys: ["route", "delay"],
    want: ["route"],
  },
  {
    name: "a_plain_object_missing_a_member_is_the_same_as_one_holding_it_as_null",
    base: { route: { left: 0, right: null }, delay: 7 },
    values: { route: { left: 0 }, delay: 9 },
    keys: ["route", "delay"],
    want: ["delay"],
  },
  {
    name: "a_plain_object_given_a_member_it_lacked_differs",
    base: { route: { left: 0 }, delay: 7 },
    values: { route: { left: 0, right: 1 }, delay: 7 },
    keys: ["route", "delay"],
    want: ["route"],
  },
  {
    name: "a_plain_object_losing_a_member_differs",
    base: { route: { left: 0, right: 1 }, delay: 7 },
    values: { route: { left: 0 }, delay: 7 },
    keys: ["route", "delay"],
    want: ["route"],
  },
  {
    name: "null_and_undefined_are_the_same_edit",
    base: { gain: null, delay: 7 },
    values: { gain: undefined, delay: 9 },
    keys: ["gain", "delay"],
    want: ["delay"],
  },
  {
    name: "a_key_the_form_lacks_is_the_same_as_null",
    base: { delay: 7 },
    values: { gain: null, delay: 9 },
    keys: ["gain", "delay"],
    want: ["delay"],
  },
  {
    name: "an_empty_text_differs_from_null",
    base: { label: null, delay: 7 },
    values: { label: "", delay: 7 },
    keys: ["label", "delay"],
    want: ["label"],
  },
  {
    name: "a_zero_differs_from_null",
    base: { gain: null, delay: 7 },
    values: { gain: 0, delay: 7 },
    keys: ["gain", "delay"],
    want: ["gain"],
  },
  {
    name: "the_text_null_differs_from_null",
    base: { label: null, delay: 7 },
    values: { label: "null", delay: 7 },
    keys: ["label", "delay"],
    want: ["label"],
  },
  {
    name: "a_value_cleared_to_null_in_the_draft_differs",
    base: { gain: 2, delay: 7 },
    values: { gain: null, delay: 7 },
    keys: ["gain", "delay"],
    want: ["gain"],
  },
  {
    name: "a_key_the_draft_lacks_never_differs",
    base: { gain: 2, delay: 7 },
    values: { delay: 9 },
    keys: ["gain", "delay"],
    want: ["delay"],
  },
  {
    name: "a_member_the_draft_only_inherits_is_no_edit",
    base: { gain: 2, delay: 7 },
    values: Object.assign(Object.create({ gain: 4 }), { delay: 9 }),
    keys: ["gain", "delay"],
    want: ["delay"],
  },
];

for (const row of ROWS) {
  test(`test_${row.name}`, () => {
    assert.deepEqual(draftDiffers(row.base, row.values, row.keys), row.want);
  });
}

const FORM = { gain: 2, delay: 7 };
const UNCHANGED = { gain: 2, delay: 7 };
const GAIN_CHANGED = { gain: 4, delay: 7 };
const BOTH_CHANGED = { gain: 4, delay: 9 };

test("test_a_draft_with_nothing_changed_returns_no_keys_where_a_changed_one_returns_its_key", () => {
  assert.deepEqual(
    [draftDiffers(FORM, UNCHANGED, ["gain", "delay"]), draftDiffers(FORM, GAIN_CHANGED, ["gain", "delay"])],
    [[], ["gain"]],
  );
});

test("test_asking_about_no_keys_returns_no_keys_even_where_a_key_changed", () => {
  assert.deepEqual([draftDiffers(FORM, GAIN_CHANGED, []), draftDiffers(FORM, GAIN_CHANGED, ["gain"])], [[], ["gain"]]);
});

test("test_changed_keys_come_back_in_the_order_they_were_asked_about", () => {
  assert.deepEqual(
    [draftDiffers(FORM, BOTH_CHANGED, ["delay", "gain"]), draftDiffers(FORM, BOTH_CHANGED, ["gain", "delay"])],
    [
      ["delay", "gain"],
      ["gain", "delay"],
    ],
  );
});
