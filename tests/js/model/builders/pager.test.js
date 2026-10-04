// Behavioral suite for mockup/scripts/model/pager.js: how many pages a list fills, which page is shown once the asked one
// is clamped into range, which items that page holds, whether ‹ and › are live, and where they go.
//
// The lists are ones the test writes: a count of items and a page size, nothing else.
//
// Run: node --test tests/js/mockup/pager.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { paging, stepPage } from "../../../../hqptuner/static/model/builders/pager.js";

/**
 * One list, the page asked for, and what one field of its paging owes.
 *
 * @typedef {object} Row
 * @property {string} name
 * @property {number} n
 * @property {number} per
 * @property {number} page
 * @property {number | boolean} want
 */

// ── Page count ───────────────────────────────────────────────────────────

/** @type {Row[]} */
const PAGES = [
  { name: "an_empty_list_still_fills_one_page", n: 0, per: 6, page: 0, want: 1 },
  { name: "a_list_one_page_long_fills_one_page", n: 6, per: 6, page: 0, want: 1 },
  { name: "one_item_past_a_page_starts_a_second", n: 7, per: 6, page: 0, want: 2 },
  { name: "a_short_last_page_still_counts", n: 25, per: 4, page: 0, want: 7 },
  { name: "a_list_of_whole_pages_fills_exactly_that_many", n: 48, per: 12, page: 0, want: 4 },
];

for (const row of PAGES) {
  test(`test_${row.name}`, () => {
    assert.equal(paging(row.n, row.per, row.page).pages, row.want);
  });
}

// ── Page shown ───────────────────────────────────────────────────────────

/** @type {Row[]} */
const SHOWN = [
  { name: "a_page_in_range_is_the_page_shown", n: 14, per: 6, page: 1, want: 1 },
  { name: "a_page_past_the_last_shows_the_last", n: 14, per: 6, page: 5, want: 2 },
  { name: "a_list_that_shrank_to_nothing_shows_the_first_page", n: 0, per: 6, page: 3, want: 0 },
  { name: "a_page_before_the_first_shows_the_first", n: 14, per: 6, page: -1, want: 0 },
];

for (const row of SHOWN) {
  test(`test_${row.name}`, () => {
    assert.equal(paging(row.n, row.per, row.page).page, row.want);
  });
}

// ── Items a page shows ───────────────────────────────────────────────────

/** @type {Row[]} */
const STARTS = [
  { name: "the_first_page_starts_at_the_first_item", n: 14, per: 6, page: 0, want: 0 },
  { name: "a_later_page_starts_a_whole_number_of_pages_in", n: 14, per: 6, page: 2, want: 12 },
  { name: "a_clamped_page_starts_where_the_last_page_does", n: 14, per: 6, page: 9, want: 12 },
  { name: "an_empty_list_starts_at_nothing", n: 0, per: 6, page: 0, want: 0 },
];

for (const row of STARTS) {
  test(`test_${row.name}`, () => {
    assert.equal(paging(row.n, row.per, row.page).start, row.want);
  });
}

/** @type {Row[]} */
const ENDS = [
  { name: "a_full_page_ends_a_page_size_after_its_start", n: 14, per: 6, page: 1, want: 12 },
  { name: "a_short_last_page_ends_at_the_last_item", n: 14, per: 6, page: 2, want: 14 },
  { name: "a_list_shorter_than_a_page_ends_at_its_last_item", n: 4, per: 6, page: 0, want: 4 },
  { name: "an_empty_list_ends_at_nothing", n: 0, per: 6, page: 0, want: 0 },
];

for (const row of ENDS) {
  test(`test_${row.name}`, () => {
    assert.equal(paging(row.n, row.per, row.page).end, row.want);
  });
}

// ── Previous and next ────────────────────────────────────────────────────

/** @type {Row[]} */
const PREVS = [
  { name: "previous_is_dead_on_a_single_page", n: 5, per: 6, page: 0, want: false },
  { name: "previous_is_live_on_the_first_of_several_pages", n: 14, per: 6, page: 0, want: true },
  { name: "previous_is_live_on_a_middle_page", n: 14, per: 6, page: 1, want: true },
];

for (const row of PREVS) {
  test(`test_${row.name}`, () => {
    assert.equal(paging(row.n, row.per, row.page).prev, row.want);
  });
}

/** @type {Row[]} */
const NEXTS = [
  { name: "next_is_dead_on_a_single_page", n: 5, per: 6, page: 0, want: false },
  { name: "next_is_live_on_the_last_of_several_pages", n: 14, per: 6, page: 2, want: true },
  { name: "next_is_live_on_a_middle_page", n: 14, per: 6, page: 1, want: true },
];

for (const row of NEXTS) {
  test(`test_${row.name}`, () => {
    assert.equal(paging(row.n, row.per, row.page).next, row.want);
  });
}

/**
 * One step from a page among so many, and the page it lands on.
 *
 * @typedef {object} Step
 * @property {string} name
 * @property {number} page
 * @property {number} by
 * @property {number} pages
 * @property {number} want
 */

/** @type {Step[]} */
const STEPS = [
  { name: "next_moves_one_page_on", page: 1, by: 1, pages: 3, want: 2 },
  { name: "previous_moves_one_page_back", page: 2, by: -1, pages: 3, want: 1 },
  { name: "previous_from_the_first_page_wraps_to_the_last", page: 0, by: -1, pages: 3, want: 2 },
  { name: "next_from_the_last_page_wraps_to_the_first", page: 2, by: 1, pages: 3, want: 0 },
];

for (const row of STEPS) {
  test(`test_${row.name}`, () => {
    assert.equal(stepPage(row.page, row.by, row.pages), row.want);
  });
}
