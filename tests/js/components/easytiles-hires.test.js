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
//   * the row's other parts findable as they already are: `data-testid`
//     "easy-pips" on the pip group, the `easy-apod` class on the apodizing mark
//     and the `easy-cost-rule` class on each divider.
//
// NOTHING HERE READS COPY (docs/testing.md rule 9). The badge's label and its
// tip are owner-owned wording, reworded at will, and no case states either. The
// name is read for BEING THERE and never for what it says; the tip is read only
// against the name on the same element, both off the rendered DOM, so the owner
// may rewrite the sentence and every case below still holds. What IS asserted
// outright are wire identifiers: preset ids, knob ids, knob positions, output
// modes, the `data-testid` and the class names of the cost row's parts.
//
// WHICH TILES. Which presets exist and which of them are flagships is owner
// data (docs/testing.md rule 9), so neither roster is typed here: both are
// swept from `presetsFor()`, the flagships being the presets that declare
// `hires`. Every flagship reading is taken on EVERY one of them, so a card that
// badged, named or tipped some but not all fails by naming the tile it left
// bare. The material and ORDER cases are read on every flagship that takes the
// `material` knob, at every position that knob declares; no preset is named to
// stand for the property. The knob is the CARD's, one control on the card body
// and a row on no tile, so its position is put on record through
// `setEasyMaterial`, the public way the card's position is stated, and there is
// no tile row to confirm it against.
//
// THE APODIZING MARK IS SEEDED IN ONE CASE: the marked row's order. A tile
// whose filter the facet overlay does not annotate renders no `.easy-apod` at
// all (the "no marks" case in the mark suite), so there would be nothing for
// the badge to follow; `seedFacets(uniformFacets(...))` states a class for
// every filter the table can write, which is what puts a mark on the row. Every
// other case seeds nothing and so reads a MARKLESS row — which is what the
// unmarked-order case wants outright, and which means a badge drawn only when a
// mark happens to be beside it fails the presence cases.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-hires.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { elements, attr, classes, text, hasAttr } from "../support/markup.js";
import { useStorage } from "../support/storage.js";

useStorage();

const { resetTab, tabs, tileHtml } = await import("../support/easytiles.js");
const { seedFacets, uniformFacets } = await import("../support/easymark.js");
const { setEasyMaterial } = await import("../../../hqptuner/static/store/easyview.js");
const { presetsFor } = await import("../../../hqptuner/static/store/easy.js");

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {{ id: string, options: string[] }} Knob */
/** @typedef {{ id: string, hires?: boolean, knobs: Knob[] }} Preset */

// The markings the cost row's parts are found by, every one of them a hook and
// not a word: two testids and two class names.
const BADGE = "easy-hires";
const PIPS = "easy-pips";
const APOD = "easy-apod";
const RULE = "easy-cost-rule";

// The flagship tiles and the tiles that are not, swept from the shipped table:
// a flagship is a preset declaring `hires`, and every other preset is plain.
// Which presets exist and which wear the badge is owner data and is typed
// nowhere in this file.
/** @type {Preset[]} */
const PRESETS = presetsFor();
const FLAGSHIPS = PRESETS.filter((preset) => Boolean(preset.hires)).map((preset) => String(preset.id));
const PLAIN = PRESETS.filter((preset) => !preset.hires).map((preset) => String(preset.id));

// The knob whose positions the badge must survive, and the two output modes.
// Knob id and positions are wire identifiers, carried in `data-v`.
const MATERIAL = "material";
const MODES = ["pcm", "sdm"];

// The flagships that take the `material` knob, each with the positions that
// knob declares, off the shipped table: the tiles the material cases and the
// order cases are read on. No preset is named to stand for the property, and a
// table in which no flagship takes the knob generates no such case.
/** @type {{ presetId: string, materials: string[] }[]} */
const MATERIAL_FLAGSHIPS = PRESETS.filter((preset) => Boolean(preset.hires)).flatMap((preset) =>
  preset.knobs
    .filter((knob) => String(knob.id) === MATERIAL)
    .map((knob) => ({ presetId: String(preset.id), materials: knob.options })),
);

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
 * Only the parts standing BESIDE one another are sequenced. A part rendered
 * INSIDE another opens later in the fragment and so would sort after it, which
 * would let a badge nested within the apodizing mark read as a badge following
 * it — a different arrangement entirely. An enclosed part is therefore dropped,
 * leaving a sequence that is short where nesting happened rather than one that
 * is spuriously in order.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {string[]}
 */
