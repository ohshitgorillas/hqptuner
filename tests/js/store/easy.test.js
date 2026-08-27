// Behavioral suite for Easy Mode's curated preset table (store/easy.js): the
// pure pair `writeSet` (preset + knob positions -> the filter field values to
// stage) and `matchPreset` (filter field values -> the preset and knob
// positions they correspond to).
//
// The module is pure — no signals, no DOM, no network — so every case here is a
// plain call with a plain return value. Nothing is stubbed and nothing needs a
// fake (docs/testing.md rule 4 has nothing to bite on where there is no wire).
//
// What the assertions are anchored on (rule 5, rule 9):
//
//   * The four SCHEMA KEYS `pcm_filter_1x`, `pcm_filter_nx`, `sdm_filter_1x`,
//     `sdm_filter_nx` (store/schema.js). These are contract, not copy — the
//     caller resolves each to its daemon field and enum id.
//   * Filter NAMES, never enum ids. The running engine is the sole authority
//     for ids and ordering and static data joins by name
//     (docs/architecture.md §2), so a name is the stable identifier here.
//   * `-2s` two-stage variants are enumerated on the SDM chain only; the PCM
//     chain carries none. That is why the `old-school` and `damage-control`
//     cases split by chain, and why `perfect-ten` is pinned as the control that
//     carries the SAME plain name on all four keys under "auto" — without it, a
//     module that appended `-2s` to every SDM value would pass every other
//     case in this file.
//
// Deliberately NOT asserted: the `PRESETS` export's membership, ordering and
// emoji. That is a curated display list and its order is the owner's to change
// (rule 9); what a preset MEANS is pinned through `writeSet`, which is the
// observable half.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easy.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { writeSet, matchPreset } from "../../../hqptuner/static/store/easy.js";

const PCM_1X = "pcm_filter_1x";
const PCM_NX = "pcm_filter_nx";
const SDM_1X = "sdm_filter_1x";
const SDM_NX = "sdm_filter_nx";

/** The PCM pair, both keys carrying one name (the album grid's shape). */
function pcmBoth(/** @type {string} */ name) {
  return { [PCM_1X]: name, [PCM_NX]: name };
}

/** The SDM pair, both keys carrying one name. */
function sdmBoth(/** @type {string} */ name) {
  return { [SDM_1X]: name, [SDM_NX]: name };
}

// --- behavior 1: the output mode selects which chain(s) get written ------------------
//
// Keys only, sorted — the values are every other section's business. A mode
// writing a key belonging to the other chain is the failure this catches, in
// both directions.

/** @type {[("pcm" | "sdm" | "auto"), string[]][]} */
const MODE_KEYS = [
  ["pcm", [PCM_1X, PCM_NX]],
  ["sdm", [SDM_1X, SDM_NX]],
  ["auto", [PCM_1X, PCM_NX, SDM_1X, SDM_NX]],
];

/** @type {("album" | "playlist")[]} */
const GRIDS = ["album", "playlist"];

for (const [mode, keys] of MODE_KEYS) {
  for (const grid of GRIDS) {
    test(`test_the_${mode}_output_mode_writes_only_its_own_chain_keys_in_the_${grid}_grid`, () => {
      assert.deepEqual(Object.keys(writeSet(grid, "perfect-ten", mode)).sort(), keys);
    });
  }
}

// --- behaviors 2 and 5: the album grid writes one filter to both ends of a chain ------
//
// Each case calls with NO knobs argument, so it pins two things at once that
// cannot be separated by an observation: the default knob positions produce the
// preset's headline filter, and that one name lands on the chain's 1x key and
// its Nx key alike.
//
// `old-school` and `damage-control` are read here on the PCM chain, where the
// plain name lives; their SDM `-2s` flavor is behavior 4, below.

/** @type {[string, string][]} */
const ALBUM_HEADLINE_PCM = [
  ["perfect-ten", "poly-sinc-gauss-long"],
  ["hires", "poly-sinc-gauss-hires-lp"],
  ["lifelike", "poly-sinc-ext2-long"],
  ["old-school", "poly-sinc-short-mp"],
  ["purist", "poly-sinc-gauss-halfband"],
  ["damage-control", "poly-sinc-xtr-short-lp"],
  ["concert-hall", "poly-sinc-gauss-xla"],
];

