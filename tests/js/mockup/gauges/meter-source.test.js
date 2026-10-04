// Behavioral suite for the mockup's meter mock source (mockup/scripts/model/gauges/meter-source.js): the power a
// voice puts at a frequency, the jitter over it, the columns the mock track yields and the spectrum read off one.
//
// Run: node --test tests/js/mockup/gauges/meter-source.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { binLevels, jitter, mockColumn, power } from "../../../../mockup/scripts/model/gauges/meter-source.js";
import { near } from "../../support/near.js";

//: Tolerance for sums the float arithmetic may round in the last place.
const EPS = 1e-9;

// ── Mock signal source ───────────────────────────────────────────────────

//: A source with its content ending at 19.6 kHz and no modulator noise.
const CD = { brick: 19600, dsdNoise: false };
//: The same source with its content running past 30 kHz.
const HIRES = { ...CD, brick: 30000 };
//: The CD source decimated from DSD: modulator noise above 12 kHz.
const DSD = { ...CD, dsdNoise: true };

/** @typedef {{ notes: number[], dyn: number[], hatDb: number, kick: boolean, hat: boolean, env: number }} Voice */

//: One 1 kHz note at full level, nothing else sounding.
/** @type {Voice} */
const NOTE = { notes: [1000], dyn: [0], hatDb: 0, kick: false, hat: false, env: 0 };
//: Silence: no note, no kick, no hat.
/** @type {Voice} */
const QUIET = { notes: [], dyn: [], hatDb: 0, kick: false, hat: false, env: 0 };
//: One 1.5 kHz note, its 13th harmonic at 19.5 kHz.
/** @type {Voice} */
const LOW_NOTE = { ...NOTE, notes: [1500] };

//: Ten columns a second over two rows (1 kHz, 500 Hz) of the CD source.
const SRC = { ...CD, perCol: 0.1, rowHz: [1000, 500] };

/**
 * Indices in [from, to) whose mock column has the flag set.
 *
 * @param {number} from
 * @param {number} to
 * @param {(c: { kick: boolean, hat: boolean, apod: number }) => boolean} pick
 * @returns {number[]}
 */
const columnsWhere = (from, to, pick) =>
  Array.from({ length: to - from }, (_, k) => from + k).filter((i) => pick(mockColumn(i, SRC)));

/**
 * Power in dB.
 *
 * @param {number} p
 */
const dbOf = (p) => 10 * Math.log10(p);

test("test_power_peaks_at_a_sounding_note", () => {
  assert.ok(power(NOTE, 1000, 0, CD) > power(NOTE, 1100, 0, CD));
});

test("test_a_note_adds_power_at_its_harmonics", () => {
  assert.ok(power(NOTE, 3000, 0, CD) > power(QUIET, 3000, 0, CD));
});

test("test_a_note_sounds_no_harmonic_past_97_percent_of_the_brick_wall", () => {
  assert.ok(power(LOW_NOTE, 19500, 0, CD) < power(LOW_NOTE, 19500, 0, HIRES));
});

test("test_content_above_the_brick_wall_falls_away", () => {
  assert.ok(power(QUIET, 21000, 0, CD) < power(QUIET, 21000, 0, HIRES));
});

test("test_a_kick_lifts_the_bass", () => {
  assert.ok(power({ ...QUIET, kick: true }, 60, 0, CD) > power(QUIET, 60, 0, CD));
});

test("test_a_kick_leaves_the_treble_alone", () => {
  assert.equal(power({ ...QUIET, kick: true }, 5000, 0, CD), power(QUIET, 5000, 0, CD));
});

test("test_a_hat_lifts_the_treble", () => {
  assert.ok(power({ ...QUIET, hat: true }, 8000, 0, CD) > power(QUIET, 8000, 0, CD));
});

test("test_dsd_modulator_noise_lifts_the_top_of_the_band", () => {
  assert.ok(power(QUIET, 18000, 0, DSD) > power(QUIET, 18000, 0, CD));
});

