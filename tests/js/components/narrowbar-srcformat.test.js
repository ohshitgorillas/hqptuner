// Behavioral suite for the narrow bar's SOURCE FORMAT control as it renders
// (components/NarrowBar.js): the switch group titled "Source format", its two
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
// The chip case is read off DIGITS: a preview count chip renders a number, and
// nothing in this group's approved copy — its title, its two segment labels, its
// explainer — carries one. A group that grew a count fails; a group that never
// had one passes in either descriptions state.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-srcformat.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { resetBar, renderBar, seen, group, segmentLabels } from "../support/narrowbarview.js";

const TITLE = "Source format";

const FILTERS = [
  { index: "0", name: "gauss-short", value: "0", arg: 0, description: "4/5 transients ⥮ Int", apodizing: false },
  { index: "1", name: "gauss-plain", value: "1", arg: 1, description: "5/5 timbre, space ⥮ Any", apodizing: true },
];

/** @param {{ notes?: boolean }} [prefs] */
const reset = (prefs) => resetBar(FILTERS, prefs);

// --- the group and its two segments ---------------------------------------------
// The lookup itself pins the title: a bar with no group reading "Source format"
// beside a segmented switch throws rather than reporting a wrong label list.

test("test_the_source_format_group_offers_pcm_only_and_dsd_in_that_order", async () => {
  await reset();
  assert.deepEqual(segmentLabels(group(renderBar(), TITLE)), ["PCM only", "+DSD"]);
});

// --- no preview count -------------------------------------------------------------

for (const notes of [true, false]) {
  test(`test_the_source_format_group_previews_no_count_with_descriptions_${notes ? "shown" : "hidden"}`, async () => {
    await reset({ notes });
    assert.equal(/\d/.test(seen(group(renderBar(), TITLE))), false);
  });
}