for (const [presetId, name] of ALBUM_HEADLINE_PCM) {
  test(`test_the_album_preset_${presetId}_writes_its_headline_filter_to_both_ends_of_the_chain`, () => {
    assert.deepEqual(writeSet("album", presetId, "pcm"), pcmBoth(name));
  });
}

// --- behavior 3: the playlist grid writes two distinct filters -------------------------
//
// The whole point of the playlist grid: the 1x key and the Nx key differ.

/** @type {[string, string, string][]} */
const PLAYLIST_PAIRS = [
  ["perfect-ten", "poly-sinc-gauss-long", "poly-sinc-gauss-hires-lp"],
  ["lifelike", "poly-sinc-ext2-long", "poly-sinc-ext2-hires-lp"],
];

for (const [presetId, oneX, nX] of PLAYLIST_PAIRS) {
  test(`test_the_playlist_preset_${presetId}_writes_its_two_distinct_filters_to_the_two_keys`, () => {
    assert.deepEqual(writeSet("playlist", presetId, "pcm"), { [PCM_1X]: oneX, [PCM_NX]: nX });
  });
}

// --- behavior 4: one "auto" call splits the chains for a -2s preset ---------------------

test("test_an_auto_call_writes_the_two_stage_variant_to_sdm_and_the_plain_name_to_pcm", () => {
  assert.deepEqual(writeSet("album", "old-school", "auto"), {
    ...pcmBoth("poly-sinc-short-mp"),
    ...sdmBoth("poly-sinc-short-mp-2s"),
  });
});

test("test_an_auto_call_splits_the_chains_for_damage_control_too", () => {
  assert.deepEqual(writeSet("album", "damage-control", "auto"), {
    ...pcmBoth("poly-sinc-xtr-short-lp"),
    ...sdmBoth("poly-sinc-xtr-short-lp-2s"),
  });
});

test("test_a_preset_with_no_two_stage_variant_writes_the_same_name_to_both_chains", () => {
  // the control: -2s belongs to the presets that define it, not to the SDM chain
  assert.deepEqual(writeSet("album", "perfect-ten", "auto"), {
    ...pcmBoth("poly-sinc-gauss-long"),
    ...sdmBoth("poly-sinc-gauss-long"),
  });
});

test("test_a_non_default_knob_position_carries_into_the_two_stage_sdm_variant", () => {
  assert.deepEqual(writeSet("album", "old-school", "sdm", { emphasis: "space" }), sdmBoth("poly-sinc-short-lp-2s"));
});

// --- the knob positions each preset defines ---------------------------------------------
//
// Every non-default position in the table, read on the PCM chain. A preset whose
// knob moved nothing, or moved to the wrong filter, fails here by name.

/** @type {[string, string, Record<string, string>, string][]} */
const KNOB_CASES = [
  ["perfect-ten", "balanced", { emphasis: "balanced" }, "poly-sinc-gauss-medium"],
  ["perfect-ten", "transients", { emphasis: "transients" }, "poly-sinc-gauss-short"],
  ["hires", "transients", { emphasis: "transients" }, "poly-sinc-gauss-hires-mp"],
  ["lifelike", "balanced", { emphasis: "balanced" }, "poly-sinc-ext2-medium"],
  ["lifelike", "transients", { emphasis: "transients" }, "poly-sinc-ext2-short"],
  ["old-school", "space", { emphasis: "space" }, "poly-sinc-short-lp"],
  ["purist", "transients", { emphasis: "transients" }, "poly-sinc-gauss-halfband-s"],
  ["damage-control", "transients", { emphasis: "transients" }, "poly-sinc-xtr-short-mp"],
  ["concert-hall", "lifelike_on", { version: "lifelike", correction: "on" }, "poly-sinc-ext2-xla"],
  ["concert-hall", "perfect-ten_off", { version: "perfect-ten", correction: "off" }, "poly-sinc-gauss-xl"],
  ["concert-hall", "lifelike_off", { version: "lifelike", correction: "off" }, "poly-sinc-ext2-xl"],
];

for (const [presetId, label, knobs, name] of KNOB_CASES) {
  test(`test_the_album_preset_${presetId}_at_${label}_writes_its_own_filter`, () => {
    assert.deepEqual(writeSet("album", presetId, "pcm", knobs), pcmBoth(name));
  });
}

// --- behavior 6: an undefined knob position falls back to that knob's default ------------
//
// `hires` has no `balanced` position and `concert-hall`'s `version` knob has no
// `purist`, so each of these asks for a position its preset does not define. The
// answer is the knob's default, never a synthesized filter name that the engine
// would not enumerate.

