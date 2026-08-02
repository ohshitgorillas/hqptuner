// Behavioral suite for scripts/eqlab/target.js — the composing half of target
// resolution: `points` read from a measurement file, `despike` outlier
// rejection, and the `difference` composer. Written blind from a spec block:
// no eqlab source was read. Test numbers in comments refer to the spec
// block's behaviour list.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/eqlab/eqlab-target-compose.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveTarget } from "../../../scripts/eqlab/target.js";
import { valueAt } from "../../../scripts/eqlab/metrics.js";
import { FS, near, above, below, band, curve } from "../support/eqlab-helpers.js";

const FLAT = curve([]);
const mean = (xs) => xs.reduce((acc, v) => acc + v, 0) / xs.length;

let fixtureSeq = 0;
const fixture = (text) => {
  fixtureSeq += 1;
  const path = join(tmpdir(), `eqlab-target-compose-${process.pid}-${fixtureSeq}.txt`);
  writeFileSync(path, text);
  return path;
};

// --- A. points from a file ---------------------------------------------------

const FILE_PAIRS = [
  [100, 0],
  [1000, 6],
  [10000, 3],
];
const twoColumn = () => FILE_PAIRS.map(([f, d]) => `${f} ${d}`).join("\n") + "\n";

// 1 — 316.23 Hz is the log midpoint of 100 and 1000, so this probes the
// interpolated stretch between two file points, not a node value.
test("test_fr_text_file_points_resolve_like_the_same_inline_points", async () => {
  const path = fixture(twoColumn());
  const fromFile = await resolveTarget({ from: "points", path, format: "fr_text", align: "none" }, FLAT, FS);
  const inline = await resolveTarget({ from: "points", points: FILE_PAIRS, align: "none" }, FLAT, FS);
  assert.ok(...near(valueAt(fromFile.curve, 316.23), valueAt(inline.curve, 316.23), 0.02));
});

// 1 — 3162.28 Hz is the log midpoint of 1000 and 10000: a probe on the far
// side of the middle point, which a parser that dropped the last line of the
// file would answer with the 6 dB clamp instead.
test("test_fr_text_file_points_resolve_like_inline_points_above_1_khz", async () => {
  const path = fixture(twoColumn());
  const fromFile = await resolveTarget({ from: "points", path, format: "fr_text", align: "none" }, FLAT, FS);
  const inline = await resolveTarget({ from: "points", points: FILE_PAIRS, align: "none" }, FLAT, FS);
  assert.ok(...near(valueAt(fromFile.curve, 3162.28), valueAt(inline.curve, 3162.28), 0.02));
});

const threeColumn = () => FILE_PAIRS.map(([f, d], i) => `${f} ${d} ${-30 * (i + 1)}`).join("\n") + "\n";

// 2
test("test_fr_text_file_ignores_columns_beyond_the_first_two", async () => {
  const three = fixture(threeColumn());
  const two = fixture(twoColumn());
  const wide = await resolveTarget({ from: "points", path: three, format: "fr_text", align: "none" }, FLAT, FS);
  const narrow = await resolveTarget({ from: "points", path: two, format: "fr_text", align: "none" }, FLAT, FS);
  assert.ok(...near(valueAt(wide.curve, 316.23), valueAt(narrow.curve, 316.23), 0.02));
});

// 2 — probed above 1 kHz as well, so a parser that consumed the third column
// and lost the last point cannot pass on the low half alone.
test("test_fr_text_file_with_a_third_column_matches_the_two_column_file_above_1_khz", async () => {
  const three = fixture(threeColumn());
  const two = fixture(twoColumn());
  const wide = await resolveTarget({ from: "points", path: three, format: "fr_text", align: "none" }, FLAT, FS);
  const narrow = await resolveTarget({ from: "points", path: two, format: "fr_text", align: "none" }, FLAT, FS);
  assert.ok(...near(valueAt(wide.curve, 3162.28), valueAt(narrow.curve, 3162.28), 0.02));
});

