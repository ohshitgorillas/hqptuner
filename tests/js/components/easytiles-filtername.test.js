// Behavioral suite for the block an Easy Mode tile carries naming the HQPlayer
// filter that tile writes: the raw engine name, plus the descriptor lines the
// plain-names overlay supplies for it.
//
// The companion files are tests/js/components/easytiles.test.js (the tiles, the
// active marking and where a press routes what the table names) and
// tests/js/components/easytiles-knobs.test.js (what a dark tile's knobs show).
// All three share tests/js/support/easytiles.js, imported dynamically after
// `useStorage()` so that `store/easyview.js` meets the fake localStorage at its
// load-time read. WHICH name a preset and a set of knob positions comes out as
// is tests/js/store/easy-filtername.test.js's, and where the 1x/Nx boundary
// falls is tests/js/store/live-source-nx.test.js's; this file is about what the
// tile puts on screen.
//
// HOOKS THIS SUITE REQUIRES the implementation to provide:
//   * `data-testid="easy-filter"` on the block, inside the tile it belongs to.
//   * `data-part="raw"` on the element carrying the engine filter name, and
//     `data-part="family"`, `data-part="class"` and `data-part="shape"` on the
//     three descriptor lines.
//
// NAMES, NOT WORDS (rule 9). The engine filter name is a wire identifier, since
// static data joins the running engine by name (docs/architecture.md §2), so it
// is contract and is asserted outright. No filter name is TYPED here, though:
// every one is asked of `writeSet` for the preset and knob positions in hand,
// so the table stays the one copy of what a tile writes.
//
// The three descriptor lines are read too, and what they are read against is
// this file's OWN INJECTED STRINGS. The shipped plain-names wording is
// owner-owned and reworded at will, and no case here goes near it; the overlay
// these cases render is seeded below out of four obviously synthetic values
// that exist nowhere but this file, so the owner cannot reword them and rule 9
// has nothing to protect. Reading them is what pins the MAPPING, which overlay
// field feeds which line, and presence alone cannot: an implementation feeding
// one field into all three lines, or swapping two of them, renders three lines
// either way.
//
// Nothing is selected on a sentence: every element is found by its
// `data-testid` or its `data-part`, and the tile it sits in by its
// `data-preset`.
//
// THE OVERLAY IS THIS FILE'S OWN. The plain-names data rides /api/metadata
// (`plain_names`, keyed filters/dithers/modulators, raw name ->
// {family, variant, leaf, short}, the shape
// tests/js/components/combobox-plainnames.test.js drives), and each render
// below annotates AT MOST ONE filter, named by the case in hand. The shipped
// overlay never reaches these cases.
//
// WHICH TILES EACH SECTION SWEEPS, and why. No preset is named to stand for a
// property; each is selected BY the property, off the shipped table, and every
// knob combination the preset declares is swept (`combos`):
//   * A tile whose two PCM ends carry ONE filter (`writeSet` names the same
//     filter at the 1x and the Nx end) is a tile whose block does not depend on
//     which side of the chain is being shown. Those are the tiles for the
//     raw-name and descriptor cases: they are about the block, not about the
//     side, and there they cannot be disturbed by a source rate.
//   * A tile whose two PCM ends DIFFER is the tile for the source-rate cases:
//     the two answers are distinct names, so a tile fixed on one side fails one
//     of the two rather than coinciding with both.
// A table in which no preset has one of the two shapes generates no cases of
// that shape, by construction and without a guard.
//
// THE SOURCE RATE. The source-rate cases drive the engine's own /api/status
// shape on the exported `engineStatus` signal: `metadata.samplerate` is the
// SOURCE rate, a string attribute (docs/protocol.md §Status), and the manual
// puts the boundary at 50 kHz: "Filter/oversampling selection for '1x' rates
// covers source sampling rates below 50 kHz, so called base rates. Filter
// selection for 'Nx' rates covers everything else above the 1x rates" (HQPlayer
// 6 Desktop manual §4.6). Each of the two carries a `status.active_rate` on the
// OPPOSITE side of that boundary from its own source rate, so a tile reading
// the OUTPUT rate answers backwards on both rather than coinciding on one.
// Every other case here plays nothing at all: `engineStatus` is put back to
// null, the same reset the live suites make.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-filtername.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { elements, attr, text } from "../support/markup.js";
import { useStorage } from "../support/storage.js";

