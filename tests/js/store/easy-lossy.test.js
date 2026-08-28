// Behavioral suite for the playlist grid's third preset, `lossy`: what it writes
// to the filter fields, at each position of its emphasis knob and on each chain.
//
// The companion file is tests/js/store/easy.test.js, which owns the rest of the
// curated table. Only what this preset adds lives here.
//
// WHAT IS PARTICULAR ABOUT IT: it sits on the playlist grid, whose other two
// presets write two DIFFERENT filters (one at 1x, one at Nx) — this one writes a
// single name to both ends of its chain, so each end is read as its own case
// rather than as one pair.
//
// The filter names it writes carry a slash. That is an ordinary character in a
// name and nothing splits on it: a name is one wire identifier the engine
// enumerates whole (docs/architecture.md §2).
//
// Anchored on schema keys and filter names, both wire identifiers — nothing here
// reads a word of copy (docs/testing.md rule 9).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easy-lossy.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { writeSet } from "../../../hqptuner/static/store/easy.js";

const PCM_1X = "pcm_filter_1x";
const PCM_NX = "pcm_filter_nx";
const SDM_1X = "sdm_filter_1x";
const SDM_NX = "sdm_filter_nx";

const LOSSY_SPACE = "poly-sinc-mqa/mp3-lp";
const LOSSY_TRANSIENTS = "poly-sinc-mqa/mp3-mp";

// ============================================================================
// the emphasis knob's two positions
// ============================================================================

test("test_the_lossy_preset_with_emphasis_on_space_writes_the_lp_filter_at_1x", () => {
  assert.equal(writeSet("playlist", "lossy", "pcm", { emphasis: "space" })[PCM_1X], LOSSY_SPACE);
});

test("test_the_lossy_preset_with_emphasis_on_space_writes_the_same_lp_filter_at_nx", () => {
  assert.equal(writeSet("playlist", "lossy", "pcm", { emphasis: "space" })[PCM_NX], LOSSY_SPACE);
});

test("test_the_lossy_preset_with_emphasis_on_transients_writes_the_mp_filter_at_1x", () => {
  assert.equal(writeSet("playlist", "lossy", "pcm", { emphasis: "transients" })[PCM_1X], LOSSY_TRANSIENTS);
});

test("test_the_lossy_preset_with_emphasis_on_transients_writes_the_same_mp_filter_at_nx", () => {
  assert.equal(writeSet("playlist", "lossy", "pcm", { emphasis: "transients" })[PCM_NX], LOSSY_TRANSIENTS);
});

// ============================================================================
// both chains under the auto output mode
// ============================================================================
//
// The SDM end read in its own right: a preset reached only through the PCM keys
// would pass every case above and still leave the SDM chain unwritten. Both ends
// of that chain, one case apiece, the way the PCM ends are read above — a preset
// writing only the 1x end leaves the Nx end of the SDM chain carrying whatever
// was there before.

test("test_the_lossy_preset_under_the_auto_output_mode_writes_its_filter_to_the_sdm_chain_too", () => {
  assert.equal(writeSet("playlist", "lossy", "auto", { emphasis: "space" })[SDM_1X], LOSSY_SPACE);
});

test("test_the_lossy_preset_under_the_auto_output_mode_writes_the_same_filter_to_the_sdm_nx_end", () => {
  assert.equal(writeSet("playlist", "lossy", "auto", { emphasis: "space" })[SDM_NX], LOSSY_SPACE);
});
