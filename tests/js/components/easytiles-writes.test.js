// Behavioral suite for what a press on an Easy Mode tile DOES NOT write: only
// those filter fields whose current value differs from what the preset would set
// them to reach the wire, so a press that would change nothing writes nothing at
// all — while the record of where that tile's knobs sit is updated either way.
//
// The companion file is tests/js/components/easytiles.test.js, which owns the
// grids, the active marking and where a press routes what the table names; this
// one is about the writes that press DOES NOT make. Both share
// tests/js/support/easytiles.js, imported dynamically after `useStorage()` so
// that `store/easyview.js` meets the fake localStorage at its load-time read.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. Every case drives the exported store signals with the shapes
// /api/config, /api/state and /api/enumerations actually serve, and every write
// leaves over a faked `globalThis.fetch` on the real REST paths — the tabs lane
// through POST /api/config/stage, the LIVE lane through POST /api/config/live.
// No store function of HQPTuner's is stubbed.
//
// NAMES, NOT WORDS (rule 9). Schema keys, the daemon's own form-field names,
// preset ids, knob option ids and filter names are wire identifiers and are
// stated outright. Nothing here asserts a title, a description or any other
// piece of owner copy.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles-writes.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const {
  ALBUM_TILE,
  PLAYLIST_TILE,
  EMPTY,
  resetTab,
  resetLive,
  running,
  inForce,
  seedPcmPair,
  flush,
  seenTabs,
  seenLive,
  stagedNames,
  postedFields,
  pressTile,
  pressKnob,
} = await import("../support/easytiles.js");

const { knobsFor } = await import("../../../hqptuner/static/store/easyview.js");

// The schema key the fixture seeds a field by, and the daemon's own form-field
// name that key is carried to — `pcm_filter_1x` is the 1x end of the PCM chain
// and the daemon calls it `filter1x`, `pcm_filter_nx` is the Nx end and the
// daemon calls it `filter` (store/live/derive.js). Wire identifiers both.
const PCM_1X = "pcm_filter_1x";
const NX_FIELD = "filter";

// The filters the two tiles under test write, stated outright the way
// tests/js/components/easytiles.test.js states them: `perfect-ten`'s
// standard-source, space-emphasis filter, which the album tile writes to both
// ends of the PCM chain, and `lifelike`'s playlist pair — one name for each end
// — at its `transients` position and at its `space` one.
const ALBUM_STANDARD_SPACE = "poly-sinc-gauss-long";
const PLAYLIST_TRANSIENTS = { oneX: "poly-sinc-ext2-medium", nX: "poly-sinc-ext2-hires-mp" };
const PLAYLIST_SPACE_NX = "poly-sinc-ext2-hires-lp";

// Both knobs of the album tile, where an untouched press leaves them.
const DEFAULT_KNOBS = { source: "standard", emphasis: "space" };

// ============================================================================
// a press that would change nothing writes nothing
// ============================================================================
//
// The fields already carry exactly what the lit tile stands for, at the knob
// positions it is showing. A lane that re-stated all four fields anyway would
// leave the user an apply to make and an engine reload to pay for, for no change
// at all.

test("test_pressing_the_lit_tile_at_its_current_knob_positions_stages_nothing", async () => {
  const w = await resetTab({ grid: "album", mode: "auto", names: inForce(ALBUM_TILE) });
  pressTile(seenTabs(), ALBUM_TILE);
  await flush(w);
  assert.deepEqual(w.staged, EMPTY);
});

// The same on the LIVE lane, where "what the fields carry" is the engine's own
// two filter indices joined to its enumerations rather than a form the daemon
// handed over. The lane is a different wire; the rule is the same one.

test("test_pressing_the_lit_tile_on_the_live_lane_posts_no_fields", async () => {
  const w = await resetLive({ grid: "album", ...running(ALBUM_TILE) });
  pressTile(seenLive(), ALBUM_TILE);
  await flush(w);
  assert.deepEqual(postedFields(w), {});
});

// ============================================================================
// a press that would change one field writes that one
// ============================================================================
//
// Half the chain already carries the preset's filter and half does not, so the
// press has exactly one field to write. A lane that wrote both fails by naming
// the one it should have left alone.

test("test_a_tile_press_stages_only_the_field_whose_value_differs", async () => {
  const w = await resetTab({ grid: "album", mode: "pcm", names: { [PCM_1X]: ALBUM_STANDARD_SPACE } });
  pressTile(seenTabs(), ALBUM_TILE);
  await flush(w);
  assert.deepEqual(stagedNames(w), { [NX_FIELD]: ALBUM_STANDARD_SPACE });
});

// And a knob MOVE that lands on a pair the fields half carry already: the
// playlist tile's `emphasis` knob names one filter for each end of the chain, so
// a fixture carrying the transients 1x filter beside the space Nx one leaves the
// move one field to make.

test("test_a_knob_move_stages_only_the_field_that_position_changes", async () => {
  const w = await resetTab({
    grid: "playlist",
    mode: "pcm",
    names: seedPcmPair(PLAYLIST_TRANSIENTS.oneX, PLAYLIST_SPACE_NX),
  });
  pressKnob(seenTabs(), PLAYLIST_TILE, "transients");
  await flush(w);
  assert.deepEqual(stagedNames(w), { [NX_FIELD]: PLAYLIST_TRANSIENTS.nX });
});

// ============================================================================
// the record is kept either way
// ============================================================================
//
// Where a tile's knobs sit is what a DARK tile shows afterwards
// (tests/js/components/easytiles-knobs.test.js), and it is a fact about the tile
// rather than about the wire: a press that found nothing to write still put the
// tile at those positions, and a card that recorded only when it wrote would
// lose them.

test("test_a_press_that_writes_nothing_still_records_the_tiles_knob_positions", async () => {
  const w = await resetTab({ grid: "album", mode: "auto", names: inForce(ALBUM_TILE) });
  pressTile(seenTabs(), ALBUM_TILE);
  await flush(w);
  assert.deepEqual(knobsFor("album", ALBUM_TILE), DEFAULT_KNOBS);
});
