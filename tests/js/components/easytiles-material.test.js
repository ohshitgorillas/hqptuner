// Behavioral suite for the card's ONE MATERIAL KNOB and the GRAYING it puts on
// Easy Mode's preset tiles: the Lossless | Lossy control is a card knob, one
// control on the card body rather than a row on any tile, and while it is off
// its default the tiles whose preset cannot write a hi-res-family filter gray
// out.
//
// The companion files are tests/js/components/easytiles.test.js (the tiles and
// the active marking), tests/js/components/easytiles-filtername.test.js (the
// filter name a tile displays) and tests/js/components/easytiles-mark.test.js
// (the apodizing mark, whose facet seam this file shares). All share
// tests/js/support/easytiles.js, imported dynamically after `useStorage()` so
// that `store/easyview.js` meets the fake localStorage at its load-time read.
//
// HOOKS THIS SUITE REQUIRES the implementation to provide:
//   * the tile BOX as an `easy-tile`-classed element carrying `data-preset`,
//     with `data-grayed="1"` while grayed and NO `data-grayed` attribute
//     otherwise;
//   * the tile's preset button as the one `button.easy-pick` inside that box,
//     and its knob option buttons as the `.seg[data-v]` buttons inside the
//     tile's `[data-knob]` wrappers, each carrying the `disabled` attribute
//     while the tile is grayed (SSR renders it bare: ` disabled`);
//   * `data-testid="easy-filter"` on the tile's filter block and
//     `data-part="raw"` on the engine filter name inside it, the hooks
//     tests/js/components/easytiles-filtername.test.js already pins;
//   * `setEasyMaterial` on `store/easyview.js`, the public way the card knob's
//     position is stated. The card control's own rendering is not read here:
//     the knob is driven through the store before the render.
//
// WHICH TILES GRAY is not decided here. A tile grays when NO combination of its
// preset's knob positions writes a filter whose FACET says hi-res family, and
// both halves of that are public: `combos` × `writeSet` is the table's sweep,
// `filterFacets` is the store's facet for a name. The presets are therefore
// partitioned off those two (tests/js/support/easygray.js), one case per
// preset per output mode on each side, and no preset is named to stand for
// either property. A facet exists for a name only when the seeded metadata
// lists that filter, so `uniformFacets` (every name the table writes) is the
// arrangement in which the partition means something, and seeding NOTHING is
// the "no facet at all" arrangement.
//
// THE PARTITION IS COMPUTED ONCE, at module level, under the same facet seed
// every case that depends on it re-applies after its own reset: module-level
// signals outlive a case (docs/testing.md, harness facts), so no case leans on
// a seed another case left behind.
//
// NAMES, NOT WORDS (rule 9). Preset ids, knob ids and knob positions are wire
// identifiers, read off the table; the engine filter name a tile displays is a
// wire identifier too (docs/architecture.md §2) and is asserted against the
// facet the store holds for it, never typed. No title, hint or label is read.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-material.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const { resetTab, tabs, ROSTER } = await import("../support/easytiles.js");
const { seedFacets, uniformFacets } = await import("../support/easymark.js");
const {
  writesHiresFamily,
  facetless,
  grayed,
  grayMap,
  rawName,
  hiresFamily,
  pickDisabled,
  knobOptionsOf,
  optionDisabled,
} = await import("../support/easygray.js");
const { setEasyMaterial } = await import("../../../hqptuner/static/store/easyview.js");
const { presetsFor } = await import("../../../hqptuner/static/store/easy.js");

/** @typedef {import("../support/easytiles.js").Knob} Knob */
/** @typedef {import("../support/easytiles.js").Preset} Preset */

/** @type {Preset[]} */
const PRESETS = presetsFor();

// The three output modes a lane can be in, every one read: a card that grayed on
// one chain and forgot another fails by naming the mode.
const MODES = ["pcm", "sdm", "auto"];

// The card knob, off the table: the knob the presets declare `card`. Its resting
// position and the first position off it are the two the card is put on. A
// table declaring no card knob throws here rather than generating a suite that
// reads the resting card in every case.
/** @type {Knob | undefined} */
const CARD_KNOB = PRESETS.flatMap((preset) => preset.knobs).find((knob) => knob.card);
if (CARD_KNOB === undefined) throw new Error("no preset of the table declares a card knob");
const AT_DEFAULT = String(CARD_KNOB.default);
const OFF_DEFAULT = CARD_KNOB.options.map(String).find((option) => option !== AT_DEFAULT);
if (OFF_DEFAULT === undefined) throw new Error("the card knob offers no position off its default");

