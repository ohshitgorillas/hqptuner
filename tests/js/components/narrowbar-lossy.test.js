// Behavioral suite for the narrow bar's 1x SOURCES control as it renders
// (components/NarrowBar.js): the switch group titled "1x sources", its three
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
// by tag balance rather than by selector: a group is "the smallest element that
// encloses the title text and a segmented switch", a stage micro-label is "an
// element whose whole text reads 1x or Nx". That names what a reader sees
// rather than the classes the component happens to use, but it still couples
// these cases to the bar being built from `Segment` strips — a restructure will
// fail them for a reason that is not a regression; check the shape before
// reading the failure as one.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-lossy.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { NarrowBar } from "../../../hqptuner/static/components/NarrowBar.js";
import { config, matrixConfig, enums, metadata, engineState } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { resetNarrowing } from "../../../hqptuner/static/store/narrowing.js";
import { showDescriptions, keepOptionDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { staticWire } from "../support/wire.js";
import { elements, classes, text, enclosing } from "../support/markup.js";

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

// The owner-approved explainer, character for character: straight double quotes
// around the two name fragments, no em dash anywhere.
const EXPLAINER =
  'This feature determines whether to show or hide filters capable of reducing ultrasonic noise when it exists in the source ("hires" or "mp3/mqa" in the filter name). At 1x, that means lossy material like MP3 and MQA; lossless material contains no such noise, so these filters offer no benefit at 1x otherwise.';

const TITLE = "1x sources";

const FILTERS = [
  { index: "0", name: "gauss-short", value: "0", arg: 0, description: "4/5 transients ⥮ Int", apodizing: false },
  { index: "1", name: "gauss-plain", value: "1", arg: 1, description: "5/5 timbre, space ⥮ Any", apodizing: true },
  { index: "2", name: "gauss-hires", value: "2", arg: 1, description: "5/5 timbre ⥮ Any", apodizing: true },
];

/**
 * @param {{ notes?: boolean }} [prefs]
 * @returns {Promise<void>}
 */
async function reset({ notes = true } = {}) {
  staticWire();
  engineState.value = {};
  enums.value = { filters: FILTERS };
  metadata.value = {
    settings: {},
    filters: { filters: {}, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  config.value = { fields: [], file: {}, active: "", profiles: null };
  matrixConfig.value = { fields: [] };
  resetNarrowing();
  // Held ON in both states: the split under test follows the master pref, not
  // the option-descriptions one.
  keepOptionDescriptions.value = true;
  showDescriptions.value = notes;
  await discardAll();
}

/** @returns {string} */
const renderBar = () => render(html`<${NarrowBar} />`);

/**
 * The characters a reader sees, with the entities the renderer emits put back.
 *
 * @param {string} s
 * @returns {string}
 */
const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** @param {MarkupElement} el */
const seen = (el) => decode(text(el));

/** @param {MarkupElement} el */
const isSegment = (el) => classes(el).includes("segment");

/**
 * @param {MarkupElement} el
 * @param {string} name
 * @returns {string | undefined}
 */
const attr = (el, name) => {
  const m = new RegExp(`(^|\\s)${name}="([^"]*)"`).exec(el.attrs);
  return m ? decode(m[2]) : undefined;
};

/** @param {MarkupElement} el */
const encloses = (el, /** @type {MarkupElement} */ inner) =>
  inner.start >= el.start && inner.start + inner.html.length <= el.start + el.html.length;

/**
 * The switch group a title names: the smallest element of the bar that both
 * reads that title and encloses a segmented switch.
 *
 * @param {string} out
 * @param {string} title
 * @returns {MarkupElement}
 */
function group(out, title) {
  const all = elements(out);
  const segments = all.filter(isSegment);
  const hits = all.filter((el) => seen(el).includes(title) && segments.some((s) => encloses(el, s)));
  if (hits.length === 0) throw new Error(`no "${title}" switch group in the rendered bar`);
  return hits.reduce((a, b) => (a.html.length <= b.html.length ? a : b));
}

/**
 * The segmented switches inside one group, outermost first.
 *
 * @param {MarkupElement} region
 * @returns {MarkupElement[]}
 */
const switchesIn = (region) =>
  elements(region.html)
    .filter(isSegment)
    .sort((a, b) => a.start - b.start);

/**
 * The wording on each segment of a group's switch, in order.
 *
 * @param {MarkupElement} region
 * @returns {string[]}
 */
function segmentLabels(region) {
  const [strip] = switchesIn(region);
  if (!strip) throw new Error("no segmented switch in this group");
  return [...strip.html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => decode(m[1].trim()));
}

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
// The lookup itself pins the title: a bar with no group reading "1x sources"
// beside a segmented switch throws rather than reporting a wrong label list.

test("test_the_1x_sources_group_offers_both_lossless_and_lossy_in_that_order", async () => {
  await reset();
  assert.deepEqual(segmentLabels(group(renderBar(), TITLE)), ["Both", "Lossless", "Lossy"]);
});

// --- one row, no stage labelling, no Nx twin --------------------------------------
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

test("test_the_bar_offers_no_nx_sources_control", async () => {
  await reset();
  assert.equal(decode(renderBar()).includes("Nx sources"), false);
});

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