useStorage();

const { resetTab, tabs, tileHtml, running } = await import("../support/easytiles.js");
const { combos } = await import("../support/easytable.js");
const { recordPositions } = await import("../support/easyrecord.js");
const { presetsFor } = await import("../../../hqptuner/static/store/easy.js");
const signals = await import("../../../hqptuner/static/store/signals.js");

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {{ id: string, default: string, options: string[] }} Knob */
/** @typedef {{ id: string, knobs: Knob[] }} Preset */
/**
 * One preset on one combination of its knob positions, with the two PCM filter
 * names that combination writes.
 * @typedef {{ preset: Preset, knobs: Record<string, string>, oneX: string, nX: string }} Hit
 */

/** A combination as `knob=option` pairs joined with `_`, for a test name. */
function positionsOf(/** @type {Record<string, string>} */ knobs) {
  const pairs = Object.entries(knobs).map(([knobId, option]) => `${knobId}=${option}`);
  return pairs.length > 0 ? pairs.join("_") : "no_knobs";
}

// Every preset on every combination of its knob positions, each with the two
// PCM filter names it writes, asked of the table. Split by the one property
// this file cares about: whether the two ends carry one filter or two.
/** @type {Hit[]} */
const HITS = /** @type {Preset[]} */ (presetsFor()).flatMap((preset) =>
  combos(preset.knobs).map((knobs) => ({ preset, knobs, ...running(preset.id, knobs) })),
);
const ONE_FILTER_HITS = HITS.filter((hit) => hit.oneX === hit.nX);
const SPLIT_HITS = HITS.filter((hit) => hit.oneX !== hit.nX);

// Two source rates either side of the engine's 50 kHz boundary, each paired
// with an output rate on the other side of it.
const SOURCE_1X = { samplerate: "44100", activeRate: "705600" };
const SOURCE_NX = { samplerate: "96000", activeRate: "44100" };

// The overlay row for the one annotated filter, and the four values it carries.
// Every one is invented test data that occurs nowhere else in this repository,
// no shipped overlay, no schema, no label reads anything like them, so a line
// reading one of them can only have got it from this fixture. They are
// deliberately distinct from each other and share no substring, so a rendering
// that fed one field into two lines, or swapped two fields, fails by naming the
// value it put where.
//
// `short` is seeded and never expected on any line: it is the field the three
// lines must not come from, and a line carrying it fails the case for that
// line.
//
// WHY THE VALUES ARE MATCHED WITHIN A LINE RATHER THAN AGAINST THE WHOLE OF IT.
// A descriptor line carries a word of the component's own beside the value it
// was built from, and that word is owner copy; rule 9 keeps it out of every
// assertion here. So a line is read the way
// tests/js/components/combobox-plainnames.test.js reads a family header: the
// injected values are unique tokens that occur nowhere else in a render, so
// WHICH of them a line carries is observable without matching any word the
// component supplies. `injectedIn` below answers exactly that, and each case
// asserts the whole of its answer, so a line carrying two of the values, or
// the wrong one, or none, fails by naming what it carried.
const FAMILY_VALUE = "Zzfamily Alpha";
const VARIANT_VALUE = "Yyvariant Bravo";
const LEAF_VALUE = "Xxleaf Charlie";
const SHORT_VALUE = "Wwshort Delta";

const OVERLAY_ROW = {
  family: FAMILY_VALUE,
  variant: VARIANT_VALUE,
  leaf: LEAF_VALUE,
  short: SHORT_VALUE,
  apod: false,
};

const EMPTY_SECTION = { entries: {}, families: {}, variants: {} };

/**
 * The tabs lane, rendered with this file's overlay riding /api/metadata.
 *
 * `annotate` is the one filter name the overlay states a row for, or nothing,
 * in which case the overlay knows no filter at all. `source` is what the engine
 * reports playing, or nothing at all when a case does not name one. `record` is
 * the knob positions a tile is put on, put on record after the reset that
 * clears them and before the render that reads them: a tile knob's through
 * `rememberKnobs`, the card knob's through `setEasyMaterial`
 * (tests/js/support/easyrecord.js).
 *
 * @param {{
 *   annotate?: string,
 *   source?: { samplerate: string, activeRate: string },
 *   record?: { preset: string, positions: Record<string, string> },
 * }} [seams]
 * @returns {Promise<string>}
 */
