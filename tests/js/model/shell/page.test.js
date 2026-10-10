// Behavioral suite for hqptuner/static/model/shell/page.js: the page's sections, engaged stages only and in signal order.
// Source shows wherever the spectrum does, the Matrix section stands at full size, folds to its header line or leaves as
// the Top of page preference and the matrix engine decide, Resampling and Shaping leave on the Direct SDM path, Output
// never shows whether pinned rates are allowed or not, and exactly one section takes the fill.
//
// Section ids are the rail's stage ids, wire identifiers of the page; the paths are store/faceplate/path.js's.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/shell/page.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { pageSections } from "../../../../hqptuner/static/model/shell/page.js";

/** @typedef {{ path?: string, matrixOn?: boolean, topOfPage?: string, pinsOn?: boolean }} Now */

//: A PCM source to a PCM rate, the matrix engine engaged, Top of page on Auto, pinned rates off.
const PLAIN = { path: "pcm-pcm", matrixOn: true, topOfPage: "auto", pinsOn: false };

/**
 * The page's sections for one state, PLAIN where the case leaves a field out.
 *
 * @param {Now} now
 */
const sections = (now) => pageSections({ ...PLAIN, ...now });

/**
 * The section ids, in page order.
 *
 * @param {Now} now
 * @returns {string[]}
 */
const ids = (now) => sections(now).map((s) => s.id);

/**
 * The id of the section that takes the fill, or undefined when none does.
 *
 * @param {Now} now
 * @returns {string | undefined}
 */
const fillOf = (now) => sections(now).find((s) => s.fill)?.id;

/**
 * The Matrix section's fold, or undefined when the page has no Matrix section.
 *
 * @param {Now} now
 * @returns {boolean | undefined}
 */
const matrixFold = (now) => sections(now).find((s) => s.id === "matrix")?.fold;

test("test_allowing_pinned_rates_leaves_output_off_the_page", () => {
  assert.deepEqual(ids({ pinsOn: true }), ["source", "matrix", "resampling", "shaping"]);
});

test("test_pinned_rates_off_leave_output_off_the_page", () => {
  assert.deepEqual(ids({ pinsOn: false }), ["source", "matrix", "resampling", "shaping"]);
});

test("test_the_matrix_profile_top_takes_the_spectrum_off_the_page", () => {
  assert.deepEqual(ids({ topOfPage: "profile" }), ["matrix", "resampling", "shaping"]);
});

test("test_the_spectrum_top_takes_the_matrix_section_off_the_page", () => {
  assert.deepEqual(ids({ topOfPage: "spectrum" }), ["source", "resampling", "shaping"]);
});

for (const top of ["auto", "profile", "spectrum"]) {
  test(`test_a_bypassed_matrix_engine_leaves_only_the_spectrum_on_top_under_${top}`, () => {
    assert.deepEqual(ids({ matrixOn: false, topOfPage: top }), ["source", "resampling", "shaping"]);
  });
}

test("test_the_direct_sdm_path_takes_resampling_and_shaping_off_the_page", () => {
  assert.deepEqual(ids({ path: "direct" }), ["source", "matrix"]);
});

for (const path of ["idle", "pcm-sdm", "dsd-pcm", "sdm-sdm"]) {
  test(`test_the_${path}_path_keeps_resampling_and_shaping`, () => {
    assert.deepEqual(ids({ path }), ["source", "matrix", "resampling", "shaping"]);
  });
}

/** @type {[string, Now][]} */
const STATES = [
  ["auto_engaged", {}],
  ["profile_engaged", { topOfPage: "profile" }],
  ["spectrum_engaged", { topOfPage: "spectrum" }],
  ["profile_bypassed", { topOfPage: "profile", matrixOn: false }],
  ["profile_engaged_direct_with_pins", { topOfPage: "profile", path: "direct", pinsOn: true }],
  ["auto_bypassed_direct", { matrixOn: false, path: "direct" }],
];

for (const [name, now] of STATES) {
  test(`test_exactly_one_section_takes_the_fill_${name}`, () => {
    assert.equal(sections(now).filter((s) => s.fill).length, 1);
  });
}

test("test_the_spectrum_takes_the_fill_over_a_folded_matrix_section", () => {
  assert.equal(fillOf({ topOfPage: "auto" }), "source");
});

test("test_the_matrix_section_takes_the_fill_at_the_top_of_the_page", () => {
  assert.equal(fillOf({ topOfPage: "profile" }), "matrix");
});

test("test_the_spectrum_takes_the_fill_while_the_matrix_engine_is_bypassed", () => {
  assert.equal(fillOf({ topOfPage: "profile", matrixOn: false }), "source");
});

test("test_auto_folds_the_matrix_section_to_its_header_line", () => {
  assert.equal(matrixFold({ topOfPage: "auto" }), true);
});

test("test_the_matrix_profile_top_shows_the_matrix_section_unfolded", () => {
  assert.equal(matrixFold({ topOfPage: "profile" }), false);
});

test("test_only_the_matrix_section_folds", () => {
  assert.deepEqual(
    sections({ topOfPage: "auto", pinsOn: true })
      .filter((s) => s.fold)
      .map((s) => s.id),
    ["matrix"],
  );
});
