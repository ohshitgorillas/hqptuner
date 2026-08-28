// Behavioral suite for the Source knob's "auto" position on the album grid, and
// for the grid preference `matchPreset` takes when both grids can claim the same
// filter fields.
//
// The companion file is tests/js/store/easy.test.js, which owns the rest of the
// curated table — the output modes, the `-2s` split, the knob fallbacks and the
// round trips. Only what the "auto" position adds lives here.
//
// WHAT "AUTO" MEANS, as a behavior: an album preset's Source knob already had
// `standard` (one filter on both ends of the chain) and `hires` (the hi-res
// filter on both ends). `auto` is the third position, and it writes the two
// DIFFERENT filters — the standard one at 1x, the hi-res one at Nx — so the
// engine picks per rate rather than the user picking once. It is also the
// position a fresh tile rests at, which is why the no-source call below is
// stated as its own case.
//
// WHY THE PREFERENCE EXISTS: that pair of values is exactly what the PLAYLIST
// grid's `perfect-ten` writes, so one field set now reads as two presets. Which
// one a caller is told about is the caller's to say, and the third argument is
// how it says it. The preference is a TIE-BREAK: where only one grid can claim
// the values, it is that grid that answers however the caller leans.
//
// Anchored on schema keys and filter names, both wire identifiers — nothing here
// reads a word of copy (docs/testing.md rule 9).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easy-source-auto.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { writeSet, matchPreset } from "../../../hqptuner/static/store/easy.js";

const PCM_1X = "pcm_filter_1x";
const PCM_NX = "pcm_filter_nx";

/** The PCM pair, both keys carrying one name. */
function pcmBoth(/** @type {string} */ name) {
  return { [PCM_1X]: name, [PCM_NX]: name };
}

// ============================================================================
// the "auto" position splits the two ends of the chain
// ============================================================================
//
// One key per case, so a preset that got the 1x end right and the Nx end wrong
// fails by naming the end that is wrong.

test("test_perfect_ten_on_an_auto_source_with_emphasis_on_space_writes_the_long_filter_at_1x", () => {
  assert.equal(
    writeSet("album", "perfect-ten", "pcm", { emphasis: "space", source: "auto" })[PCM_1X],
    "poly-sinc-gauss-long",
  );
});

test("test_perfect_ten_on_an_auto_source_with_emphasis_on_space_writes_the_hires_lp_filter_at_nx", () => {
  assert.equal(
    writeSet("album", "perfect-ten", "pcm", { emphasis: "space", source: "auto" })[PCM_NX],
    "poly-sinc-gauss-hires-lp",
  );
});

test("test_perfect_ten_on_an_auto_source_with_emphasis_on_transients_writes_the_medium_filter_at_1x", () => {
  assert.equal(
    writeSet("album", "perfect-ten", "pcm", { emphasis: "transients", source: "auto" })[PCM_1X],
    "poly-sinc-gauss-medium",
  );
});

test("test_perfect_ten_on_an_auto_source_with_emphasis_on_transients_writes_the_hires_mp_filter_at_nx", () => {
  assert.equal(
    writeSet("album", "perfect-ten", "pcm", { emphasis: "transients", source: "auto" })[PCM_NX],
    "poly-sinc-gauss-hires-mp",
  );
});

test("test_lifelike_on_an_auto_source_with_emphasis_on_space_writes_the_ext2_long_filter_at_1x", () => {
  assert.equal(
    writeSet("album", "lifelike", "pcm", { emphasis: "space", source: "auto" })[PCM_1X],
    "poly-sinc-ext2-long",
  );
});

test("test_lifelike_on_an_auto_source_with_emphasis_on_space_writes_the_ext2_hires_lp_filter_at_nx", () => {
  assert.equal(
    writeSet("album", "lifelike", "pcm", { emphasis: "space", source: "auto" })[PCM_NX],
    "poly-sinc-ext2-hires-lp",
  );
});

test("test_lifelike_on_an_auto_source_with_emphasis_on_transients_writes_the_ext2_medium_filter_at_1x", () => {
  assert.equal(
    writeSet("album", "lifelike", "pcm", { emphasis: "transients", source: "auto" })[PCM_1X],
    "poly-sinc-ext2-medium",
  );
});

test("test_lifelike_on_an_auto_source_with_emphasis_on_transients_writes_the_ext2_hires_mp_filter_at_nx", () => {
  assert.equal(
    writeSet("album", "lifelike", "pcm", { emphasis: "transients", source: "auto" })[PCM_NX],
    "poly-sinc-ext2-hires-mp",
  );
});

// The two positions that were already there — `standard` and `hires`, one filter
// on both ends of the chain — are tests/js/store/easy.test.js's `CROSSED_CASES`,
// which reads all eight combinations of the two knobs across both families. Not
// restated here: an identical call with an identical expectation cannot fail
// where its twin passes.

// ============================================================================
// a fresh tile rests on "auto"
// ============================================================================
//
// The source knob left out entirely, so what answers is the knob's DEFAULT. Read
// against the pair outright rather than against a second `writeSet` call, which
// would only ask the module to agree with itself.

test("test_a_perfect_ten_call_that_names_no_source_writes_the_auto_pair", () => {
  assert.deepEqual(writeSet("album", "perfect-ten", "pcm", { emphasis: "space" }), {
    [PCM_1X]: "poly-sinc-gauss-long",
    [PCM_NX]: "poly-sinc-gauss-hires-lp",
  });
});

// ============================================================================
// the grid preference
// ============================================================================
//
// The values both grids can claim: album `perfect-ten` on an auto source, and
// playlist `perfect-ten` on space, write this same pair. Stated outright rather
// than produced by `writeSet`, so that the collision these cases are about does
// not rest on the section above being right.

const CONTESTED = { [PCM_1X]: "poly-sinc-gauss-long", [PCM_NX]: "poly-sinc-gauss-hires-lp" };

test("test_matchpreset_answers_with_the_playlist_grid_when_the_caller_prefers_playlist", () => {
  assert.equal(matchPreset(CONTESTED, "pcm", "playlist")?.grid, "playlist");
});

test("test_matchpreset_answers_with_the_album_grid_when_the_caller_prefers_album", () => {
  assert.equal(matchPreset(CONTESTED, "pcm", "album")?.grid, "album");
});

test("test_the_album_answer_puts_the_source_knob_on_auto", () => {
  assert.equal(matchPreset(CONTESTED, "pcm", "album")?.knobs?.source, "auto");
});

// A preference is a tie-break and not a filter: `old-school` lives on the album
// grid alone, so the album is what answers even where the caller leans the other
// way.

test("test_values_only_the_album_grid_can_claim_still_answer_album_under_a_playlist_preference", () => {
  assert.equal(matchPreset(pcmBoth("poly-sinc-short-lp"), "pcm", "playlist")?.grid, "album");
});

// And the mirror of it, which is the half that fails on a module answering with
// whichever grid the caller named whenever that grid can claim anything at all:
// `lossy` lives on the playlist grid alone, and the name it writes to both ends
// of the chain is one no album preset writes.

test("test_values_only_the_playlist_grid_can_claim_still_answer_playlist_under_an_album_preference", () => {
  assert.equal(matchPreset(pcmBoth("poly-sinc-mqa/mp3-lp"), "pcm", "album")?.grid, "playlist");
});

test("test_matchpreset_still_returns_null_for_values_no_grid_writes_however_the_caller_leans", () => {
  assert.equal(matchPreset(pcmBoth("sinc-M"), "pcm", "playlist"), null);
});
