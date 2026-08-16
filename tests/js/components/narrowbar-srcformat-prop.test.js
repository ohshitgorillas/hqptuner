// Behavioral suite for the narrow bar's `srcFormat` prop
// (components/NarrowBar.js): the switch that decides whether the bar offers a
// "Source format" group at all, and which of the two narrowing predicates its
// Reset button follows.
//
// The group discloses the chain cards' "DSD Sources" subsections. A caller whose
// cards have no such subsection mounts the bar with `srcFormat` off, and there
// the group is not merely hidden — the facet stops counting toward Reset, so a
// bar with nothing but source format moved offers no Reset for a user to press
// on a control that is not on screen.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. The bar is reset, mounted and read through
// tests/js/support/narrowbarview.js, which scans by tag balance rather than by
// selector: a group is "the smallest element that reads that title and encloses
// a segmented switch". Reset is read as "a button whose whole wording is Reset",
// so the class it carries is not pinned here.
//
// The absence cases carry their anchor in the same assertion: the stage group
// must still render, so a bar that rendered nothing at all cannot pass them.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-srcformat-prop.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { elements } from "../support/markup.js";
import { nSrcFormat, nPhase } from "../../../hqptuner/static/store/narrowing.js";
import { resetBar, renderBar, seen, hasGroup } from "../support/narrowbarview.js";

const TITLE = "Source format";

// The group the bar offers whatever `srcFormat` says — the anchor that keeps an
// absence case from passing on an empty render.
const SIBLING = "1x sources";

const CATALOG = [
  { index: "0", name: "sinc-M", value: "0", arg: 1, description: "5/5 timbre ⥮ Any", apodizing: true },
  { index: "1", name: "sinc-Mx", value: "1", arg: 1, description: "5/5 timbre ⥮ Any", apodizing: true },
];

/** @returns {Promise<void>} */
const reset = () => resetBar(CATALOG);

/**
 * The Reset buttons a rendered bar offers, named by the word a reader presses.
 *
 * @param {string} out
 * @returns {number}
 */
const resets = (out) => elements(out).filter((el) => el.name === "button" && seen(el) === "Reset").length;

// --- whether the group renders -----------------------------------------------------

test("test_a_bar_mounted_with_no_src_format_prop_offers_the_source_format_group", async () => {
  await reset();
  assert.equal(hasGroup(renderBar(), TITLE), true);
});

test("test_a_bar_mounted_with_src_format_off_offers_no_source_format_group", async () => {
  await reset();
  const out = renderBar({ srcFormat: false });
  assert.deepEqual({ source: hasGroup(out, TITLE), stages: hasGroup(out, SIBLING) }, { source: false, stages: true });
});

// --- which predicate Reset follows ---------------------------------------------------

test("test_a_bar_with_src_format_off_offers_no_reset_for_source_format_alone", async () => {
  await reset();
  nSrcFormat.value = "both";
  assert.equal(resets(renderBar({ srcFormat: false })), 0);
});

test("test_a_bar_with_src_format_off_offers_reset_once_a_dropdown_facet_moves", async () => {
  await reset();
  nPhase.value = "minimum";
  assert.equal(resets(renderBar({ srcFormat: false })), 1);
});

test("test_a_bar_with_src_format_on_offers_reset_for_source_format_alone", async () => {
  await reset();
  nSrcFormat.value = "both";
  assert.equal(resets(renderBar({ srcFormat: true })), 1);
});