function costRowOrder(out, presetId) {
  const parts = elements(costRow(out, presetId).html).filter((el) => partOf(el) !== undefined);
  return parts
    .filter((el) => !parts.some((other) => encloses(other, el)))
    .sort((a, b) => a.start - b.start)
    .map((el) => String(partOf(el)));
}

/**
 * Whether one element of a fragment contains another, the element itself not
 * counting as containing itself.
 *
 * @param {MarkupElement} outer
 * @param {MarkupElement} inner
 * @returns {boolean}
 */
const encloses = (outer, inner) =>
  outer.start <= inner.start &&
  outer.start + outer.html.length >= inner.start + inner.html.length &&
  !(outer.start === inner.start && outer.html.length === inner.html.length);

/**
 * Which of the row's parts an element is, or undefined when it is none of them.
 * A DIVIDER answers the same name wherever it stands: the row draws the same
 * `.easy-cost-rule` on either side of the badge, so the two are told apart by
 * where they fall in the sequence and by nothing else.
 *
 * @param {MarkupElement} el
 * @returns {string | undefined}
 */
function partOf(el) {
  if (attr(el, "data-testid") === BADGE) return BADGE;
  if (attr(el, "data-testid") === PIPS) return PIPS;
  if (classes(el).includes(APOD)) return APOD;
  if (classes(el).includes(RULE)) return RULE;
  return undefined;
}

/**
 * The parts of one MARKLESS tile's cost row standing BEFORE its badge.
 *
 * Two premises are checked before the run is handed back, because an empty run
 * is what the case asserts and every way of not having one would otherwise read
 * as a pass: a row with no badge in it fails as a missing badge, and a row that
 * DOES carry an apodizing mark fails as a case set up wrong — the reading is
 * about the tile that has a badge and no mark, and a marked row is a different
 * arrangement, the one the case above reads.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {string[]}
 */
