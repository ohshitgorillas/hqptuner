// Behavioral suite for the HI-RES BADGE an Easy Mode preset tile carries in its
// cost row: the mark standing beside the apodizing mark and the pips saying
// that this preset is one of the flagships.
//
// The companion files are tests/js/components/easypips.test.js (the pip group
// in the same row), tests/js/components/easytiles-mark.test.js (the apodizing
// mark) and tests/js/components/easytiles.test.js (the tiles themselves). All
// share tests/js/support/easytiles.js, imported dynamically after
// `useStorage()` so that `store/easyview.js` meets the fake localStorage at its
// load-time read.
//
// HOOKS THIS SUITE REQUIRES the implementation to provide:
//   * `data-testid="easy-hires"` on the badge, inside the cost row of the tile
//     it belongs to. The badge is found by that testid and by nothing else.
//   * an accessible name on it — an `aria-label` with something in it, or an
//     `aria-labelledby` pointing at an element of the same tile that says
//     something.
//   * a `data-tip` attribute on it, spelt the same as that accessible name.
//
// NOTHING HERE READS COPY (docs/testing.md rule 9). The badge's label and its
// tip are owner-owned wording, reworded at will, and no case states either. The
// name is read for BEING THERE and never for what it says; the tip is read only
// against the name on the same element, both off the rendered DOM, so the owner
// may rewrite the sentence and every case below still holds. What IS asserted
// outright are wire identifiers: preset ids, knob ids, knob positions, output
// modes, the `data-testid` and the class names of the cost row's parts.
//
// WHICH TILES. `perfect-ten` and `lifelike` are the two flagships and carry the
// badge; the other four presets carry none. The flagship cases are read on
// `perfect-ten`, whose `material` knob has both positions the badge must
// survive.
//
// THE APODIZING MARK IS SEEDED where the row's ORDER is read, and only there. A
// tile whose filter the facet overlay does not annotate renders no
// `.easy-apod` at all (the "no marks" case in the mark suite), so there would
// be nothing for the badge to follow; `seedFacets(uniformFacets(...))` states a
// class for every filter the table can write, which is what puts a mark on the
// row. The presence cases seed nothing, so a badge drawn only when a mark
// happens to be beside it fails them.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-hires.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { elements, attr, classes, text } from "../support/markup.js";
import { useStorage } from "../support/storage.js";

useStorage();

const { resetTab, tabs, tileHtml } = await import("../support/easytiles.js");
const { seedFacets, uniformFacets } = await import("../support/easymark.js");
const { rememberKnobs } = await import("../../../hqptuner/static/store/easyview.js");

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

const BADGE = "easy-hires";

// The two flagship tiles, and the four that are not. Preset ids are wire
// identifiers.
const FLAGSHIPS = ["perfect-ten", "lifelike"];
const PLAIN = ["old-school", "damage-control", "purist", "concert-hall"];

// The flagship the knob and order cases are read on, and the knob whose two
// positions the badge must survive. Knob id and positions are wire identifiers,
// carried in `data-v`.
const TILE = "perfect-ten";
const MATERIAL = "material";
const MATERIALS = ["lossless", "lossy"];
const MODES = ["pcm", "sdm"];

/**
 * One tile's cost row: the element carrying the `easy-cost` class. Anything but
 * exactly one throws, so a tile that lost its row, or grew a second, fails by
 * name rather than by a badge that is quietly nowhere.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {MarkupElement}
 */
function costRow(out, presetId) {
  const hits = elements(tileHtml(out, presetId)).filter((el) => classes(el).includes("easy-cost"));
  if (hits.length !== 1) throw new Error(`expected one cost row on the "${presetId}" tile, found ${hits.length}`);
  return hits[0];
}

/**
 * How many hi-res badges stand in one tile's COST ROW. Scoped to the row, so a
 * badge rendered somewhere else on the tile counts as none here.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {number}
 */
const badgesInCostRow = (out, presetId) =>
  elements(costRow(out, presetId).html).filter((el) => attr(el, "data-testid") === BADGE).length;

/**
 * How many hi-res badges one tile renders ANYWHERE, cost row or not. What the
 * tiles that must carry none are read with: a badge moved out of the row is
 * still a badge on a tile that should have none.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {number}
 */
const badgesOnTile = (out, presetId) =>
  elements(tileHtml(out, presetId)).filter((el) => attr(el, "data-testid") === BADGE).length;

/**
 * One tile's badge, thrown for rather than answered as undefined: "there is no
 * badge" and "the badge is wrong" are different failures and must not read the
 * same.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {MarkupElement}
 */
function badge(out, presetId) {
  const hits = elements(tileHtml(out, presetId)).filter((el) => attr(el, "data-testid") === BADGE);
  if (hits.length !== 1) throw new Error(`expected one hi-res badge on the "${presetId}" tile, found ${hits.length}`);
  return hits[0];
}

/**
 * The cost row's parts in the order they are rendered in, named by the marking
 * each carries rather than by anything it says: the apodizing mark, the badge,
 * the divider. Parts the row does not render are simply absent from the list,
 * so a missing badge reads as a shorter sequence rather than as a reordering.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {string[]}
 */
const costRowOrder = (out, presetId) =>
  elements(costRow(out, presetId).html)
    .filter((el) => partOf(el) !== undefined)
    .sort((a, b) => a.start - b.start)
    .map((el) => String(partOf(el)));

