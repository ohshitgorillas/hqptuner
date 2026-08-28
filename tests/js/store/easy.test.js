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
//     cases split by chain, and why `perfect-ten` is pinned as the control whose
//     SDM keys carry the same plain names its PCM keys do under "auto" — without
//     it, a module that appended `-2s` to every SDM value would pass every other
//     case in this file.
//
// Deliberately NOT asserted: the preset table itself. Which presets a grid has
// and which positions their knobs define is `presetsFor`'s to say, and the one
// section that walks the whole table asks it rather than restating it — through
// tests/js/support/easytable.js, a pure sweep over `presetsFor` and `writeSet`
// with no fake and no rendering in it. Nothing here asserts that table's
// membership, ordering, emoji or shape. What a preset MEANS is pinned through
// `writeSet` and `matchPreset`, the observable half.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easy.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { writeSet, matchPreset } from "../../../hqptuner/static/store/easy.js";
import { namesWritten } from "../support/easytable.js";

/** The filter names the revision took out of the album table. */
const RETIRED = ["poly-sinc-gauss-short", "poly-sinc-ext2-short"];

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
// One name landing on the chain's 1x key and its Nx key alike, preset by
// preset. Every row NAMES every knob position it reads at, so what each case
// pins is what that combination writes — a resting position is the owner's to
// revisit, and moving one must not break a case whose subject is the shape of
// the write rather than the default.
//
// Where the knobs rest is read once, immediately below the table, and only
// once.
//
// `old-school` and `damage-control` are read here on the PCM chain, where the
// plain name lives; their SDM `-2s` flavor is behavior 4, below.

// `perfect-ten` and `lifelike` are NOT read here. What their Source knob writes
// at each of its positions is `CROSSED_CASES` and
// tests/js/store/easy-source-auto.test.js; which position it RESTS at is one
// case in that file.

/** @type {[string, string, Record<string, string>, string][]} */
const ALBUM_HEADLINE_PCM = [
  ["old-school", "with_emphasis_on_transients", { emphasis: "transients" }, "poly-sinc-short-mp"],
  ["purist", "with_emphasis_on_space", { emphasis: "space" }, "poly-sinc-gauss-halfband"],
  ["damage-control", "with_emphasis_on_space", { emphasis: "space" }, "poly-sinc-xtr-short-lp"],
  [
    "concert-hall",
    "on_the_perfect_ten_version_with_correction_on",
    { version: "perfect-ten", correction: "on" },
    "poly-sinc-gauss-xla",
  ],
];

for (const [presetId, at, knobs, name] of ALBUM_HEADLINE_PCM) {
  test(`test_the_album_preset_${presetId}_${at}_writes_${name}_to_both_ends_of_the_chain`, () => {
    assert.deepEqual(writeSet("album", presetId, "pcm", knobs), pcmBoth(name));
  });
}

// Where the album knobs rest: a call passing no positions at all answers with
// the filter the resting ones name. One preset carries this, because a resting
// position belongs to the knob rather than to a preset — `purist` because it
// carries a single knob, so nothing else can be standing in the answer.

test("test_an_album_preset_called_with_no_knob_positions_writes_the_filter_its_resting_ones_name", () => {
  assert.deepEqual(writeSet("album", "purist", "pcm"), pcmBoth("poly-sinc-gauss-halfband"));
});

// --- behavior 3: the playlist grid writes two distinct filters -------------------------
//
// The whole point of the playlist grid: the 1x key and the Nx key differ. WHICH
// pair each position names is the emphasis table below, every row of it stating
// its position; what is read here is where the knob rests, one case, one
// preset. A per-preset sweep with the position left out would only compose that
// resting position with a pair the table below already pins.

test("test_a_playlist_preset_called_with_no_knob_position_writes_the_pair_its_resting_one_names", () => {
  assert.deepEqual(writeSet("playlist", "perfect-ten", "pcm"), {
    [PCM_1X]: "poly-sinc-gauss-long",
    [PCM_NX]: "poly-sinc-gauss-hires-lp",
  });
});

