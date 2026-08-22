// Behavioral suite for the narrow bar's 1x SOURCES control as it renders
// (components/narrowbar/Bar.js): the switch group titled "1x sources", its three
// segments, the stage micro-labels it does and does not carry, and the split
// between an explainer shown as a caption and the same explainer offered as a
// hover title.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. State is driven by assigning the exported source signals
// the real payloads carry — the engine's `<GetFilters/>` enumeration
// (protocol.md:226) and the static name-keyed overlay from /api/metadata — by
// resetNarrowing(), and by the descriptions preference's own signals.
// `notesVisible` is derived from the master "Setting descriptions" pref
// (tests/js/store/prefs.test.js pins it following the master alone), so the two
// states are entered by writing that master; the keep-option pref is held ON
// throughout, so a group gated on OPTION descriptions rather than on
// `notesVisible` fails here instead of passing.
//
// The bar is read as SSR markup through tests/js/support/markup.js, which scans
// by tag balance rather than by selector: a group is "the smallest element
// marked with that group id that encloses a segmented switch", a stage
// micro-label is "an element whose whole text reads 1x or Nx" — the engine's own
// stage names, not a caption. That names what a reader sees
// rather than the classes the component happens to use, but it still couples
// these cases to the bar being built from `Segment` strips — a restructure will
// fail them for a reason that is not a regression; check the shape before
// reading the failure as one.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-lossy.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { LOSSY_TIP } from "../../../hqptuner/static/components/narrowbar/Stages.js";
import { classes, elements, enclosing } from "../support/markup.js";
import { resetBar, renderBar, seen, isSegment, encloses, attr, group, switchesIn } from "../support/narrowbarview.js";

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

// The owner-approved explainer. Its wording is pinned character for character in
// exactly one place, tests/js/components/narrowbar-tips.test.js; these cases are
// about WHERE the bar puts it, so they take it as the bar's own export rather
// than repeating 400 characters a reword would have to be chased through twice.
const EXPLAINER = LOSSY_TIP;

// The group's own machine identity, the `data-group` its element carries, so a
// reworded heading changes nothing here (docs/testing.md rule 9).
const TITLE = "1x-sources";

/**
 * The wire value each segment of a group's switch offers, in order — read off
 * `data-v`, never off the words on the button.
 *
 * @param {MarkupElement} region
 * @returns {(string | undefined)[]}
 */
const segmentValues = (region) =>
  elements(region.html)
    .filter((el) => el.name === "button" && classes(el).includes("seg"))
    .sort((a, b) => a.start - b.start)
    .map((el) => attr(el, "data-v"));

const FILTERS = [
  { index: "0", name: "gauss-short", value: "0", arg: 0, description: "4/5 transients ⥮ Int", apodizing: false },
  { index: "1", name: "gauss-plain", value: "1", arg: 1, description: "5/5 timbre, space ⥮ Any", apodizing: true },
  { index: "2", name: "gauss-hires", value: "2", arg: 1, description: "5/5 timbre ⥮ Any", apodizing: true },
];

/**
 * @param {{ notes?: boolean }} [prefs]
 * @returns {Promise<void>}
 */
const reset = (prefs) => resetBar(FILTERS, prefs);

/**
 * The stage micro-labels of a region — elements reading exactly "1x" or "Nx" —
 * in document order, each counted once however deeply it is wrapped.
 *
 * @param {MarkupElement} region
 * @returns {string[]}
 */
function stageLabels(region) {
  const hits = elements(region.html)
    .filter((el) => ["1x", "Nx"].includes(seen(el)))
    .sort((a, b) => a.start - b.start);
  return [...new Set(hits.map(seen))];
}

/**
 * The multi-row group an element sits in: its nearest ancestor holding more
 * than one segmented switch. A single row is one label beside one switch, so
 * the two-stage group is the first ancestor that holds both rows' switches.
 *
 * @param {string} out
 * @param {MarkupElement} el
 * @returns {MarkupElement}
 */
function rowGroupOf(out, el) {
  let node = el;
  for (let hop = 0; hop < 12; hop += 1) {
    node = enclosing(out, node);
    if (elements(node.html).filter(isSegment).length > 1) return node;
  }
  throw new Error("no multi-row switch group encloses this label");
}

/**
 * The smallest element of the bar reading exactly "1x", outside the sources
 * group — the apodizing stage's own micro-label.
 *
 * @param {string} out
 * @returns {MarkupElement}
 */
function apodizingStageLabel(out) {
  const sources = group(out, TITLE);
  const hits = elements(out).filter((el) => seen(el) === "1x" && !encloses(sources, el));
  if (hits.length === 0) throw new Error("no 1x stage micro-label outside the sources group");
  return hits.reduce((a, b) => (a.html.length <= b.html.length ? a : b));
}

// --- the group and its three segments -------------------------------------------
// The lookup itself pins the group: a bar with no group marked `1x-sources`
// beside a segmented switch throws rather than reporting a wrong option list.

test("test_the_1x_sources_group_offers_both_lossless_and_lossy_in_that_order", async () => {
  await reset();
  assert.deepEqual(segmentValues(group(renderBar(), TITLE)), ["both", "lossless", "lossy"]);
});

// --- one row, no stage labeling, no Nx twin --------------------------------------
// The axis exists at 1x only, so the group has nothing to tell two stages apart
// and offers no second row to label.

test("test_the_1x_sources_group_carries_no_stage_micro_label", async () => {
  await reset();
  assert.deepEqual(stageLabels(group(renderBar(), TITLE)), []);
});

test("test_the_apodizing_group_still_labels_both_of_its_rows", async () => {
  await reset();
  const out = renderBar();
  assert.deepEqual(stageLabels(rowGroupOf(out, apodizingStageLabel(out))), ["1x", "Nx"]);
});

test("test_the_1x_sources_group_offers_a_single_row", async () => {
  await reset();
  assert.equal(switchesIn(group(renderBar(), TITLE)).length, 1);
});

// DELETED: "the bar offers no Nx sources control", which read the absence of the
// literal "Nx sources" out of the render. Nothing in shipped source carries that
// string, so the assertion constrained nothing whatever the bar did; the group
// being single-rowed is pinned by the two cases above.

// --- the explainer: a caption while notes show, a hover title while they do not ----

test("test_with_feature_descriptions_shown_the_group_captions_the_lossy_explainer", async () => {
  await reset({ notes: true });
  assert.equal(seen(group(renderBar(), TITLE)).includes(EXPLAINER), true);
});

test("test_with_feature_descriptions_shown_the_explainer_is_not_a_hover_title", async () => {
  await reset({ notes: true });
  const inside = elements(group(renderBar(), TITLE).html);
  assert.equal(
    inside.some((el) => attr(el, "title") === EXPLAINER),
    false,
  );
});

test("test_with_feature_descriptions_hidden_the_group_captions_nothing", async () => {
  await reset({ notes: false });
  assert.equal(seen(group(renderBar(), TITLE)).includes(EXPLAINER), false);
});

test("test_with_feature_descriptions_hidden_the_explainer_is_the_groups_hover_title", async () => {
  await reset({ notes: false });
  const inside = elements(group(renderBar(), TITLE).html);
  assert.equal(
    inside.some((el) => attr(el, "title") === EXPLAINER),
    true,
  );
});
