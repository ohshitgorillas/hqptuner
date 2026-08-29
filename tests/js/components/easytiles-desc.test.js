// Behavioral suite for the STRUCTURE of an Easy Mode tile's description: a
// description renders one block per blank-line-separated paragraph of its copy,
// in the order the copy states them, and a description with no blank line in it
// renders as one block.
//
// The companion files are tests/js/components/easytiles.test.js (the tiles, the
// active marking and where a press routes what the table names) and
// tests/js/components/easytiles-knobs.test.js (what a dark tile's knobs show).
// All three share tests/js/support/easytiles.js, imported dynamically after
// `useStorage()` so that `store/easyview.js` meets the fake localStorage at its
// load-time read.
//
// NOTHING HERE READS COPY (docs/testing.md rule 9). The descriptions the tiles
// are rendering are this file's own stand-ins, seeded through /api/metadata's
// `easy.<presetId>` shape (tests/api/test_metadata_easy.py) — the owner's
// own descriptions never reach these cases, no block's words are asserted, no
// substring is looked for and no length is counted. What is asserted is how many
// blocks a description of N paragraphs comes out as, and that they hang off one
// container. Reword every description that ships and every case here stays
// green.
//
// HOOK THIS SUITE REQUIRES the implementation to provide:
//   * `data-para` on each paragraph element of a tile's description — one per
//     paragraph, children of the description element. A marking put there to be
//     found by, the way `data-note="easy-notice"` and `data-testid="easy-pips"`
//     already are. The styling classes around it (`.easy-desc` and whatever a
//     paragraph carries) are the owner's to change and are selected on nowhere.
//     Only the attribute's PRESENCE is read: what it is valued with is the
//     writer's business, not a contract these cases hold anyone to.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-desc.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const { resetTab, tabs } = await import("../support/easytiles.js");
const { descBlockCount, descBlockContainers } = await import("../support/easydesc.js");

// The tiles the stand-in copy is hung on. Preset ids are wire identifiers, so
// they are stated outright.
const TILE = "perfect-ten";
const SECOND_TILE = "lifelike";

// Stand-in prose, never compared against what ships. Three paragraphs, one
// paragraph, and one paragraph carrying an interior newline that is NOT a blank
// line — the last is what separates "split on a blank line" from "split on any
// newline".
const THREE = "First paragraph, seeded by the suite.\n\nSecond one.\n\nThird one.";
const ONE = "One paragraph, seeded by the suite, with no blank line anywhere in it.";
const WRAPPED = "One paragraph, seeded by the suite,\nsoft wrapped across two lines.";

/**
 * The metadata copy for one tile, keyed the way /api/metadata keys it.
 *
 * @param {string} presetId
 * @param {string} description
 * @returns {Record<string, object>}
 */
const copyFor = (presetId, description) => ({
  [presetId]: { title: "A stand-in title, seeded by the suite.", description },
});

// ============================================================================
// one block per paragraph
// ============================================================================

test("test_a_tile_description_of_three_paragraphs_renders_three_blocks", async () => {
  await resetTab({ notes: true, copy: copyFor(TILE, THREE) });
  assert.equal(descBlockCount(tabs(), TILE), 3);
});

test("test_a_tile_description_with_no_blank_line_renders_one_block", async () => {
  await resetTab({ notes: true, copy: copyFor(TILE, ONE) });
  assert.equal(descBlockCount(tabs(), TILE), 1);
});

// A newline that is not a blank line is inside a paragraph, not between two.

test("test_a_tile_description_broken_only_by_a_single_newline_renders_one_block", async () => {
  await resetTab({ notes: true, copy: copyFor(TILE, WRAPPED) });
  assert.equal(descBlockCount(tabs(), TILE), 1);
});

// The same structure on a second tile: paragraph blocks belong to a tile rather
// than to whichever one the card happens to lay out first.

test("test_a_second_tiles_description_of_three_paragraphs_renders_three_blocks", async () => {
  await resetTab({ notes: true, copy: copyFor(SECOND_TILE, THREE) });
  assert.equal(descBlockCount(tabs(), SECOND_TILE), 3);
});

// ============================================================================
// and the blocks are in one place, so their order is the copy's order
// ============================================================================
//
// The container's child order IS the order the paragraphs read in. Blocks
// scattered across two wrappers carry no order between them however they happen
// to land on screen, which is why this is read rather than assumed by the counts
// above.

test("test_the_blocks_of_a_multi_paragraph_description_hang_off_one_container", async () => {
  await resetTab({ notes: true, copy: copyFor(TILE, THREE) });
  assert.equal(descBlockContainers(tabs(), TILE), 1);
});