// --- the playlist grid's emphasis knob --------------------------------------------------
//
// Both playlist presets carry an `emphasis` knob, and the position it stands at
// picks WHICH distinct pair the two keys get — not one filter, the way an album
// preset's knobs do. The owner's table, stated outright: filter names are wire
// identifiers, and deriving them from anything would only ask the table to agree
// with itself.
//
// The `space` rows are the positions the presets sit at untouched, which the
// resting case above reads through a call naming no position at all; stating
// them here is what makes "the DEFAULT pair" and "the pair the `space` POSITION
// names" one claim rather than two that happen to coincide.

/** @type {[string, string, string, string][]} */
const PLAYLIST_EMPHASIS = [
  ["perfect-ten", "space", "poly-sinc-gauss-long", "poly-sinc-gauss-hires-lp"],
  ["perfect-ten", "transients", "poly-sinc-gauss-medium", "poly-sinc-gauss-hires-mp"],
  ["lifelike", "space", "poly-sinc-ext2-long", "poly-sinc-ext2-hires-lp"],
  ["lifelike", "transients", "poly-sinc-ext2-medium", "poly-sinc-ext2-hires-mp"],
];

for (const [presetId, emphasis, oneX, nX] of PLAYLIST_EMPHASIS) {
  test(`test_the_playlist_preset_${presetId}_with_emphasis_on_${emphasis}_writes_${oneX}_and_${nX}`, () => {
    assert.deepEqual(writeSet("playlist", presetId, "pcm", { emphasis }), { [PCM_1X]: oneX, [PCM_NX]: nX });
  });
}

// The same four rows on the SDM keys, so the distinct pair is pinned on that
// chain in its own right: neither playlist preset defines a `-2s` variant, so
// the names are the plain ones, and a module that collapsed the playlist pair to
// a single name on this chain fails here rather than passing because only PCM
// was ever looked at.