// 3 — the fixture carries all three kinds: a `Freq dB` header and a
// `* comment` line, which are non-blank and unparseable and so count, and a
// blank line, which is ignored entirely. Counting the blank would report 3.
test("test_fr_text_file_reports_the_count_of_non_numeric_lines_skipped", async () => {
  const path = fixture(`Freq dB\n\n* comment\n100 0\n1000 6\n10000 3\n`);
  const t = await resolveTarget({ from: "points", path, format: "fr_text", align: "none" }, FLAT, FS);
  assert.match(t.meta.detail, /2 non-numeric line/);
});

// 3 — skipping is not failing: the surviving numeric lines still resolve.
test("test_fr_text_file_with_header_and_comment_lines_still_parses_its_points", async () => {
  const path = fixture(`Freq dB\n\n* comment\n100 0\n1000 6\n10000 3\n`);
  const t = await resolveTarget({ from: "points", path, format: "fr_text", align: "none" }, FLAT, FS);
  assert.ok(...near(valueAt(t.curve, 316.23), 3, 0.05));
});

// 4
test("test_points_file_detail_names_the_file_path", async () => {
  const path = fixture(twoColumn());
  const t = await resolveTarget({ from: "points", path, format: "fr_text", align: "none" }, FLAT, FS);
  assert.ok(t.meta.detail.includes(path), `expected detail to name ${path}, got ${t.meta.detail}`);
});

// 4
test("test_points_file_detail_reports_the_number_of_points_parsed", async () => {
  const path = fixture(`100 0\n200 1\n400 2\n800 3\n1600 4\n`);
  const t = await resolveTarget({ from: "points", path, format: "fr_text", align: "none" }, FLAT, FS);
  assert.match(t.meta.detail, /\b5 points\b/);
});

// 5
test("test_points_file_with_fewer_than_two_points_is_rejected_naming_the_path", async () => {
  const path = fixture(`100 0\n`);
  await assert.rejects(
    () => resolveTarget({ from: "points", path, format: "fr_text", align: "none" }, FLAT, FS),
    (e) => e.message.includes(path),
  );
});

// 6
test("test_points_file_without_a_format_is_rejected_naming_the_accepted_format", async () => {
  const path = fixture(twoColumn());
  await assert.rejects(() => resolveTarget({ from: "points", path, align: "none" }, FLAT, FS), /fr_text/);
});

// 6
test("test_points_file_with_an_unknown_format_is_rejected_naming_the_accepted_format", async () => {
  const path = fixture(twoColumn());
  await assert.rejects(
    () => resolveTarget({ from: "points", path, format: "vibes", align: "none" }, FLAT, FS),
    /fr_text/,
  );
});

// 7
test("test_points_spec_carrying_both_a_path_and_inline_points_is_rejected", async () => {
  const path = fixture(twoColumn());
  await assert.rejects(
    () => resolveTarget({ from: "points", path, format: "fr_text", points: FILE_PAIRS, align: "none" }, FLAT, FS),
    (e) => /path/.test(e.message) && /points/.test(e.message),
  );
});

// --- B. despike --------------------------------------------------------------

// Fifteen round third-octave-ish frequencies; index 10 is 1000 Hz.
const FREQS = [100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500];
const pts = (dbs) => FREQS.map((f, i) => [f, dbs[i]]);
const FLAT_DBS = FREQS.map(() => 0);
const SLOPED_DBS = FREQS.map((_, i) => i * 0.5);

const withSpike = (dbs, index, delta) => dbs.map((d, i) => (i === index ? d + delta : d));