test("test_dsd_modulator_noise_leaves_the_bottom_of_the_band_alone", () => {
  assert.equal(power(QUIET, 8000, 0, DSD), power(QUIET, 8000, 0, CD));
});

test("test_the_envelope_scales_power_by_its_db", () => {
  assert.ok(...near(dbOf(power({ ...QUIET, env: 10 }, 4000, 1, CD)) - dbOf(power(QUIET, 4000, 1, CD)), 10, EPS));
});

test("test_the_two_channels_pan_a_note_apart", () => {
  assert.notEqual(power(NOTE, 1000, 0, CD), power(NOTE, 1000, 1, CD));
});

test("test_jitter_is_the_same_for_the_same_column_row_and_channel", () => {
  assert.equal(jitter({ idx: 12 }, 40, 1), jitter({ idx: 12 }, 40, 1));
});

test("test_jitter_differs_between_channels", () => {
  assert.notEqual(jitter({ idx: 12 }, 40, 0), jitter({ idx: 12 }, 40, 1));
});

//: Column, row and channel triples jitter is drawn at.
const JITTER = [
  { idx: 0, row: 0, ch: 0 },
  { idx: 17, row: 300, ch: 1 },
  { idx: 5999, row: 119, ch: 5 },
];

for (const row of JITTER) {
  test(`test_jitter_stays_within_three_db_at_column_${row.idx}_row_${row.row}`, () => {
    assert.ok(Math.abs(dbOf(jitter({ idx: row.idx }, row.row, row.ch))) <= 3);
  });
}

test("test_a_kick_lands_every_fifth_column", () => {
  assert.deepEqual(
    columnsWhere(0, 12, (c) => c.kick),
    [0, 5, 10],
  );
});

test("test_a_hat_lands_two_columns_before_each_kick", () => {
  assert.deepEqual(
    columnsWhere(0, 12, (c) => c.hat),
    [3, 8],
  );
});

test("test_the_chord_holds_for_two_point_four_seconds", () => {
  assert.deepEqual(mockColumn(23, SRC).notes, mockColumn(0, SRC).notes);
});

test("test_the_chord_changes_after_two_point_four_seconds", () => {
  assert.notDeepEqual(mockColumn(24, SRC).notes, mockColumn(0, SRC).notes);
});

test("test_the_chords_cycle_after_four", () => {
  assert.deepEqual(mockColumn(96, SRC).notes, mockColumn(0, SRC).notes);
});

test("test_apodizing_events_cluster_in_the_opening_ninety_columns", () => {
  assert.ok(columnsWhere(0, 90, (c) => c.apod > 0).length > columnsWhere(90, 180, (c) => c.apod > 0).length);
});

test("test_a_column_holds_each_row_for_both_channels_and_their_sum", () => {
  assert.equal(mockColumn(0, SRC).db.length, 6);
});

test("test_a_column_row_is_the_power_at_that_row_with_jitter", () => {
  const c = mockColumn(7, SRC);
  assert.ok(...near(c.db[1], dbOf(power(c, 500, 0, CD) * jitter(c, 1, 0)), 1e-4));
});

test("test_the_sum_row_averages_the_two_channels_power", () => {
  const c = mockColumn(7, SRC);
  assert.ok(...near(c.db[4], dbOf((10 ** (c.db[0] / 10) + 10 ** (c.db[2] / 10)) / 2), 1e-4));
});

test("test_one_channel_spectrum_reads_that_channel", () => {
  assert.notEqual(binLevels(mockColumn(7, SRC), [1000], "0", CD)[0], binLevels(mockColumn(7, SRC), [1000], "1", CD)[0]);
});

test("test_the_sum_spectrum_lies_between_the_two_channels", () => {
  const c = mockColumn(7, SRC);
  const [l, r, sum] = ["0", "1", "sum"].map((ch) => binLevels(c, [1000], ch, CD)[0]);
  assert.ok((sum - l) * (sum - r) < 0);
});