for (const [presetId, emphasis, oneX, nX] of PLAYLIST_EMPHASIS) {
  test(`test_the_playlist_preset_${presetId}_on_${emphasis}_writes_its_pair_to_the_two_sdm_keys`, () => {
    assert.deepEqual(writeSet("playlist", presetId, "sdm", { emphasis }), {
      [SDM_1X]: oneX,
      [SDM_NX]: nX,
    });
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

test("test_a_preset_with_no_two_stage_variant_writes_the_same_names_to_both_chains", () => {
  // the control: -2s belongs to the presets that define it, not to the SDM
  // chain. Every knob position is named, so what each chain carries is the pair
  // that Source position writes — the same pair, which is the claim.
  assert.deepEqual(writeSet("album", "perfect-ten", "auto", { source: "auto", emphasis: "space" }), {
    [PCM_1X]: "poly-sinc-gauss-long",
    [PCM_NX]: "poly-sinc-gauss-hires-lp",
    [SDM_1X]: "poly-sinc-gauss-long",
    [SDM_NX]: "poly-sinc-gauss-hires-lp",
  });
});

test("test_a_non_default_knob_position_carries_into_the_two_stage_sdm_variant", () => {
  assert.deepEqual(writeSet("album", "old-school", "sdm", { emphasis: "space" }), sdmBoth("poly-sinc-short-lp-2s"));
});

// --- the two knobs the combined presets cross -------------------------------------------
//
// `perfect-ten` and `lifelike` each carry two knobs, and the pair is CROSSED:
// `source` picks which family of filters is in play and `emphasis` picks
// between the two that family offers, so the table is four filters per preset
// rather than two knobs read independently. All four combinations of each are
// stated, defaults included — the default pair is not left implicit here, since
// a module that ignored a knob it was handed would otherwise pass by landing on
// the headline filter the section above already reads.
//
// Read on the PCM chain, where the plain names live; neither preset defines a
// `-2s` variant, which the "auto" control below pins separately.

/** @type {[string, string, string, string][]} */
const CROSSED_CASES = [
  ["perfect-ten", "standard", "space", "poly-sinc-gauss-long"],
  ["perfect-ten", "standard", "transients", "poly-sinc-gauss-medium"],
  ["perfect-ten", "hires", "space", "poly-sinc-gauss-hires-lp"],
  ["perfect-ten", "hires", "transients", "poly-sinc-gauss-hires-mp"],
  ["lifelike", "standard", "space", "poly-sinc-ext2-long"],
  ["lifelike", "standard", "transients", "poly-sinc-ext2-medium"],
  ["lifelike", "hires", "space", "poly-sinc-ext2-hires-lp"],
  ["lifelike", "hires", "transients", "poly-sinc-ext2-hires-mp"],
];

for (const [presetId, source, emphasis, name] of CROSSED_CASES) {
  test(`test_the_album_preset_${presetId}_on_a_${source}_source_with_emphasis_on_${emphasis}_writes_${name}`, () => {
    assert.deepEqual(writeSet("album", presetId, "pcm", { source, emphasis }), pcmBoth(name));
  });
}

// --- the knob positions each preset defines ---------------------------------------------
//
// Every non-default position the one-knob presets define, plus `concert-hall`'s
// two, read on the PCM chain. A preset whose knob moved nothing, or moved to the
// wrong filter, fails here by name.

/** @type {[string, string, Record<string, string>, string][]} */
const KNOB_CASES = [
  [
    "old-school",
    "old_school_with_emphasis_on_space_writes_the_short_lp_filter",
    { emphasis: "space" },
    "poly-sinc-short-lp",
  ],
  [
    "purist",
    "purist_with_emphasis_on_transients_writes_the_halfband_s_filter",
    { emphasis: "transients" },
    "poly-sinc-gauss-halfband-s",
  ],
  [
    "damage-control",
    "damage_control_with_emphasis_on_transients_writes_the_xtr_short_mp_filter",
    { emphasis: "transients" },
    "poly-sinc-xtr-short-mp",
  ],
  [
    "concert-hall",
    "concert_hall_on_the_lifelike_version_with_correction_on_writes_the_ext2_xla_filter",
    { version: "lifelike", correction: "on" },
    "poly-sinc-ext2-xla",
  ],
  [
    "concert-hall",
    "concert_hall_on_the_perfect_ten_version_with_correction_off_writes_the_gauss_xl_variant",
    { version: "perfect-ten", correction: "off" },
    "poly-sinc-gauss-xl",
  ],
  [
    "concert-hall",
    "concert_hall_on_the_lifelike_version_with_correction_off_writes_the_ext2_xl_variant",
    { version: "lifelike", correction: "off" },
    "poly-sinc-ext2-xl",
  ],
];

for (const [presetId, behavior, knobs, name] of KNOB_CASES) {
  test(`test_the_album_preset_${behavior}`, () => {
    assert.deepEqual(writeSet("album", presetId, "pcm", knobs), pcmBoth(name));
  });
}

// --- behavior 6: an undefined knob position falls back to that knob's default ------------
//
// `concert-hall`'s `version` knob has no `purist` and no knob anywhere defines
// `balanced` any more, so each of these asks for a position its preset does not
// define. The answer is the knob's default, never a synthesized filter name that
// the engine would not enumerate — which is also what a stale caller still
// holding a retired position gets.

// A row names every knob its preset carries EXCEPT the one whose fallback it is
// about, so the only position left to the module's own defaults is the one the
// case is reading. Where the knob falling back is the SOURCE knob, the default
// it falls back to is what the row is for and the expectation is that knob's
// pair rather than one name on both keys.

/** @type {[string, string, Record<string, string>, Record<string, string>][]} */
const FALLBACK_CASES = [
  [
    "lifelike",
    "the_retired_balanced_emphasis",
    { source: "standard", emphasis: "balanced" },
    pcmBoth("poly-sinc-ext2-long"),
  ],
  [
    "perfect-ten",
    "a_nonexistent_emphasis",
    { source: "standard", emphasis: "loudness" },
    pcmBoth("poly-sinc-gauss-long"),
  ],
  [
    "perfect-ten",
    "a_nonexistent_source_beside_a_real_emphasis",
    { source: "vinyl", emphasis: "transients" },
    { [PCM_1X]: "poly-sinc-gauss-medium", [PCM_NX]: "poly-sinc-gauss-hires-mp" },
  ],
  [
    "lifelike",
    "a_real_source_beside_a_nonexistent_emphasis",
    { source: "hires", emphasis: "loudness" },
    pcmBoth("poly-sinc-ext2-hires-lp"),
  ],
  ["concert-hall", "a_nonexistent_version", { version: "purist" }, pcmBoth("poly-sinc-gauss-xla")],
  [
    "concert-hall",
    "a_nonexistent_correction_beside_a_real_version",
    { version: "lifelike", correction: "sometimes" },
    pcmBoth("poly-sinc-ext2-xla"),
  ],
];

for (const [presetId, label, knobs, expected] of FALLBACK_CASES) {
  test(`test_${presetId}_given_${label}_falls_back_to_the_default_position`, () => {
    assert.deepEqual(writeSet("album", presetId, "pcm", knobs), expected);
  });
}

// --- behavior 7: matchPreset names the preset and knob positions behind the values -------
//
// Round trips, so the values fed to `matchPreset` are exactly what `writeSet`
// produced — the two are one contract read in both directions, and a table of
// hand-written values here would only re-state the sections above.
//
// Every case passes EVERY knob its preset defines explicitly, so the expected
// knob map is unambiguous. That now includes the playlist presets, which carry
// an `emphasis` knob apiece: a match against a playlist pair names the position
// that pair belongs to, which is what puts a playlist tile's knob where the
// fields say it stands.

/** @type {[string, ("album" | "playlist"), string, ("pcm" | "sdm" | "auto"), Record<string, string>][]} */
const MATCH_CASES = [
  ["album_perfect_ten_on_pcm", "album", "perfect-ten", "pcm", { source: "standard", emphasis: "space" }],
  ["album_lifelike_on_auto", "album", "lifelike", "auto", { source: "hires", emphasis: "transients" }],
  ["album_old_school_on_sdm", "album", "old-school", "sdm", { emphasis: "transients" }],
  ["album_damage_control_on_auto", "album", "damage-control", "auto", { emphasis: "space" }],
  ["album_purist_on_sdm", "album", "purist", "sdm", { emphasis: "transients" }],
  ["album_concert_hall_on_auto", "album", "concert-hall", "auto", { version: "lifelike", correction: "off" }],
  ["playlist_perfect_ten_on_pcm_with_emphasis_on_space", "playlist", "perfect-ten", "pcm", { emphasis: "space" }],
  [
    "playlist_perfect_ten_on_pcm_with_emphasis_on_transients",
    "playlist",
    "perfect-ten",
    "pcm",
    { emphasis: "transients" },
  ],
  ["playlist_lifelike_on_auto", "playlist", "lifelike", "auto", { emphasis: "transients" }],
];

// The grid is passed as the caller's preference, uniformly across the table. It
// is a tie-break and most of these rows have no tie to break, but the ones that
// do — an album pair and a playlist pair are the same four values — would
// otherwise be answered for a caller that never said which grid it is showing.
// Which grid answers a caller that leans is
// tests/js/store/easy-source-auto.test.js's; what is read here is the round trip.

for (const [label, grid, presetId, mode, knobs] of MATCH_CASES) {
  test(`test_matchpreset_recovers_the_${label}_that_wrote_the_values`, () => {
    assert.deepEqual(matchPreset(writeSet(grid, presetId, mode, knobs), mode, grid), { grid, presetId, knobs });
  });
}

test("test_matchpreset_returns_null_for_values_no_preset_writes", () => {
  assert.equal(matchPreset({ [PCM_1X]: "sinc-M", [PCM_NX]: "sinc-M" }, "pcm"), null);
});

// The two filters the revision retired from the album table, read twice over.
//
// First backwards, through `matchPreset`: a name no preset writes is a name
// nothing matches, so a preset still able to reach either one answers with
// itself here.

for (const name of RETIRED) {
  test(`test_matchpreset_names_no_preset_for_the_retired_${name}_filter`, () => {
    assert.equal(matchPreset(pcmBoth(name), "pcm"), null);
  });
}

// Then forwards, over the album table swept whole — every preset at every
// combination of the positions its knobs define, which is the reading that
// covers a filter reachable only from some corner of the cross. Filter names
// are wire identifiers, so this is a fact about the table and not about any
// word a tile shows.
//
// The vocabulary the sweep produces is pinned non-empty in its own right,
// immediately below. Without that, a table that produced no names at all would
// satisfy the case above by filtering an empty list to an empty list.

const swept = () => namesWritten("album");

test("test_no_album_preset_writes_a_retired_short_filter_at_any_knob_combination", () => {
  assert.deepEqual(
    swept().filter((name) => RETIRED.includes(name)),
    [],
  );
});

test("test_the_album_table_writes_a_vocabulary_of_filter_names_to_sweep", () => {
  assert.notEqual(swept().length, 0);
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