/** @type {[string, string, Record<string, string>, string][]} */
const FALLBACK_CASES = [
  ["hires", "an_emphasis_it_does_not_define", { emphasis: "balanced" }, "poly-sinc-gauss-hires-lp"],
  ["perfect-ten", "a_nonexistent_emphasis", { emphasis: "loudness" }, "poly-sinc-gauss-long"],
  ["concert-hall", "a_nonexistent_version", { version: "purist" }, "poly-sinc-gauss-xla"],
  [
    "concert-hall",
    "a_nonexistent_correction_beside_a_real_version",
    { version: "lifelike", correction: "sometimes" },
    "poly-sinc-ext2-xla",
  ],
];

for (const [presetId, label, knobs, name] of FALLBACK_CASES) {
  test(`test_${presetId}_given_${label}_falls_back_to_the_default_position`, () => {
    assert.deepEqual(writeSet("album", presetId, "pcm", knobs), pcmBoth(name));
  });
}

// --- behavior 7: matchPreset names the preset and knob positions behind the values -------
//
// Round trips, so the values fed to `matchPreset` are exactly what `writeSet`
// produced — the two are one contract read in both directions, and a table of
// hand-written values here would only re-state the sections above.
//
// Every album case passes EVERY knob the preset defines explicitly, so the
// expected knob map is unambiguous. Playlist presets define no knobs, and the
// reading taken here is that their match carries an empty knob map.

/** @type {[string, ("album" | "playlist"), string, ("pcm" | "sdm" | "auto"), Record<string, string>][]} */
const MATCH_CASES = [
  ["album_perfect_ten_on_pcm", "album", "perfect-ten", "pcm", { emphasis: "space" }],
  ["album_lifelike_on_auto", "album", "lifelike", "auto", { emphasis: "transients" }],
  ["album_old_school_on_sdm", "album", "old-school", "sdm", { emphasis: "transients" }],
  ["album_damage_control_on_auto", "album", "damage-control", "auto", { emphasis: "space" }],
  ["album_purist_on_sdm", "album", "purist", "sdm", { emphasis: "transients" }],
  ["album_concert_hall_on_auto", "album", "concert-hall", "auto", { version: "lifelike", correction: "off" }],
  ["playlist_perfect_ten_on_pcm", "playlist", "perfect-ten", "pcm", {}],
  ["playlist_lifelike_on_auto", "playlist", "lifelike", "auto", {}],
];

for (const [label, grid, presetId, mode, knobs] of MATCH_CASES) {
  test(`test_matchpreset_recovers_the_${label}_that_wrote_the_values`, () => {
    assert.deepEqual(matchPreset(writeSet(grid, presetId, mode, knobs), mode), { grid, presetId, knobs });
  });
}

test("test_matchpreset_returns_null_for_values_no_preset_writes", () => {
  assert.equal(matchPreset({ [PCM_1X]: "sinc-M", [PCM_NX]: "sinc-M" }, "pcm"), null);
});

test("test_matchpreset_returns_null_when_the_two_ends_of_one_chain_belong_to_different_presets", () => {
  assert.equal(matchPreset({ [PCM_1X]: "poly-sinc-gauss-long", [PCM_NX]: "poly-sinc-ext2-long" }, "pcm"), null);
});

// --- behavior 8: under "auto" both chains must agree ------------------------------------
//
// Each chain on its own reads as a legitimate preset; together they do not, so
// the whole match is null rather than whichever chain got looked at first.

test("test_matchpreset_returns_null_under_auto_when_the_chains_name_different_presets", () => {
  assert.equal(matchPreset({ ...pcmBoth("poly-sinc-gauss-long"), ...sdmBoth("poly-sinc-ext2-long") }, "auto"), null);
});

test("test_matchpreset_returns_null_under_auto_when_the_chains_name_different_knob_positions", () => {
  assert.equal(matchPreset({ ...pcmBoth("poly-sinc-gauss-long"), ...sdmBoth("poly-sinc-gauss-medium") }, "auto"), null);
});

test("test_matchpreset_returns_null_under_auto_when_only_one_chain_carries_the_two_stage_variant", () => {
  // both halves are old-school, but the PCM chain never enumerates -2s
  assert.equal(matchPreset({ ...pcmBoth("poly-sinc-short-mp-2s"), ...sdmBoth("poly-sinc-short-mp-2s") }, "auto"), null);
});