// 8 — despike applies to an inline points list, not only to a file source. On
// the sloped fixture the post-drop reading is 5 dB, which neither the -20 dB
// dropout nor an ignored points list could produce.
test("test_despike_drops_a_spike_in_an_inline_points_list", async () => {
  const spec = {
    from: "points",
    points: pts(withSpike(SLOPED_DBS, 10, -20)),
    despike: {},
    align: "none",
  };
  const t = await resolveTarget(spec, FLAT, FS);
  assert.ok(...near(valueAt(t.curve, 1000), 5, 0.2));
});

// 9 — on a gently sloped list the dropped point's frequency reads the value
// interpolated from its neighbours (4.5 dB at 800 Hz, 5.5 dB at 1250 Hz;
// 1000 Hz is their log midpoint), not the +20 dB spike and not zero.
test("test_despike_leaves_a_dropped_spike_following_its_neighbours", async () => {
  const spec = {
    from: "points",
    points: pts(withSpike(SLOPED_DBS, 10, 20)),
    despike: {},
    align: "none",
  };
  const t = await resolveTarget(spec, FLAT, FS);
  assert.ok(...near(valueAt(t.curve, 1000), 5, 0.2));
});

// 10 — three consecutive bad points (630/800/1000 Hz) all read -20. At the
// default 7-wide window each bad point still sees four good neighbours, so all
// three go; at a 5-wide window the middle one would see a bad majority and
// survive, which is exactly what this case is here to catch.
test("test_despike_drops_a_three_point_cluster_at_the_default_window", async () => {
  const clustered = FLAT_DBS.map((d, i) => (i >= 8 && i <= 10 ? -20 : d));
  const spec = { from: "points", points: pts(clustered), despike: {}, align: "none" };
  const t = await resolveTarget(spec, FLAT, FS);
  assert.ok(...near(valueAt(t.curve, 800), 0, 0.05));
});

// 10 — the whole stretch, not just its middle, follows the surrounding points.
test("test_despike_clears_the_whole_cluster_stretch", async () => {
  const clustered = FLAT_DBS.map((d, i) => (i >= 8 && i <= 10 ? -20 : d));
  const spec = { from: "points", points: pts(clustered), despike: {}, align: "none" };
  const t = await resolveTarget(spec, FLAT, FS);
  assert.ok(...near(valueAt(t.curve, 630), 0, 0.05));
});

// 11 — a clean monotone run of 4 dB per step is steep but has no outliers;
// index 9 (800 Hz) carries +8 dB and must survive untouched.
test("test_despike_preserves_a_steep_but_clean_monotone_run", async () => {
  const steep = FREQS.map((_, i) => (i - 7) * 4);
  const spec = { from: "points", points: pts(steep), despike: {}, align: "none" };
  const t = await resolveTarget(spec, FLAT, FS);
  assert.ok(...near(valueAt(t.curve, 800), 8, 0.1));
});

// B (contract) — rejection needs BOTH clauses. Index 7 (500 Hz) reads +8 dB
// inside a deliberately noisy window (indices 4..10 are -10,-5,0,+8,0,+5,+10):
// the window median is 0 and its median absolute deviation is 5 dB, so three
// robust sigma is about 22 dB. The point is 8 dB out — past the default 3 dB
// threshold but nowhere near 22 — so it stays, reading its own +8 rather than
// the 0 dB its neighbours would interpolate across a drop.
const NOISY_DBS = [5, -10, 10, -5, -10, -5, 0, 8, 0, 5, 10, -5, 10, -10, 5];

test("test_a_point_past_the_threshold_but_inside_three_sigma_survives", async () => {
  const spec = { from: "points", points: pts(NOISY_DBS), despike: {}, align: "none" };
  const t = await resolveTarget(spec, FLAT, FS);
  assert.ok(...above(valueAt(t.curve, 500), 5));
});

