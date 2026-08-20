// Behavioral suite for store/apodhistory.js — the per-track history of
// apodizing-event counts behind the Engine Health card's density strip, its
// auto-hide flag, and the window slice.
//
// The seam is the same one store/health.js is driven through
// (tests/js/store/health.test.js): a poll is a FRESH object written to
// engineStatus, carrying the daemon's own Status fields (state, track_serial,
// apod; `state` values per docs/protocol.md — 0 stopped, 1 paused, 2 playing,
// 3 stop requested). remain_min/remain_sec appear only in the cases pinning that
// they are NEVER read. Nothing of HQPTuner's is stubbed — the
// poll cadence is moved by writing the signals the app itself writes (activeTab,
// liveMode, quickSystemUpdates) and read back through store/ui.js's fastPollMs.
//
// Four hazards, all inherited from that seam:
//
//   1. Module state persists for the life of the file and there is no reset
//      export. Every case below starts a fresh track of its own, and the
//      visibility cases set their own precondition explicitly rather than
//      inheriting one — the strip's flag survives a track change by design,
//      so file order is load-bearing for the "not visible yet" case only,
//      which is why it runs before any non-zero count is ever fed.
//   2. Writing the SAME object reference to engineStatus does not notify, so
//      every simulated poll must be a fresh object.
//   3. The poll cadence is shared module state too: every case that appends a
//      bin sets the cadence it wants at its own head, so no case depends on
//      what the one before it left behind.
//   4. initApodHistory() must be called exactly once; its idempotence is
//      pinned at the foot of the file, because a second registration would
//      append two bins per poll. The disposer case runs LAST, deliberately:
//      it tears the effect down and nothing after it would record anything.
//
// setApodWindow() is called here without installing the storage fake from
// tests/js/support/storage.js, and that is deliberate rather than an oversight:
// this process has no localStorage at all, which is prefs.js's storage-disabled
// path — it warns once at import and every setter still moves its signal in
// memory (pinned by tests/js/store/prefs.test.js). Persistence itself is not
// this file's subject; it is pinned in tests/js/store/apodwindow-*.test.js,
// which do install the fake.
//
// No wall clock anywhere and no reliance on the daemon's position/length: the
// window arithmetic below is computed from the cadences the store itself
// reports, which are the same numbers a bin is specified to record.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/apodhistory.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { liveMode, setApodWindow } from "../../../hqptuner/static/store/prefs.js";
import {
  initApodHistory,
  apodBins,
  apodStripVisible,
  apodVisibleBins,
} from "../../../hqptuner/static/store/apodhistory.js";
import { STOPPED, PAUSED, readCadences, setApodCounter, poll, newTrack, append, feed } from "../support/apodpolls.js";

const CAP = 3600;

// The two cadences the app itself produces, read rather than assumed
// (tests/js/store/polling.test.js pins where each comes from).
const { live: LIVE_CADENCE, base: CADENCE } = readCadences();

// The mixed-cadence case below can only tell cadence-aware slicing from
// count-based slicing if the two cadences differ. Guard rather than assert, so a
// store change that collapsed them fails loudly instead of quietly passing.
if (LIVE_CADENCE === CADENCE) {
  throw new Error(`the LIVE and default cadences are both ${CADENCE}ms; this suite needs them to differ`);
}

initApodHistory();

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
  liveMode.value = false;
  newTrack();
  assert.deepEqual(apodBins.value, []);
});

test("test_a_silent_poll_appends_a_zero_bin", () => {
  liveMode.value = false;
  const deltas = feed([0]);
  assert.deepEqual(counts(apodBins.value), deltas);
});

test("test_the_strip_is_not_visible_before_any_apodizing_event", () => {
  liveMode.value = false;
  feed([0, 0, 0]);
  assert.equal(apodStripVisible.value, false);
});

// --- what a bin counts ---------------------------------------------------------

test("test_a_bin_records_the_rise_in_the_apodizing_counter_since_the_previous_poll", () => {
  liveMode.value = false;
  const deltas = feed([3]);
  assert.deepEqual(counts(apodBins.value), deltas);
});

test("test_a_bin_carries_its_count_as_a_number", () => {
  // the phase-2 renderer reads these fields, so their types are contract
  liveMode.value = false;
  feed([3]);
  assert.equal(typeof apodBins.value[0].n, "number");
});

test("test_a_bin_carries_its_cadence_as_a_number", () => {
  liveMode.value = false;
  feed([3]);
  assert.equal(typeof apodBins.value[0].ms, "number");
});

test("test_each_poll_appends_one_bin_of_its_own", () => {
  liveMode.value = false;
  const deltas = feed([3, 0, 7]);
  assert.deepEqual(counts(apodBins.value), deltas);
});

