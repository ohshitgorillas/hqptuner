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
// NAMES, NOT WORDS (rule 9). The engine filter name is a wire identifier —
// static data joins the running engine by name (docs/architecture.md §2) — so
// it is contract and is asserted outright.
//
// The three descriptor lines are read too, and what they are read against is
// this file's OWN INJECTED STRINGS. The shipped plain-names wording is
// owner-owned and reworded at will, and no case here goes near it; the overlay
// these cases render is seeded below out of four obviously synthetic values
// that exist nowhere but this file, so the owner cannot reword them and rule 9
// has nothing to protect. Reading them is what pins the MAPPING — which overlay
// field feeds which line — and presence alone cannot: an implementation feeding
// one field into all three lines, or swapping two of them, renders three lines
// either way.
//
// Nothing is selected on a sentence: every element is found by its
// `data-testid` or its `data-part`, and the tile it sits in by its
// `data-preset`.
//
// THE OVERLAY IS THIS FILE'S OWN. The plain-names data rides /api/metadata
// (`plain_names`, keyed filters/dithers/modulators, raw name ->
// {family, variant, leaf, short} — the shape
// tests/js/components/combobox-plainnames.test.js drives), and the fixture
// below annotates ONE filter: the single name `purist` writes to both ends of
// its chain. Every other tile's filter is therefore a name the overlay does not
// know, which is the "no overlay row" case in the middle of the file. The
// shipped overlay never reaches these cases.
//
// WHICH TILE EACH SECTION USES, and why:
//   * `purist` writes ONE filter to both ends of the chain, so what its block
//     names does not depend on which side of the chain is being shown. That is
//     what makes it the tile for the raw-name and descriptor cases: they are
//     about the block, not about the side, and there they cannot be disturbed
//     by a source rate.
//   * `perfect-ten` on lossless material writes DIFFERENT filters to its two
//     ends, which is what makes it the tile for the source-rate cases: the two
//     answers are distinct names, so a tile fixed on one side fails one of the
//     two rather than coinciding with both.
//
// THE SOURCE RATE. The last two cases drive the engine's own /api/status shape
// on the exported `engineStatus` signal: `metadata.samplerate` is the SOURCE
// rate, a string attribute (docs/protocol.md §Status), and the manual puts the
// boundary at 50 kHz — "Filter/oversampling selection for '1x' rates covers
// source sampling rates below 50 kHz, so called base rates. Filter selection
// for 'Nx' rates covers everything else above the 1x rates" (HQPlayer 6 Desktop
// manual §4.6). Each of the two carries a `status.active_rate` on the OPPOSITE
// side of that boundary from its own source rate, so a tile reading the OUTPUT
// rate answers backwards on both rather than coinciding on one. Every other
// case here plays nothing at all: `engineStatus` is put back to null, the same
// reset the live suites make.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-filtername.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { elements, attr, text } from "../support/markup.js";
import { useStorage } from "../support/storage.js";

useStorage();

const { resetTab, tabs, tileHtml } = await import("../support/easytiles.js");
const { rememberKnobs } = await import("../../../hqptuner/static/store/easyview.js");
const signals = await import("../../../hqptuner/static/store/signals.js");

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

// The single-filter tile, the knob position it is put on and the filter that
// position writes to both ends of its chain. All three wire identifiers, stated
// outright — the position in particular, rather than inherited from wherever
// `emphasis` happens to rest: a resting position is the owner's to revisit, and
// moving it must not silently repoint these cases at another filter.
const ONE_FILTER_TILE = "purist";
const ONE_FILTER_KNOBS = { emphasis: "space" };
const ONE_FILTER = "poly-sinc-gauss-halfband";

// The split-chain tile, its knob positions stated rather than inherited from
// wherever the knobs happen to rest, and the two DIFFERENT filters that
// combination writes — the standard one at the 1x end, the hi-res one at the Nx
// end. Neither is annotated by the fixture's overlay.
const SPLIT_TILE = "perfect-ten";
const SPLIT_KNOBS = { emphasis: "space", material: "lossless" };
const SPLIT_1X = "poly-sinc-gauss-long";
const SPLIT_NX = "poly-sinc-gauss-hires-lp";

// Two source rates either side of the engine's 50 kHz boundary, each paired
// with an output rate on the other side of it.
const SOURCE_1X = { samplerate: "44100", activeRate: "705600" };
const SOURCE_NX = { samplerate: "96000", activeRate: "44100" };

