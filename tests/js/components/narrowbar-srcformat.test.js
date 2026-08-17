// Behavioral suite for the narrow bar's SOURCE FORMAT control as it renders
// (components/narrowbar/Bar.js): the switch group titled "Source format", its two
// segments, and the preview count chip it does NOT carry — the facet changes no
// dropdown, so there is no count for a chip to preview.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. The bar is reset, rendered and read through
// tests/js/support/narrowbarview.js, which scans by tag balance rather than by
// selector: a group is "the smallest element that reads that title and encloses
// a segmented switch". That names what a reader sees rather than the classes the
// component happens to use, but it still couples these cases to the bar being
// built from `Segment` strips — a restructure will fail them for a reason that
// is not a regression; check the shape before reading the failure as one.
//
// The chip case names the element the counting groups render, and carries a
// sibling case asserting the "1x sources" group does render one — so the absence
// this file pins cannot quietly become "no group renders a chip any more".
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-srcformat.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { elements, classes } from "../support/markup.js";
import { resetBar, renderBar, seen, group, segmentLabels } from "../support/narrowbarview.js";

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

const TITLE = "Source format";

// The group the bar's OTHER stage control sits in, which does preview a count.
const SIBLING = "1x sources";

// The preview chip the counting groups render beside their switch.
const CHIP = "narrow-count";

const FILTERS = [
  { index: "0", name: "gauss-short", value: "0", arg: 0, description: "4/5 transients ⥮ Int", apodizing: false },
  { index: "1", name: "gauss-plain", value: "1", arg: 1, description: "5/5 timbre, space ⥮ Any", apodizing: true },
];

/** @param {{ notes?: boolean }} [prefs] */
const reset = (prefs) => resetBar(FILTERS, prefs);

/**
 * The elements of the bar reading exactly one wording — how a case asks what the
 * bar calls something without naming the element that carries it.
 *
 * @param {string} out
 * @param {string} wording
 * @returns {MarkupElement[]}
 */
const reading = (out, wording) => elements(out).filter((el) => seen(el) === wording);

/**
 * The preview chips inside one group.
 *
 * @param {MarkupElement} region
 * @returns {MarkupElement[]}
 */
const chips = (region) => elements(region.html).filter((el) => classes(el).includes(CHIP));

// --- the title and the two segments ---------------------------------------------

test("test_the_bar_titles_a_group_source_format", async () => {
  await reset();
  assert.equal(reading(renderBar(), TITLE).length, 1);
});

test("test_the_source_format_group_offers_pcm_only_and_dsd_in_that_order", async () => {
  await reset();
  assert.deepEqual(segmentLabels(group(renderBar(), TITLE)), ["PCM only", "+DSD"]);
});

// --- no preview count -------------------------------------------------------------
// The facet changes no dropdown, so there is no count for a chip to preview. The
// sibling case is the anchor: it is what stops the absence below going vacuous
// if the counting groups ever render their chip as something else.

test("test_the_1x_sources_group_previews_a_count", async () => {
  await reset();
  assert.equal(chips(group(renderBar(), SIBLING)).length, 1);
});

for (const notes of [true, false]) {
  test(`test_the_source_format_group_previews_no_count_with_descriptions_${notes ? "shown" : "hidden"}`, async () => {
    await reset({ notes });
    assert.deepEqual(chips(group(renderBar(), TITLE)), []);
  });
}