test("test_a_counter_that_goes_backwards_records_zero", () => {
  liveMode.value = false;
  setApodCounter(500); // the baseline this track is established on
  newTrack();
  setApodCounter(480);
  poll();
  assert.deepEqual(counts(apodBins.value), [0]);
});

test("test_a_track_change_clears_the_bins", () => {
  liveMode.value = false;
  feed([1, 2]);
  newTrack();
  assert.deepEqual(apodBins.value, []);
});

test("test_a_track_change_rebaselines_the_counter", () => {
  // the counter does not move across the change, so the first bin of the new
  // track is a zero rather than the whole running total
  liveMode.value = false;
  feed([4, 4]);
  newTrack();
  poll();
  assert.deepEqual(counts(apodBins.value), [0]);
});

// --- nothing is recorded unless the engine is playing --------------------------
// Each case feeds a real history first, so a store that never appends at all
// cannot pass by leaving the array empty.

test("test_a_stopped_poll_appends_no_bin_to_a_history_already_running", () => {
  liveMode.value = false;
  const deltas = feed([1, 2]);
  append([20], { state: STOPPED });
  assert.deepEqual(counts(apodBins.value), deltas);
});

test("test_a_paused_poll_appends_no_bin_to_a_history_already_running", () => {
  liveMode.value = false;
  const deltas = feed([1, 2]);
  append([20], { state: PAUSED });
  assert.deepEqual(counts(apodBins.value), deltas);
});

// --- the cadence a bin carries ---------------------------------------------------

test("test_a_bin_appended_in_live_mode_records_the_live_cadence", () => {
  liveMode.value = true;
  feed([1]);
  assert.deepEqual(cadences(apodBins.value), [LIVE_CADENCE]);
});

test("test_a_bin_appended_off_the_fast_lane_records_the_cadence_then_in_force", () => {
  liveMode.value = false;
  feed([1]);
  assert.deepEqual(cadences(apodBins.value), [CADENCE]);
});

test("test_a_bin_keeps_the_cadence_it_was_appended_at_when_the_cadence_later_changes", () => {
  liveMode.value = true;
  feed([1]);
  liveMode.value = false;
  append([1]);
  assert.deepEqual(cadences(apodBins.value), [LIVE_CADENCE, CADENCE]);
});

// --- the auto-hide flag -----------------------------------------------------------

test("test_the_strip_becomes_visible_once_a_non_zero_bin_is_appended", () => {
  liveMode.value = false;
  feed([0, 2]);
  assert.equal(apodStripVisible.value, true);
});

test("test_the_strip_stays_visible_across_a_track_change_while_playback_continues", () => {
  liveMode.value = false;
  feed([3]);
  newTrack();
  assert.equal(apodStripVisible.value, true);
});

test("test_the_strip_is_not_visible_once_the_engine_stops", () => {
  liveMode.value = false;
  feed([3]);
  poll({ state: STOPPED });
  assert.equal(apodStripVisible.value, false);
});

test("test_the_strip_is_not_visible_once_the_engine_pauses", () => {
  liveMode.value = false;
  feed([3]);
  poll({ state: PAUSED });
  assert.equal(apodStripVisible.value, false);
});

// What survives a track change is decided by the OUTGOING track's own bins and
// by nothing else. The daemon's remain_min/remain_sec are never consulted: they
// go negative on any stream of unknown length (a live capture reports
// length "0.0" with remain_min "-55", remain_sec "-41"), so a rule reading them
// would hide the strip at random on exactly the material that apodizes most.
// The cases below therefore pin the counted-events rule, and pin that those two
// fields move nothing whatever value they carry.

test("test_a_track_change_from_a_silent_track_hides_the_strip", () => {
  liveMode.value = false;
  feed([3]);
  feed([0, 0]);
  newTrack();
  assert.equal(apodStripVisible.value, false);
});

test("test_a_track_change_from_a_track_that_counted_events_early_keeps_the_strip", () => {
  // the events came at the head of the outgoing track and nothing followed: it
  // is whether the track counted ANY event that decides, not what its last bin
  // happened to be
  liveMode.value = false;
  feed([3, 0, 0]);
  newTrack();
  assert.equal(apodStripVisible.value, true);
});

test("test_negative_remain_fields_leave_a_silent_track_hidden", () => {
  // the shape a stream of unknown length reports, which a remain-based rule
  // would read as "not finished" and wrongly keep on screen
  liveMode.value = false;
  feed([3]);
  feed([0, 0], { remain_min: "-55", remain_sec: "-41" });
  newTrack();
  assert.equal(apodStripVisible.value, false);
});