// B (contract) — the mirror case. A perfectly clean window has a median
// absolute deviation of zero, so three robust sigma is zero and any deviation
// at all beats it; the 2 dB bump at 500 Hz survives only because it is inside
// the default 3 dB threshold. Dropped, 500 Hz would read 0 dB.
test("test_a_point_past_three_sigma_but_inside_the_threshold_survives", async () => {
  const spec = { from: "points", points: pts(withSpike(FLAT_DBS, 7, 2)), despike: {}, align: "none" };
  const t = await resolveTarget(spec, FLAT, FS);
  assert.ok(...above(valueAt(t.curve, 500), 1));
});

// 15/16 — the caller's threshold_db is honoured, not a hardcoded 3. The same
// 8 dB bump goes at threshold_db 3 and stays at threshold_db 12.
test("test_an_explicit_threshold_db_rejects_a_point_deviating_more_than_it", async () => {
  const points = pts(withSpike(FLAT_DBS, 7, 8));
  const spec = { from: "points", points, despike: { threshold_db: 3 }, align: "none" };
  const t = await resolveTarget(spec, FLAT, FS);
  assert.ok(...below(valueAt(t.curve, 500), 1));
});

// 15/16
test("test_an_explicit_threshold_db_keeps_a_point_deviating_less_than_it", async () => {
  const points = pts(withSpike(FLAT_DBS, 7, 8));
  const spec = { from: "points", points, despike: { threshold_db: 12 }, align: "none" };
  const t = await resolveTarget(spec, FLAT, FS);
  assert.ok(...above(valueAt(t.curve, 500), 6));
});

// 15 — the caller's window is honoured, and this is why the default is 7: with
// only five points in view the three bad ones are the majority, the window
// median is -20 dB and the middle bad point no longer looks like an outlier.
test("test_a_five_wide_window_keeps_the_middle_of_a_three_point_cluster", async () => {
  const clustered = FLAT_DBS.map((d, i) => (i >= 8 && i <= 10 ? -20 : d));
  const spec = { from: "points", points: pts(clustered), despike: { window: 5 }, align: "none" };
  const t = await resolveTarget(spec, FLAT, FS);
  assert.ok(...below(valueAt(t.curve, 800), -10));
});

// 8 — despike drives file-backed points the same as inline ones: the -20 dB
// dropout at 1000 Hz goes and the gap closes at its neighbours' 5 dB.
test("test_despike_drops_a_spike_read_from_an_fr_text_file", async () => {
  const path = fixture(
    pts(withSpike(SLOPED_DBS, 10, -20))
      .map(([f, d]) => `${f} ${d}`)
      .join("\n") + "\n",
  );
  const spec = { from: "points", path, format: "fr_text", despike: {}, align: "none" };
  const t = await resolveTarget(spec, FLAT, FS);
  assert.ok(...near(valueAt(t.curve, 1000), 5, 0.2));
});

// 12
test("test_despike_detail_reports_how_many_points_were_rejected", async () => {
  const spec = {
    from: "points",
    points: pts(withSpike(SLOPED_DBS, 10, 20)),
    despike: {},
    align: "none",
  };
  const t = await resolveTarget(spec, FLAT, FS);
  assert.match(t.meta.detail, /\b1\b[^.]*despik|despik[^.]*\b1\b/i);
});

// 12
test("test_despike_detail_names_the_frequency_of_the_rejected_point", async () => {
  const spec = {
    from: "points",
    points: pts(withSpike(SLOPED_DBS, 10, 20)),
    despike: {},
    align: "none",
  };
  const t = await resolveTarget(spec, FLAT, FS);
  assert.match(t.meta.detail, /1000/);
});

// 12 — and only the rejected one: 1600 Hz is clean, so a detail that simply
// listed every input frequency fails here.
test("test_despike_detail_omits_frequencies_it_did_not_reject", async () => {
  const spec = {
    from: "points",
    points: pts(withSpike(SLOPED_DBS, 10, 20)),
    despike: {},
    align: "none",
  };
  const t = await resolveTarget(spec, FLAT, FS);
  assert.ok(!t.meta.detail.includes("1600"), `expected 1600 to be absent, got ${t.meta.detail}`);
});

