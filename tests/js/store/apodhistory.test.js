// Behavioral suite for store/apodhistory.js — the per-track history of
// apodizing-event counts behind the Engine Health card's density strip, its
// auto-hide flag, and the window slice.
//
// The seam is the same one store/health.js is driven through
// (tests/js/store/health.test.js): a poll is a FRESH object written to
// engineStatus, carrying the daemon's own Status fields (state, track_serial,
// apod, remain_min, remain_sec). Nothing of HQPTuner's is stubbed — the poll
// cadence is moved by writing the signals the app itself writes (activeTab,
// liveMode, quickSystemUpdates) and read back through store/ui.js's fastPollMs.
//
// Three hazards, all inherited from that seam:
//
//   1. Module state persists for the life of the file and there is no reset
//      export. Every case below starts a fresh track of its own, and the
//      visibility cases set their own precondition explicitly rather than
//      inheriting one — the strip's flag survives a track change by design,
//      so file order is load-bearing for the "not visible yet" case only,
//      which is why it runs before any non-zero count is ever fed.
//   2. Writing the SAME object reference to engineStatus does not notify, so
//      every simulated poll must be a fresh object.
//   3. initApodHistory() must be called exactly once; its idempotence is
//      pinned at the foot of the file, because a second registration would
//      append two bins per poll.
//
// No wall clock anywhere and no reliance on the daemon's position/length: the
// window arithmetic below is computed from the cadence the store itself
// reports, which is the same number a bin is specified to record.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/apodhistory.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { engineStatus } from "../../../hqptuner/static/store/signals.js";
import { activeTab, fastPollMs } from "../../../hqptuner/static/store/ui.js";
import { liveMode, quickSystemUpdates, setApodWindow } from "../../../hqptuner/static/store/prefs.js";
import {
  initApodHistory,
  apodBins,
  apodStripVisible,
  apodVisibleBins,
} from "../../../hqptuner/static/store/apodhistory.js";

const PLAYING = "2";
const IDLE = "0";
const CAP = 3600;

// The page the app shows here has no fast rule and no opt-in, so the cadence is
// the store's default one; read rather than assumed (tests/js/store/polling.test.js
// pins where the value comes from).
activeTab.value = "output";
liveMode.value = false;
quickSystemUpdates.value = false;

initApodHistory();

const CADENCE = fastPollMs.value;

let serial = 0;
let counter = 0; // the daemon's own monotonic apodizing counter

/**
 * One poll. Always a fresh object — see hazard 2.
 *
 * @param {Record<string, unknown>} [fields]
 */
function poll(fields = {}) {
  engineStatus.value = {
    status: { state: PLAYING, track_serial: String(serial), apod: String(counter), ...fields },
  };
}

/** @param {Record<string, unknown>} [fields] */
function newTrack(fields = {}) {
  serial += 1;
  poll(fields);
}

/**
 * A fresh track, then one poll per delta — so `deltas` is exactly the sequence
 * of per-bin counts the store should have recorded, oldest first.
 *
 * @param {number[]} deltas
 * @param {Record<string, unknown>} [fields]
 * @returns {number[]}
 */
function feed(deltas, fields = {}) {
  newTrack(fields);
  for (const d of deltas) {
    counter += d;
    poll(fields);
  }
  return deltas;
}

/** @typedef {{ ms: number, n: number }} Bin */

/** @param {Bin[]} bins */
const counts = (bins) => bins.map((b) => b.n);

/** @param {Bin[]} bins */
const cadences = (bins) => bins.map((b) => b.ms);

/**
 * @param {Bin[]} bins
 * @param {number} n
 * @returns {boolean}
 */
const anyBinCounting = (bins, n) => bins.some((b) => b.n === n);

/**
 * @param {number} length
 * @param {(i: number) => number} f
 */
const series = (length, f) => Array.from({ length }, (_, i) => f(i));

// --- nothing recorded before the first apodizing event ------------------------
// These run first, before any non-zero count has ever been fed, because the
// strip's visibility is sticky by design.

test("test_the_first_poll_of_a_track_appends_no_bin", () => {
  newTrack();
  assert.deepEqual(apodBins.value, []);
});

test("test_no_bin_is_appended_while_the_engine_is_not_playing", () => {
  newTrack();
  counter += 20;
  poll({ state: IDLE });
  assert.deepEqual(apodBins.value, []);
});

test("test_a_silent_poll_appends_a_zero_bin", () => {
  const deltas = feed([0]);
  assert.deepEqual(counts(apodBins.value), deltas);
});

test("test_the_strip_is_not_visible_before_any_apodizing_event", () => {
  feed([0, 0, 0]);
  assert.equal(apodStripVisible.value, false);
});

// --- what a bin counts ---------------------------------------------------------

test("test_a_bin_records_the_rise_in_the_apodizing_counter_since_the_previous_poll", () => {
  const deltas = feed([3]);
  assert.deepEqual(counts(apodBins.value), deltas);
});

test("test_each_poll_appends_one_bin_of_its_own", () => {
  const deltas = feed([3, 0, 7]);
  assert.deepEqual(counts(apodBins.value), deltas);
});

