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
// it is contract and is asserted outright. The three descriptor lines are the
// opposite: their wording is owner-owned plain-names data, reworded at will, so
// no case here reads a family, class or shape STRING. Only whether such a line
// is there at all. Nothing is selected on a sentence: every element is found by
// its `data-testid` or its `data-part`, and the tile it sits in by its
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

// The single-filter tile and the filter it writes at its resting knob position.
// Both wire identifiers, stated outright.
const ONE_FILTER_TILE = "purist";
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

// The overlay row for the one annotated filter. Family, variant, leaf and short
// are invented test data, asserted nowhere — only the fact that a row exists is
// what the presence case rests on.
const PLAIN_FILTERS = {
  [ONE_FILTER]: {
    family: "Famgauss",
    variant: "Zed tap",
    leaf: "Halfband pick",
    short: "Gauss HB",
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
 * The split-chain tile's card, on the stated knob positions, with one source
 * rate playing.
 *
 * @param {{ samplerate: string, activeRate: string }} source
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
  assert.equal(partText(await card(), ONE_FILTER_TILE, "raw"), ONE_FILTER);
});

// ============================================================================
// the descriptor lines
// ============================================================================
//
// A filter the overlay annotates gets its descriptor lines; a filter it does
// not know gets the raw name and nothing derived. The three presence cases are
// what keep the absence case honest — a tile that never rendered a descriptor
// at all would satisfy the absence case on its own — and they are three rather
// than one because a tile that laid out the family line and dropped either of
// the other two would satisfy a single one.
//
// No case reads a word of the descriptors. The first three ask only whether a
// line is there, the last asks which of the two markings the block laid out,
// the wording of the fixture's own overlay row is never compared against, and
// no case says which of that row's fields fed which line.

test("test_a_tile_whose_filter_the_overlay_annotates_shows_a_family_line", async () => {
  assert.ok(parts(await card(), ONE_FILTER_TILE).includes("family"));
});

test("test_a_tile_whose_filter_the_overlay_annotates_shows_a_class_line", async () => {
  assert.ok(parts(await card(), ONE_FILTER_TILE).includes("class"));
});

test("test_a_tile_whose_filter_the_overlay_annotates_shows_a_shape_line", async () => {
  assert.ok(parts(await card(), ONE_FILTER_TILE).includes("shape"));
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