// The facet seed the partition is computed under and every partitioned case
// re-applies: a stated class for every filter the table can write, so every
// name has a facet and the facet alone decides which are hi-res family.
const EVERY_NAME_FACETED = uniformFacets("full");

/**
 * The card, reset into one output mode with the facets seeded as given and the
 * card knob put on one position. The order is the harness's: the reset clears
 * both the facets and the card knob, so both are stated after it.
 *
 * @param {string} mode
 * @param {Record<string, string>} facets
 * @param {string} material
 * @returns {Promise<string>}
 */
async function card(mode, facets, material) {
  await resetTab({ mode });
  seedFacets(facets);
  setEasyMaterial(material);
  return tabs();
}

// --- the partition -------------------------------------------------------------------
//
// Computed under `EVERY_NAME_FACETED`, per mode: the presets writing a
// hi-res-family filter at SOME combination of their knob positions, and the
// presets writing none at any.

await resetTab({ mode: "pcm" });
seedFacets(EVERY_NAME_FACETED);

/** @type {Record<string, string[]>} */
const HIRES_WRITERS = Object.fromEntries(
  MODES.map((mode) => [
    mode,
    PRESETS.filter((preset) => writesHiresFamily(preset, mode)).map((preset) => String(preset.id)),
  ]),
);
/** @type {Record<string, string[]>} */
const NON_WRITERS = Object.fromEntries(
  MODES.map((mode) => [
    mode,
    PRESETS.filter((preset) => !writesHiresFamily(preset, mode)).map((preset) => String(preset.id)),
  ]),
);

// Every sweep below is generated from one side of the partition, so a table on
// which one side were empty would retire that side's rule with nothing red.
// Guards, not tests: which presets fall on which side is the curated table's
// business (docs/testing.md rule 9), so a side being empty is a suite that
// cannot be generated, and the module throws rather than pinning the table.

if (!MODES.some((mode) => NON_WRITERS[mode].length > 0))
  throw new Error("every preset writes a hi-res-family filter somewhere in every mode; the grayed sweep is empty");
if (!MODES.some((mode) => HIRES_WRITERS[mode].length > 0))
  throw new Error("no preset writes a hi-res-family filter in any mode; the not-grayed sweep is empty");

// The knob option buttons the GRAYED tiles render, per mode, read off one
// rendering of the card with its knob off its default: one entry per option
// button of every knob row a grayed tile lays out. A grayed tile rendering no
// knob row contributes nothing, so the sweep over option buttons is generated
// off what the card draws rather than off the table. Empty across every mode
// means the sweep cannot be generated at all, and the module throws.

/** @type {Record<string, { presetId: string, knobId: string, value: string }[]>} */
const GRAYED_OPTIONS = {};
for (const mode of MODES) {
  const out = await card(mode, EVERY_NAME_FACETED, OFF_DEFAULT);
  GRAYED_OPTIONS[mode] = NON_WRITERS[mode].flatMap((presetId) =>
    knobOptionsOf(out, presetId).map((option) => ({ presetId, ...option })),
  );
}
if (!MODES.some((mode) => GRAYED_OPTIONS[mode].length > 0))
  throw new Error("no grayed tile renders a knob row in any mode; the disabled-option sweep is empty");

// ============================================================================
// the card knob off its default
// ============================================================================
//
// A preset that cannot write a hi-res-family filter at ANY combination of its
// knob positions has nothing to offer the material the card is set to, and its
// tile grays. One case per such preset per mode, so a card that grayed some
// but not all fails by naming the tile it left lit.

for (const mode of MODES) {
  for (const presetId of NON_WRITERS[mode]) {
    test(`test_the_${presetId}_tile_is_grayed_in_the_${mode}_mode_while_the_card_knob_is_off_its_default`, async () => {
      assert.equal(grayed(await card(mode, EVERY_NAME_FACETED, OFF_DEFAULT), presetId), "1");
    });
  }
}

// A preset writing a hi-res-family filter at SOME combination stays lit: the
// attribute is absent altogether, not present with another value.