// 13
test("test_despike_detail_reports_zero_rejected_on_clean_data", async () => {
  const spec = { from: "points", points: pts(SLOPED_DBS), despike: {}, align: "none" };
  const t = await resolveTarget(spec, FLAT, FS);
  assert.match(t.meta.detail, /\b0\b[^.]*despik|despik[^.]*\b0\b/i);
});

// 14 — forty points, a -20 dB dropout every third one from index 3 to index
// 30: ten rejects, so the detail lists eight frequencies and says how many are
// left over. The frequencies are four distinct digits apiece and none is a
// substring of another, so they can be counted in the detail text.
const MANY_BAD = (i) => i >= 3 && i <= 30 && i % 3 === 0;
const MANY = Array.from({ length: 40 }, (_, i) => [1000 + 137 * i, MANY_BAD(i) ? -20 : 0]);
const MANY_REJECTED = MANY.filter((_, i) => MANY_BAD(i)).map(([f]) => String(f));

test("test_despike_detail_summarises_the_overflow_beyond_eight_frequencies", async () => {
  const t = await resolveTarget({ from: "points", points: MANY, despike: {}, align: "none" }, FLAT, FS);
  assert.match(t.meta.detail, /\+2 more/);
});

// 14 — eight listed, not all ten: a detail that named every rejected point and
// still claimed "+2 more" would pass the previous test and fail this one.
test("test_despike_detail_lists_only_the_first_eight_rejected_frequencies", async () => {
  const t = await resolveTarget({ from: "points", points: MANY, despike: {}, align: "none" }, FLAT, FS);
  const listed = MANY_REJECTED.filter((f) => t.meta.detail.includes(f));
  assert.equal(listed.length, 8);
});

// 15
test("test_despike_with_an_even_window_is_rejected_naming_window", async () => {
  const spec = { from: "points", points: pts(FLAT_DBS), despike: { window: 4 }, align: "none" };
  await assert.rejects(() => resolveTarget(spec, FLAT, FS), /window/i);
});

// 15
test("test_despike_with_a_window_below_three_is_rejected_naming_window", async () => {
  const spec = { from: "points", points: pts(FLAT_DBS), despike: { window: 1 }, align: "none" };
  await assert.rejects(() => resolveTarget(spec, FLAT, FS), /window/i);
});

// 16
test("test_despike_with_a_non_positive_threshold_is_rejected_naming_threshold_db", async () => {
  const spec = { from: "points", points: pts(FLAT_DBS), despike: { threshold_db: 0 }, align: "none" };
  await assert.rejects(() => resolveTarget(spec, FLAT, FS), /threshold_db/i);
});

// --- C. difference composer --------------------------------------------------

// A base whose mean sits well away from zero, so an implementation that
// mean-aligned each operand to the base would collapse the operands' own
// levels and give a visibly different answer.
const LOUD_BASE = curve([band(1000, 20, 0.7, "hshelf")]);

// 17
test("test_difference_of_two_flat_operands_is_their_arithmetic_difference", async () => {
  const spec = {
    from: "difference",
    a: { from: "flat", db: 6 },
    b: { from: "flat", db: 2 },
    align: "none",
  };
  const t = await resolveTarget(spec, FLAT, FS);
  assert.ok(...near(valueAt(t.curve, 500), 4, 0.02));
});

// 18 — operands default to align "none", so their own levels survive the
// subtraction; mean-aligning both to LOUD_BASE would give 0 dB here.
test("test_difference_operands_default_to_no_alignment", async () => {
  const spec = {
    from: "difference",
    a: { from: "flat", db: 6 },
    b: { from: "flat", db: 2 },
    align: "none",
  };
  const t = await resolveTarget(spec, LOUD_BASE, FS);
  assert.ok(...near(valueAt(t.curve, 500), 4, 0.02));
});

