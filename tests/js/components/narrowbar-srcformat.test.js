// Behavioral suite for the narrow bar's SOURCE FORMAT control as it renders
// (components/narrowbar/Bar.js): the switch group marked `source-format`, the two
// values its segments offer, and the preview count chip it does NOT carry — the
// facet changes no dropdown, so there is no count for a chip to preview.
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

import { attr, elements, classes } from "../support/markup.js";
import { resetBar, renderBar, group } from "../support/narrowbarview.js";

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

// The groups' own machine identities, the `data-group` each element carries
// (docs/testing.md rule 9).
const TITLE = "source-format";

// The group the bar's OTHER stage control sits in, which does preview a count.
const SIBLING = "1x-sources";

// The preview chip the counting groups render beside their switch.
const CHIP = "narrow-count";

const FILTERS = [
  { index: "0", name: "gauss-short", value: "0", arg: 0, description: "4/5 transients ⥮ Int", apodizing: false },
  { index: "1", name: "gauss-plain", value: "1", arg: 1, description: "5/5 timbre, space ⥮ Any", apodizing: true },
];

/** @param {{ notes?: boolean }} [prefs] */
const reset = (prefs) => resetBar(FILTERS, prefs);

/**
 * The wire value each segment of a group's switch offers, in order.
 *
 * @param {MarkupElement} region
 * @returns {(string | undefined)[]}
 */
const segmentValues = (region) =>
  elements(region.html)
    .filter((el) => el.name === "button" && classes(el).includes("seg"))
    .sort((a, b) => a.start - b.start)
    .map((el) => attr(el, "data-v"));

/**
 * The preview chips inside one group.
 *
 * @param {MarkupElement} region
 * @returns {MarkupElement[]}
 */
const chips = (region) => elements(region.html).filter((el) => classes(el).includes(CHIP));

// --- the two segments -------------------------------------------------------------
// DELETED alongside them: "the bar titles a group Source format", which counted
// the elements reading that exact wording. The wording is copy (docs/testing.md
// rule 9) and the group's presence is pinned by its id in
// narrowbar-srcformat-prop.test.js.

test("test_the_source_format_group_offers_pcm_only_and_dsd_in_that_order", async () => {
  await reset();
  assert.deepEqual(segmentValues(group(renderBar(), TITLE)), ["pcm", "both"]);
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