for (const mode of MODES) {
  for (const presetId of HIRES_WRITERS[mode]) {
    test(`test_the_${presetId}_tile_is_not_grayed_in_the_${mode}_mode_while_the_card_knob_is_off_its_default`, async () => {
      assert.equal(grayed(await card(mode, EVERY_NAME_FACETED, OFF_DEFAULT), presetId), undefined);
    });
  }
}

// And the tile that stays lit displays a hi-res-family filter: the raw engine
// name in its filter block is one the store's facet marks hi-res family. Read
// off the facet, never off the spelling of the name.

for (const mode of MODES) {
  for (const presetId of HIRES_WRITERS[mode]) {
    test(`test_the_${presetId}_tile_displays_a_hires_family_filter_in_the_${mode}_mode_while_the_card_knob_is_off_its_default`, async () => {
      assert.equal(hiresFamily(rawName(await card(mode, EVERY_NAME_FACETED, OFF_DEFAULT), presetId)), true);
    });
  }
}

// ============================================================================
// no facet at all
// ============================================================================
//
// Nothing is seeded, so the store holds no facet for any name a preset writes,
// and a facet that does not exist says nothing about hi-res family: no tile
// grays. Every preset, every mode. The arrangement is checked before the
// reading, so a case in which the store DID hold a facet fails as set up wrong
// rather than passing on a lit tile for the other reason.

for (const mode of MODES) {
  for (const preset of PRESETS) {
    test(`test_the_${preset.id}_tile_is_not_grayed_in_the_${mode}_mode_while_no_facet_exists_for_any_filter_it_writes`, async () => {
      const out = await card(mode, {}, OFF_DEFAULT);
      if (!facetless(preset, mode))
        throw new Error(`the store holds a facet for a filter the "${preset.id}" preset writes`);
      assert.equal(grayed(out, String(preset.id)), undefined);
    });
  }
}

// ============================================================================
// the card knob at its default
// ============================================================================
//
// Nothing grays, whatever the facets say: the whole map is read, so a card that
// grayed one tile at rest fails by naming it rather than by a count. The
// expected map is built off `ROSTER`, the store's own roster, not off the ids
// the same rendering laid out, so a card that dropped a tile fails here too
// rather than agreeing with itself.

/** @type {Record<string, undefined>} */
const NONE_GRAYED = Object.fromEntries(ROSTER.map((id) => [id, undefined]));

for (const mode of MODES) {
  test(`test_no_tile_is_grayed_in_the_${mode}_mode_while_the_card_knob_is_at_its_default`, async () => {
    assert.deepEqual(grayMap(await card(mode, EVERY_NAME_FACETED, AT_DEFAULT)), NONE_GRAYED);
  });
}

// ============================================================================
// a grayed tile is disabled
// ============================================================================
//
// A grayed tile has nothing to offer the material the card is set to, so what
// it offers a pointer is taken away: its preset button carries `disabled`. One
// case per grayed preset per mode, so a card that grayed a tile and left its
// button live fails by naming the tile. The grayed marking itself is checked
// before the reading, so a case in which the tile was NOT grayed fails as set
// up wrong rather than as a live button on a lit tile.

for (const mode of MODES) {
  for (const presetId of NON_WRITERS[mode]) {
    test(`test_the_${presetId}_tiles_preset_button_is_disabled_in_the_${mode}_mode_while_the_tile_is_grayed`, async () => {
      const out = await card(mode, EVERY_NAME_FACETED, OFF_DEFAULT);
      if (grayed(out, presetId) !== "1") throw new Error(`the "${presetId}" tile is not grayed`);
      assert.equal(pickDisabled(out, presetId), true);
    });
  }
}

// And every knob option button on it carries `disabled` too: one case per
// option button of every knob row a grayed tile renders, off `GRAYED_OPTIONS`,
// so a card that disabled the preset button and left a knob live fails by
// naming the knob and the position.

for (const mode of MODES) {
  for (const { presetId, knobId, value } of GRAYED_OPTIONS[mode]) {
    test(`test_the_${presetId}_tiles_${knobId}_knob_${value}_option_is_disabled_in_the_${mode}_mode_while_the_tile_is_grayed`, async () => {
      const out = await card(mode, EVERY_NAME_FACETED, OFF_DEFAULT);
      if (grayed(out, presetId) !== "1") throw new Error(`the "${presetId}" tile is not grayed`);
      assert.equal(optionDisabled(out, presetId, knobId, value), true);
    });
  }
}