// The overlay row for the one annotated filter, and the four values it carries.
// Every one is invented test data that occurs nowhere else in this repository —
// no shipped overlay, no schema, no label reads anything like them — so a line
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
// was built from, and that word is owner copy — rule 9 keeps it out of every
// assertion here. So a line is read the way
// tests/js/components/combobox-plainnames.test.js reads a family header: the
// injected values are unique tokens that occur nowhere else in a render, so
// WHICH of them a line carries is observable without matching any word the
// component supplies. `injectedIn` below answers exactly that, and each case
// asserts the whole of its answer — so a line carrying two of the values, or
// the wrong one, or none, fails by naming what it carried.
const FAMILY_VALUE = "Zzfamily Alpha";
const VARIANT_VALUE = "Yyvariant Bravo";
const LEAF_VALUE = "Xxleaf Charlie";
const SHORT_VALUE = "Wwshort Delta";

const PLAIN_FILTERS = {
  [ONE_FILTER]: {
    family: FAMILY_VALUE,
    variant: VARIANT_VALUE,
    leaf: LEAF_VALUE,
    short: SHORT_VALUE,
    apod: false,
  },
};

const EMPTY_SECTION = { entries: {}, families: {}, variants: {} };

/**
 * The tabs lane, rendered with the fixture's overlay riding /api/metadata.
 *
 * `source` is what the engine reports playing, or nothing at all when a case
 * does not name one. `record` is the knob positions a tile is put on, recorded
 * after the reset that clears the record and before the render that reads it.
 *
 * @param {{
 *   source?: { samplerate: string, activeRate: string },
 *   record?: { preset: string, positions: Record<string, string> },
 * }} [seams]
 * @returns {Promise<string>}
 */
async function card({ source, record } = {}) {
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
      filters: { entries: PLAIN_FILTERS, families: {}, variants: {} },
      dithers: { ...EMPTY_SECTION },
      modulators: { ...EMPTY_SECTION },
    },
  };
  if (record !== undefined) rememberKnobs(record.preset, record.positions);
  return tabs();
}

/**
 * The annotated tile's card, on the stated knob position, with nothing playing.
 *
 * @returns {Promise<string>}
 */
const annotatedCard = () => card({ record: { preset: ONE_FILTER_TILE, positions: ONE_FILTER_KNOBS } });

/**
 * The split-chain tile's card, on the stated knob positions, with one source
 * rate playing — or with nothing playing when handed no source.
 *
 * @param {{ samplerate: string, activeRate: string }} [source]
 * @returns {Promise<string>}
 */
const splitCard = (source) => card({ source, record: { preset: SPLIT_TILE, positions: SPLIT_KNOBS } });

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
// enumerates it.

test("test_a_tile_shows_the_engine_filter_name_its_knob_positions_write", async () => {
  assert.equal(partText(await annotatedCard(), ONE_FILTER_TILE, "raw"), ONE_FILTER);
});

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
// (see the header). Three cases rather than one, one line apiece, so a
// rendering that got two of the three right fails by naming the one it did not.

test("test_a_tile_shows_the_overlay_rows_family_on_the_family_line", async () => {
  assert.deepEqual(injectedIn(await annotatedCard(), ONE_FILTER_TILE, "family"), [FAMILY_VALUE]);
});

test("test_a_tile_shows_the_overlay_rows_variant_on_the_class_line", async () => {
  assert.deepEqual(injectedIn(await annotatedCard(), ONE_FILTER_TILE, "class"), [VARIANT_VALUE]);
});

test("test_a_tile_shows_the_overlay_rows_leaf_on_the_shape_line", async () => {
  assert.deepEqual(injectedIn(await annotatedCard(), ONE_FILTER_TILE, "shape"), [LEAF_VALUE]);
});

test("test_a_tile_whose_filter_the_overlay_does_not_know_shows_the_raw_name_and_no_family_line", async () => {
  const laid = parts(await card(), SPLIT_TILE).filter((part) => part === "raw" || part === "family");
  assert.deepEqual(laid, ["raw"]);
});

// ============================================================================
// the name follows the playing source rate
// ============================================================================
//
// One tile, one set of knob positions, two source rates: a base-rate source
// names the filter at the 1x end of the chain and a multiple-rate source names
// the one at the Nx end. The two names differ, so neither case can be satisfied
// by a tile that always shows the other side.

test("test_a_tile_playing_a_base_rate_source_names_the_filter_at_the_1x_end", async () => {
  assert.equal(partText(await splitCard(SOURCE_1X), SPLIT_TILE, "raw"), SPLIT_1X);
});

test("test_a_tile_playing_a_multiple_rate_source_names_the_filter_at_the_nx_end", async () => {
  assert.equal(partText(await splitCard(SOURCE_NX), SPLIT_TILE, "raw"), SPLIT_NX);
});

// And with nothing playing at all there is no source rate to follow, so the
// tile rests on the 1x end — the same side a base-rate source puts it on. Read
// on the SPLIT tile, where the two sides carry different names: a tile that
// defaulted to the Nx end while idle names the other filter here, and is
// invisible on a tile whose two ends agree.

test("test_a_tile_with_nothing_playing_names_the_filter_at_the_1x_end", async () => {
  assert.equal(partText(await splitCard(), SPLIT_TILE, "raw"), SPLIT_1X);
});