test("test_remain_fields_reading_zero_leave_a_silent_track_hidden", () => {
  liveMode.value = false;
  feed([3]);
  feed([0, 0], { remain_min: "0", remain_sec: "0" });
  newTrack();
  assert.equal(apodStripVisible.value, false);
});

test("test_remain_fields_reading_zero_do_not_hide_a_track_that_counted_events", () => {
  liveMode.value = false;
  feed([2, 3], { remain_min: "0", remain_sec: "0" });
  newTrack();
  assert.equal(apodStripVisible.value, true);
});

test("test_junk_remain_fields_do_not_hide_a_track_that_counted_events", () => {
  liveMode.value = false;
  feed([2, 3], { remain_min: "nonsense", remain_sec: "" });
  newTrack();
  assert.equal(apodStripVisible.value, true);
});

// --- the window slice ---------------------------------------------------------------
// The slice keeps the newest bins whose recorded cadences sum to no more than
// the window. Where every bin carries the same cadence, how many fit is plain
// division; the mixed case below is the one that tells that apart from a slice
// of a fixed number of bins.

for (const seconds of [30, 60, 120, 300]) {
  test(`test_the_window_keeps_the_bins_whose_recorded_cadences_fit_it: ${seconds}s`, () => {
    liveMode.value = false;
    setApodWindow(String(seconds));
    const fits = Math.floor((seconds * 1000) / CADENCE);
    feed(series(fits + 20, () => 1));
    assert.equal(apodVisibleBins.value.length, fits);
  });
}

test("test_the_window_slice_is_the_newest_bins_ordered_oldest_first", () => {
  liveMode.value = false;
  setApodWindow("30");
  const fits = Math.floor(30000 / CADENCE);
  const deltas = feed(series(fits + 5, (i) => (i % 7) + 1));
  assert.deepEqual(counts(apodVisibleBins.value), deltas.slice(-fits));
});

test("test_the_window_spends_each_bins_own_cadence_when_the_rate_changed_mid_track", () => {
  // One track, two rates: an older stretch at the default cadence and a newer
  // stretch in LIVE. The window is spent newest-first — the LIVE bins are cheap,
  // so more of them fit than the count a single-cadence reading would allow, and
  // the cut lands INSIDE the older stretch. Any implementation that slices by a
  // fixed number of bins, or that reads one cadence for the whole array, lands
  // somewhere else.
  liveMode.value = false;
  setApodWindow("30");
  const fast = 10;
  const slowFits = Math.floor((30000 - fast * LIVE_CADENCE) / CADENCE);
  const older = feed(series(slowFits + 15, (i) => (i % 5) + 1));
  liveMode.value = true;
  const newer = append(series(fast, (i) => (i % 3) + 1));
  assert.deepEqual(counts(apodVisibleBins.value), [...older, ...newer].slice(-(slowFits + fast)));
});

test("test_a_history_shorter_than_the_window_is_shown_whole", () => {
  liveMode.value = false;
  setApodWindow("300");
  const deltas = feed([1, 0, 2, 3]);
  assert.deepEqual(counts(apodVisibleBins.value), deltas);
});

test("test_the_all_window_shows_every_retained_bin_of_the_track", () => {
  liveMode.value = false;
  setApodWindow("all");
  // longer than the longest fixed window, at any cadence the store reports
  const deltas = feed(series(Math.floor(300000 / CADENCE) + 50, (i) => i % 3));
  assert.deepEqual(counts(apodVisibleBins.value), deltas);
});

// --- the retention cap ---------------------------------------------------------------

test("test_the_history_is_capped_at_thirty_six_hundred_bins", () => {
  liveMode.value = false;
  feed([9, ...series(CAP, () => 0)]); // one bin past the cap
  assert.equal(apodBins.value.length, CAP);
});

test("test_the_oldest_bin_is_dropped_once_the_cap_is_passed", () => {
  // only the first bin of this track carries a 9; past the cap it is gone
  liveMode.value = false;
  feed([9, ...series(CAP, () => 0)]);
  assert.equal(anyBinCounting(apodBins.value, 9), false);
});

// --- registration -----------------------------------------------------------------------

test("test_registering_the_history_twice_does_not_append_two_bins_per_poll", () => {
  liveMode.value = false;
  initApodHistory();
  const deltas = feed([2]);
  assert.deepEqual(counts(apodBins.value), deltas);
});

test("test_registering_the_history_twice_returns_the_same_disposer", () => {
  assert.equal(initApodHistory(), initApodHistory());
});

// LAST in the file, deliberately (hazard 4): the effect is gone afterwards.

test("test_the_disposer_stops_bins_being_appended", () => {
  liveMode.value = false;
  feed([1, 1]);
  const before = apodBins.value.length;
  initApodHistory()(); // the registration's own disposer
  append([1]);
  assert.equal(apodBins.value.length, before);
});