async function card({ annotate, source, record } = {}) {
  await resetTab({ mode: "pcm" });
  signals.engineStatus.value =
    source === undefined
      ? null
      : {
          status: { active_rate: source.activeRate },
          metadata: { samplerate: source.samplerate, bits: "24" },
        };
  signals.metadata.value = {
    ...signals.metadata.value,
    plain_names: {
      filters: {
        entries: annotate === undefined ? {} : { [annotate]: OVERLAY_ROW },
        families: {},
        variants: {},
      },
      dithers: { ...EMPTY_SECTION },
      modulators: { ...EMPTY_SECTION },
    },
  };
  if (record !== undefined) recordPositions(record.preset, record.positions);
  return tabs();
}

/**
 * A one-filter hit's card: its tile on the hit's knob positions, the one filter
 * those positions write annotated by the overlay, and nothing playing.
 *
 * @param {Hit} hit
 * @returns {Promise<string>}
 */
const annotatedCard = (hit) => card({ annotate: hit.oneX, record: { preset: hit.preset.id, positions: hit.knobs } });

/**
 * A split hit's card: its tile on the hit's knob positions with one source rate
 * playing, or with nothing playing when handed no source. The overlay knows no
 * filter at all here; these cases read the raw name and nothing else.
 *
 * @param {Hit} hit
 * @param {{ samplerate: string, activeRate: string }} [source]
 * @returns {Promise<string>}
 */
const splitCard = (hit, source) => card({ source, record: { preset: hit.preset.id, positions: hit.knobs } });

// --- readers -------------------------------------------------------------------
//
// Scoped to one tile, and within it to the filter block: a tile carries other
// markings of its own, and what this file reads is the block's parts.

/**
 * One tile's filter block, or undefined when it renders none. The outermost
 * match, so a nested duplicate does not narrow the reading.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {MarkupElement | undefined}
 */
function block(out, presetId) {
  const hits = elements(tileHtml(out, presetId)).filter((el) => attr(el, "data-testid") === "easy-filter");
  return hits.length === 0 ? undefined : hits.reduce((a, b) => (a.start <= b.start ? a : b));
}

/**
 * The `data-part` markings one tile's filter block carries, in the order it
 * laid them out. Empty when the tile renders no block at all.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {string[]}
 */
function parts(out, presetId) {
  const box = block(out, presetId);
  if (box === undefined) return [];
  return elements(box.html)
    .filter((el) => attr(el, "data-part") !== undefined)
    .sort((a, b) => a.start - b.start)
    .map((el) => String(attr(el, "data-part")));
}

/**
 * WHICH of this file's injected overlay values one part of a tile's filter
 * block carries, in the fixture's own order. Empty when the part carries none
 * of them, and empty when the tile renders no such part at all.
 *
 * The values are unique tokens sharing no substring, so this is unambiguous,
 * and it reads no word the component supplies alongside them.
 *
 * @param {string} out
 * @param {string} presetId
 * @param {string} part
 * @returns {string[]}
 */
const injectedIn = (out, presetId, part) =>
  [FAMILY_VALUE, VARIANT_VALUE, LEAF_VALUE, SHORT_VALUE].filter((value) =>
    (partText(out, presetId, part) || "").includes(value),
  );

/**
 * What one part of a tile's filter block reads, or undefined when the tile
 * renders no such part.
 *
 * @param {string} out
 * @param {string} presetId
 * @param {string} part
 * @returns {string | undefined}
 */
function partText(out, presetId, part) {
  const box = block(out, presetId);
  if (box === undefined) return undefined;
  const hits = elements(box.html).filter((el) => attr(el, "data-part") === part);
  return hits.length === 0 ? undefined : text(hits.reduce((a, b) => (a.start <= b.start ? a : b)));
}

// ============================================================================
// the raw engine name
// ============================================================================
//
// The name the tile's knob positions write, spelt exactly as the engine
// enumerates it. One case per one-filter hit, so a tile that named the wrong
// filter fails by naming the preset and the positions it was on.

for (const hit of ONE_FILTER_HITS) {
  test(`test_the_${hit.preset.id}_tile_at_${positionsOf(hit.knobs)}_shows_the_engine_filter_name_those_positions_write`, async () => {
    assert.equal(partText(await annotatedCard(hit), hit.preset.id, "raw"), hit.oneX);
  });
}