test("test_a_counter_that_goes_backwards_records_zero", () => {
  counter = 500; // the baseline this track is established on
  newTrack();
  counter = 480;
  poll();
  assert.deepEqual(counts(apodBins.value), [0]);
});

test("test_a_track_change_clears_the_bins", () => {
  feed([1, 2]);
  newTrack();
  assert.deepEqual(apodBins.value, []);
});

test("test_a_track_change_rebaselines_the_counter", () => {
  // the counter does not move across the change, so the first bin of the new
  // track is a zero rather than the whole running total
  feed([4, 4]);
  newTrack();
  poll();
  assert.deepEqual(counts(apodBins.value), [0]);
});

// --- the cadence a bin carries ---------------------------------------------------
// LIVE polls every second with no opt-in of any kind (tests/js/store/polling.test.js).

test("test_a_bin_appended_in_live_mode_records_the_one_second_cadence", () => {
  liveMode.value = true;
  feed([1]);
  assert.deepEqual(cadences(apodBins.value), [1000]);
});

test("test_a_bin_keeps_the_cadence_it_was_appended_at_when_the_cadence_later_changes", () => {
  liveMode.value = true;
  feed([1]);
  liveMode.value = false;
  counter += 1;
  poll();
  assert.notEqual(apodBins.value[0].ms, apodBins.value[1].ms);
});

test("test_a_bin_appended_off_the_fast_lane_records_the_cadence_then_in_force", () => {
  liveMode.value = false;
  feed([1]);
  assert.deepEqual(cadences(apodBins.value), [CADENCE]);
});

// --- the auto-hide flag -----------------------------------------------------------

test("test_the_strip_becomes_visible_once_a_non_zero_bin_is_appended", () => {
  feed([0, 2]);
  assert.equal(apodStripVisible.value, true);
});

test("test_the_strip_stays_visible_across_a_track_change_while_playback_continues", () => {
  feed([3]);
  newTrack();
  assert.equal(apodStripVisible.value, true);
});

test("test_the_strip_is_not_visible_once_the_engine_stops_playing", () => {
  feed([3]);
  poll({ state: IDLE });
  assert.equal(apodStripVisible.value, false);
});

test("test_a_silent_track_that_played_out_to_the_end_hides_the_strip", () => {
  feed([3]);
  feed([0, 0], { remain_min: "0", remain_sec: "0" });
  newTrack();
  assert.equal(apodStripVisible.value, false);
});

test("test_a_silent_track_left_before_its_end_keeps_the_strip", () => {
  feed([3]);
  feed([0, 0], { remain_min: "0", remain_sec: "30" });
  newTrack();
  assert.equal(apodStripVisible.value, true);
});

// --- the window slice ---------------------------------------------------------------
// The slice keeps the newest bins whose recorded cadences sum to no more than
// the window; every bin here is appended at the same cadence, so how many fit is
// plain division.

for (const seconds of [30, 60, 120, 300]) {
  test(`test_the_window_keeps_the_bins_whose_recorded_cadences_fit_it: ${seconds}s`, () => {
    setApodWindow(String(seconds));
    const fits = Math.floor((seconds * 1000) / CADENCE);
    feed(series(fits + 20, () => 1));
    assert.equal(apodVisibleBins.value.length, fits);
  });
}

test("test_the_window_slice_is_the_newest_bins_ordered_oldest_first", () => {
  setApodWindow("30");
  const fits = Math.floor(30000 / CADENCE);
  const deltas = feed(series(fits + 5, (i) => (i % 7) + 1));
  assert.deepEqual(counts(apodVisibleBins.value), deltas.slice(-fits));
});

test("test_a_history_shorter_than_the_window_is_shown_whole", () => {
  setApodWindow("300");
  const deltas = feed([1, 0, 2, 3]);
  assert.deepEqual(counts(apodVisibleBins.value), deltas);
});

test("test_the_all_window_shows_every_retained_bin_of_the_track", () => {
  setApodWindow("all");
  // longer than the longest fixed window, at any cadence the store reports
  const deltas = feed(series(Math.floor(300000 / CADENCE) + 50, (i) => i % 3));
  assert.deepEqual(counts(apodVisibleBins.value), deltas);
});

// --- the retention cap ---------------------------------------------------------------

test("test_the_history_is_capped_at_thirty_six_hundred_bins", () => {
  feed([9, ...series(CAP, () => 0)]); // one bin past the cap
  assert.equal(apodBins.value.length, CAP);
});

test("test_the_oldest_bin_is_dropped_once_the_cap_is_passed", () => {
  // only the first bin of this track carries a 9; past the cap it is gone
  feed([9, ...series(CAP, () => 0)]);
  assert.equal(anyBinCounting(apodBins.value, 9), false);
});

// --- registration -----------------------------------------------------------------------

test("test_registering_the_history_twice_does_not_append_two_bins_per_poll", () => {
  initApodHistory();
  const deltas = feed([2]);
  assert.deepEqual(counts(apodBins.value), deltas);
});

test("test_registering_the_history_twice_returns_the_same_disposer", () => {
  assert.equal(initApodHistory(), initApodHistory());
});