function partsBeforeUnmarkedBadge(out, presetId) {
  const order = costRowOrder(out, presetId);
  const at = order.indexOf(BADGE);
  if (at < 0) throw new Error(`the "${presetId}" tile's cost row carries no hi-res badge`);
  if (order.includes(APOD)) throw new Error(`the "${presetId}" tile's cost row carries an apodizing mark`);
  return order.slice(0, at);
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
 * here.
 *
 * A badge NAMED BY NOTHING answers "" rather than throwing, the convention the
 * sibling harness settled (`markLabel`, tests/js/support/easymark.js). SSR emits
 * an empty-string attribute bare (` aria-label`, never `aria-label=""`), so a
 * throw here would swallow the empty case whole and leave the case below
 * asserting only that a helper did not raise. A badge a reader is told nothing
 * about is an answer, and belongs in the assertion as a value: no wiring, empty
 * wiring and a labelledby pointing nowhere all read as "".
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
  if (hasAttr(el, "aria-label")) return decode(attr(el, "aria-label") ?? "").trim();
  const by = attr(el, "aria-labelledby");
  const target = by === undefined ? [] : elements(fragment).filter((e) => attr(e, "id") === by);
  if (target.length !== 1) return "";
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
// Every flagship sweep below is generated from `FLAGSHIPS`, so a table that
// declared `hires` on nothing would generate no cases and retire every badge
// rule with nothing red. This case is their smoke alarm: it fails by name where
// they would simply cease to exist.

test("test_the_shipped_table_declares_hires_on_at_least_one_preset", () => {
  assert.ok(
    FLAGSHIPS.length > 0,
    "presetsFor() declared hires on no preset, so every flagship sweep generated nothing",
  );
});

// One case per flagship, so a card that badged some but not all fails by naming
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

// Read in both output modes, as the flagship cases are: a card that badges
// every tile on one chain and only the flagships on the other is wrong on the
// chain nobody read.

for (const presetId of PLAIN) {
  for (const mode of MODES) {
    test(`test_the_${presetId}_tile_renders_no_hires_badge_in_the_${mode}_output_mode`, async () => {
      await resetTab({ mode });
      assert.equal(badgesOnTile(tabs(), presetId), 0);
    });
  }
}

// ============================================================================
// the badge does not move with the knobs or the output mode
// ============================================================================
//
// A flagship is a flagship whichever material the card's `material` knob is
// set to and whichever chain the card is showing, so the badge stands in every
// combination, on every flagship taking the knob. The positions are the knob's
// own declared options; the position is set through `setEasyMaterial`, the
// public way the card's position is stated, AFTER the reset, which puts the
// card back at its default.
//
// One case per combination, so a badge that survived only the resting knob, or
// only one chain, or only one flagship, fails by naming the case it did not.

for (const { presetId, materials } of MATERIAL_FLAGSHIPS) {
  for (const material of materials) {
    for (const mode of MODES) {
      test(`test_the_${presetId}_tile_renders_its_hires_badge_on_${material}_material_in_the_${mode}_output_mode`, async () => {
        await resetTab({ mode });
        setEasyMaterial(material);
        assert.equal(badgesInCostRow(tabs(), presetId), 1);
      });
    }
  }
}

// ============================================================================
// where the badge stands in the row
// ============================================================================
//
// A marked tile's row reads mark, divider, badge, divider, pips: the badge
// stands between two dividers, the same `.easy-cost-rule` drawn on either side
// of it. Read as the whole sequence rather than as a run of comparisons, so it
// is one assertion and so a badge that is missing reads as a short sequence
// rather than as an order that happens to hold.
//
// The mark is seeded here, and only here: a tile whose filter the facet overlay
// does not annotate renders no `.easy-apod` at all, and this is the arrangement
// where the row has both. The seeding states a class for every filter the
// table can write, so the mark is there whichever material is recorded.
//
// Read on every flagship taking the `material` knob, at every position the
// card's knob declares: an arrangement that held at rest and shuffled on a
// moved position fails by naming the position.

for (const { presetId, materials } of MATERIAL_FLAGSHIPS) {
  for (const material of materials) {
    test(`test_the_marked_${presetId}_tiles_cost_row_on_${material}_material_reads_mark_divider_badge_divider_pips`, async () => {
      await resetTab({ mode: "pcm" });
      seedFacets(uniformFacets("full"));
      setEasyMaterial(material);
      assert.deepEqual(costRowOrder(tabs(), presetId), [APOD, RULE, BADGE, RULE, PIPS]);
    });
  }
}

// The divider before the badge is the one separating it FROM THE MARK, so a
// tile with no mark has nothing for it to separate and draws none. Nothing is
// seeded, which is what leaves the row markless; what is read is the run of
// parts standing before the badge, and a divider anywhere in that run is the
// separator drawn where there was nothing to separate.

for (const { presetId, materials } of MATERIAL_FLAGSHIPS) {
  for (const material of materials) {
    test(`test_the_unmarked_${presetId}_tiles_hires_badge_on_${material}_material_is_preceded_by_no_divider`, async () => {
      await resetTab({ mode: "pcm" });
      setEasyMaterial(material);
      assert.equal(partsBeforeUnmarkedBadge(tabs(), presetId).includes(RULE), false);
    });
  }
}

// ============================================================================
// how a reader meets the badge
// ============================================================================
//
// A badge announced as nothing is a mark a reader is told nothing about. WHAT
// it says is the owner's and is asserted nowhere; that it says something is the
// behavior.

for (const presetId of FLAGSHIPS) {
  test(`test_the_${presetId}_tiles_hires_badge_carries_an_accessible_name`, async () => {
    await resetTab({ mode: "pcm" });
    assert.notEqual(badgeName(tabs(), presetId), "");
  });
}

// The pointer and the screen reader are told the same thing: the tip a hover
// raises is the name the badge is announced by. Both sides are read off the
// rendered element, so this holds through any rewording of either.

for (const presetId of FLAGSHIPS) {
  test(`test_the_${presetId}_tiles_hires_badge_tip_and_accessible_name_are_the_same_string`, async () => {
    await resetTab({ mode: "pcm" });
    assert.equal(badgeTip(tabs(), presetId), badgeName(tabs(), presetId));
  });
}