// 19 — `a` is a flat 0 dB curve explicitly mean-aligned to the base, so it
// sits at the base's mean; `b` stays at 0 dB and the difference reads it back.
test("test_an_explicit_align_inside_an_operand_is_honoured", async () => {
  const spec = {
    from: "difference",
    a: { from: "flat", db: 0, align: "mean" },
    b: { from: "flat", db: 0, align: "none" },
    align: "none",
  };
  const t = await resolveTarget(spec, LOUD_BASE, FS);
  assert.ok(...near(valueAt(t.curve, 500), mean(LOUD_BASE.db), 0.05));
});

// 20 — `b` tilts +6 dB/octave about 1 kHz, so one octave up it reads 6 dB and
// the difference is -6 dB there rather than the 0 dB it reads at the pivot.
test("test_an_operands_own_transforms_apply_before_the_subtraction", async () => {
  const spec = {
    from: "difference",
    a: { from: "flat", db: 0 },
    b: { from: "flat", db: 0, tilt: { db_per_octave: 6, pivot: 1000 } },
    align: "none",
  };
  const t = await resolveTarget(spec, FLAT, FS);
  assert.ok(...near(valueAt(t.curve, 2000), -6, 0.1));
});

// 21 — constant difference of 4 dB, enclosing tilt of +6 dB/octave about
// 1 kHz: one octave up reads 10 dB.
test("test_the_enclosing_specs_transforms_apply_on_top_of_the_difference", async () => {
  const spec = {
    from: "difference",
    a: { from: "flat", db: 6 },
    b: { from: "flat", db: 2 },
    tilt: { db_per_octave: 6, pivot: 1000 },
    align: "none",
  };
  const t = await resolveTarget(spec, FLAT, FS);
  assert.ok(...near(valueAt(t.curve, 2000), 10, 0.1));
});

// 22 — (10 - 3) - 2 = 5.
test("test_a_difference_operand_may_itself_be_a_difference", async () => {
  const spec = {
    from: "difference",
    a: {
      from: "difference",
      a: { from: "flat", db: 10 },
      b: { from: "flat", db: 3 },
    },
    b: { from: "flat", db: 2 },
    align: "none",
  };
  const t = await resolveTarget(spec, FLAT, FS);
  assert.ok(...near(valueAt(t.curve, 500), 5, 0.02));
});

// 23 — the message must say WHICH key is missing, so this case and the next
// can tell each other's failures apart. A bare `a` would also match the
// English article, and a message merely listing both keys would satisfy both
// tests, so the assertion is on the missing key in that role.
test("test_a_difference_missing_its_a_operand_is_rejected_naming_a", async () => {
  const spec = { from: "difference", b: { from: "flat", db: 2 }, align: "none" };
  await assert.rejects(() => resolveTarget(spec, FLAT, FS), /missing ["'`]a["'`]/);
});

// 23
test("test_a_difference_missing_its_b_operand_is_rejected_naming_b", async () => {
  const spec = { from: "difference", a: { from: "flat", db: 6 }, align: "none" };
  await assert.rejects(() => resolveTarget(spec, FLAT, FS), /missing ["'`]b["'`]/);
});

const MIXED_DIFFERENCE = {
  from: "difference",
  a: { from: "flat", db: 6 },
  b: { from: "points", points: FILE_PAIRS },
  align: "none",
};

// 24
test("test_difference_detail_describes_its_a_operand", async () => {
  const t = await resolveTarget(MIXED_DIFFERENCE, FLAT, FS);
  assert.match(t.meta.detail, /flat/);
});

// 24
test("test_difference_detail_describes_its_b_operand", async () => {
  const t = await resolveTarget(MIXED_DIFFERENCE, FLAT, FS);
  assert.match(t.meta.detail, /points/);
});

// 25
test("test_an_unknown_source_is_rejected_listing_difference_among_the_valid_sources", async () => {
  await assert.rejects(() => resolveTarget({ from: "vibes" }, FLAT, FS), /difference/);
});