/**
 * Which of the three parts an element is, or undefined when it is none of them.
 *
 * @param {MarkupElement} el
 * @returns {string | undefined}
 */
function partOf(el) {
  if (attr(el, "data-testid") === BADGE) return BADGE;
  if (classes(el).includes("easy-apod")) return "easy-apod";
  if (classes(el).includes("easy-cost-rule")) return "easy-cost-rule";
  return undefined;
}

/**
 * SSR escapes markup entities in both attributes and text, and escapes them
 * differently: a quote survives text untouched and becomes `&quot;` in an
 * attribute. Both sides of the tip-matches-name reading are therefore decoded
 * before they are compared, so that one string rendered into two places
 * compares equal however it is spelt.
 *
 * @param {string} s
 * @returns {string}
 */
const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/**
 * A tile's badge's ACCESSIBLE NAME: its `aria-label`, or the text of the
 * element its `aria-labelledby` points at. Either wiring names the badge and
 * which one a writer reaches for is not a behavior, so the two are one answer
 * here. A badge wired with neither throws rather than answering "": an unnamed
 * badge and an emptily named one are different failures.
 *
 * The name is returned so that it can be compared with the tip on the same
 * element. No case reads what it says.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {string}
 */
function badgeName(out, presetId) {
  const fragment = tileHtml(out, presetId);
  const el = badge(out, presetId);
  const label = attr(el, "aria-label");
  if (label !== undefined) return decode(label).trim();
  const by = attr(el, "aria-labelledby");
  const target = by === undefined ? [] : elements(fragment).filter((e) => attr(e, "id") === by);
  if (target.length !== 1) throw new Error(`the "${presetId}" tile's hi-res badge carries no accessible name`);
  return decode(text(target[0])).trim();
}

/**
 * A tile's badge's `data-tip`, thrown for when the badge carries none: a badge
 * with no tip at all must not read the same as a badge whose tip disagrees with
 * its name.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {string}
 */
function badgeTip(out, presetId) {
  const tip = attr(badge(out, presetId), "data-tip");
  if (tip === undefined) throw new Error(`the "${presetId}" tile's hi-res badge carries no data-tip`);
  return decode(tip).trim();
}

// ============================================================================
// which tiles carry the badge
// ============================================================================
//
// One case per flagship, so a card that badged one of the two fails by naming
// the tile it left bare.

for (const presetId of FLAGSHIPS) {
  test(`test_the_${presetId}_tile_renders_a_hires_badge_in_its_cost_row`, async () => {
    await resetTab({ mode: "pcm" });
    assert.equal(badgesInCostRow(tabs(), presetId), 1);
  });
}

// And one case per preset that is not a flagship. Read over the WHOLE tile
// rather than over its cost row: a badge drawn on one of these anywhere is
// wrong, and a reading scoped to the row would call a misplaced one absent.

for (const presetId of PLAIN) {
  test(`test_the_${presetId}_tile_renders_no_hires_badge`, async () => {
    await resetTab({ mode: "pcm" });
    assert.equal(badgesOnTile(tabs(), presetId), 0);
  });
}

// ============================================================================
// the badge does not move with the knobs or the output mode
// ============================================================================
//
// A flagship is a flagship whichever material its `material` knob is recorded
// on and whichever chain the card is showing, so the badge stands in all four
// combinations. The position is put on record through `rememberKnobs`, the
// public way a knob's position is stated, AFTER the reset, which clears it.
//
// One case per combination, so a badge that survived only the resting knob, or
// only one chain, fails by naming the case it did not.

for (const material of MATERIALS) {
  for (const mode of MODES) {
    test(`test_a_flagship_tile_renders_its_hires_badge_on_${material}_material_in_the_${mode}_output_mode`, async () => {
      await resetTab({ mode });
      rememberKnobs(TILE, { [MATERIAL]: material });
      assert.equal(badgesInCostRow(tabs(), TILE), 1);
    });
  }
}

// ============================================================================
// where the badge stands in the row
// ============================================================================
//
// Between the apodizing mark and the divider: after the mark, before the rule
// that separates the marks from the pips. Read as the whole sequence of the
// three parts rather than as two comparisons, so it is one assertion and so a
// badge that is missing reads as a short sequence rather than as an order that
// happens to hold.

test("test_the_hires_badge_follows_the_apodizing_mark_and_precedes_the_divider", async () => {
  await resetTab({ mode: "pcm" });
  seedFacets(uniformFacets("full"));
  assert.deepEqual(costRowOrder(tabs(), TILE), ["easy-apod", BADGE, "easy-cost-rule"]);
});

// ============================================================================
// how a reader meets the badge
// ============================================================================
//
// A badge announced as nothing is a mark a reader is told nothing about. WHAT
// it says is the owner's and is asserted nowhere; that it says something is the
// behavior.

test("test_the_hires_badge_carries_an_accessible_name", async () => {
  await resetTab({ mode: "pcm" });
  assert.notEqual(badgeName(tabs(), TILE), "");
});

// The pointer and the screen reader are told the same thing: the tip a hover
// raises is the name the badge is announced by. Both sides are read off the
// rendered element, so this holds through any rewording of either.

test("test_the_hires_badges_tip_and_accessible_name_are_the_same_string", async () => {
  await resetTab({ mode: "pcm" });
  assert.equal(badgeTip(tabs(), TILE), badgeName(tabs(), TILE));
});