// ============================================================================
// the descriptor lines
// ============================================================================
//
// A filter the overlay annotates gets its descriptor lines, each carrying the
// field of the overlay row it is built from: the row's `family` on the family
// line, its `variant` on the class line, its `leaf` on the shape line. A filter
// the overlay does not know gets the raw name and nothing derived.
//
// Read against this file's own injected values, never against shipped wording
// (see the header). Three cases per hit rather than one, one line apiece, so a
// rendering that got two of the three right fails by naming the one it did not.

for (const hit of ONE_FILTER_HITS) {
  test(`test_the_${hit.preset.id}_tile_at_${positionsOf(hit.knobs)}_shows_the_overlay_rows_family_on_the_family_line`, async () => {
    assert.deepEqual(injectedIn(await annotatedCard(hit), hit.preset.id, "family"), [FAMILY_VALUE]);
  });
}

for (const hit of ONE_FILTER_HITS) {
  test(`test_the_${hit.preset.id}_tile_at_${positionsOf(hit.knobs)}_shows_the_overlay_rows_variant_on_the_class_line`, async () => {
    assert.deepEqual(injectedIn(await annotatedCard(hit), hit.preset.id, "class"), [VARIANT_VALUE]);
  });
}

for (const hit of ONE_FILTER_HITS) {
  test(`test_the_${hit.preset.id}_tile_at_${positionsOf(hit.knobs)}_shows_the_overlay_rows_leaf_on_the_shape_line`, async () => {
    assert.deepEqual(injectedIn(await annotatedCard(hit), hit.preset.id, "shape"), [LEAF_VALUE]);
  });
}

// The unknown-filter reading is taken on the split tiles, with nothing playing,
// where the tile rests on the 1x end (pinned at the foot of this file). The
// overlay is handed a row for the filter at the OTHER end of that same tile, so
// a block that looked its row up by the wrong end's name, rather than by the
// name it is showing, renders a family line here and fails.

for (const hit of SPLIT_HITS) {
  test(`test_the_${hit.preset.id}_tile_at_${positionsOf(hit.knobs)}_whose_shown_filter_the_overlay_does_not_know_shows_the_raw_name_and_no_family_line`, async () => {
    const out = await card({ annotate: hit.nX, record: { preset: hit.preset.id, positions: hit.knobs } });
    const laid = parts(out, hit.preset.id).filter((part) => part === "raw" || part === "family");
    assert.deepEqual(laid, ["raw"]);
  });
}

// ============================================================================
// the name follows the playing source rate
// ============================================================================
//
// One tile, one set of knob positions, two source rates: a base-rate source
// names the filter at the 1x end of the chain and a multiple-rate source names
// the one at the Nx end. The two names differ on every split hit, so neither
// case can be satisfied by a tile that always shows the other side.

for (const hit of SPLIT_HITS) {
  test(`test_the_${hit.preset.id}_tile_at_${positionsOf(hit.knobs)}_playing_a_base_rate_source_names_the_filter_at_the_1x_end`, async () => {
    assert.equal(partText(await splitCard(hit, SOURCE_1X), hit.preset.id, "raw"), hit.oneX);
  });
}

for (const hit of SPLIT_HITS) {
  test(`test_the_${hit.preset.id}_tile_at_${positionsOf(hit.knobs)}_playing_a_multiple_rate_source_names_the_filter_at_the_nx_end`, async () => {
    assert.equal(partText(await splitCard(hit, SOURCE_NX), hit.preset.id, "raw"), hit.nX);
  });
}

// And with nothing playing at all there is no source rate to follow, so the
// tile rests on the 1x end, the same side a base-rate source puts it on. Read
// on the split tiles, where the two sides carry different names: a tile that
// defaulted to the Nx end while idle names the other filter here, and is
// invisible on a tile whose two ends agree.

for (const hit of SPLIT_HITS) {
  test(`test_the_${hit.preset.id}_tile_at_${positionsOf(hit.knobs)}_with_nothing_playing_names_the_filter_at_the_1x_end`, async () => {
    assert.equal(partText(await splitCard(hit), hit.preset.id, "raw"), hit.oneX);
  });
}
