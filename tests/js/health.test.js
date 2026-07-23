// Behavioral suite for store/health.js — the engine-health alert derivation.
// Written BEFORE the complexity refactor of its two arrows (21 and 13).
//
// Three hazards this module imposes on any test, all measured rather than
// assumed. Getting them wrong produces a suite that passes alone and fails in
// sequence:
//
//   1. `track` and `streak` are module-private with no reset export, so state
//      carries across cases. `poll()` below is the only way to zero a streak —
//      one healthy PLAYING frame does it — and a fresh track_serial is the only
//      way to rebaseline the counters. Both are public-API routes.
//   2. Writing the SAME object reference to engineStatus does not notify, so the
//      effect never runs. Every simulated poll must be a fresh object.
//   3. initHealth() must be called exactly once. It is now idempotent, and this
//      suite pins that: a second registration would advance the shared streak
//      twice per poll and fire alerts after 2 polls instead of 3.

import test from "node:test";
import assert from "node:assert/strict";

import { engineStatus, enums } from "../../hqptuner/static/store/state.js";
import { initHealth, engineAlerts, trackCounters } from "../../hqptuner/static/store/health.js";

initHealth();

const PLAYING = "2";
const SUSTAIN = 3;

let serial = 0;

// One poll. Always a fresh object — see hazard 2.
function poll(fields = {}) {
  engineStatus.value = {
    status: { state: PLAYING, track_serial: String(serial), process_speed: "1.5", output_fill: "0.9", ...fields },
  };
  return engineAlerts.value;
}

// Start a case from a known-zero streak and a fresh counter baseline.
function reset(counters = {}) {
  serial += 1;
  poll(counters);
}

const sevs = (alerts) => alerts.map((a) => a.sev);
const texts = (alerts) => alerts.map((a) => a.text).join(" | ");
const repeat = (n, fields) => {
  let last = [];
  for (let i = 0; i < n; i += 1) last = poll(fields);
  return last;
};

// --- quiet by default -------------------------------------------------------

test("test_a_healthy_playing_engine_raises_no_alerts", () => {
  reset();
  assert.deepEqual(poll(), []);
});

test("test_an_absent_status_frame_raises_no_alerts", () => {
  reset();
  engineStatus.value = null;
  assert.deepEqual(engineAlerts.value, []);
});

test("test_an_empty_status_frame_raises_no_alerts", () => {
  reset();
  engineStatus.value = { status: null };
  assert.deepEqual(engineAlerts.value, []);
});

// --- process speed ----------------------------------------------------------

test("test_a_single_slow_poll_does_not_alert", () => {
  reset();
  assert.deepEqual(poll({ process_speed: "1.02" }), []);
});

test("test_a_slow_streak_below_sustain_does_not_alert", () => {
  reset();
  assert.deepEqual(repeat(SUSTAIN - 1, { process_speed: "1.02" }), []);
});

test("test_a_sustained_slow_speed_warns", () => {
  reset();
  assert.deepEqual(sevs(repeat(SUSTAIN, { process_speed: "1.02" })), ["warn"]);
});

test("test_a_sustained_below_realtime_speed_is_critical", () => {
  reset();
  assert.deepEqual(sevs(repeat(SUSTAIN, { process_speed: "0.5" })), ["crit"]);
});

test("test_a_critical_speed_does_not_also_warn", () => {
  reset();
  assert.equal(repeat(SUSTAIN, { process_speed: "0.5" }).length, 1);
});

test("test_the_warn_threshold_is_exclusive", () => {
  reset();
  assert.deepEqual(repeat(SUSTAIN, { process_speed: "1.05" }), []);
});

test("test_the_critical_threshold_is_exclusive", () => {
  reset();
  assert.deepEqual(sevs(repeat(SUSTAIN, { process_speed: "1.00" })), ["warn"]);
});

test("test_one_healthy_poll_clears_a_sustained_alert", () => {
  reset();
  repeat(SUSTAIN, { process_speed: "0.5" });
  assert.deepEqual(poll(), []);
});

test("test_recovery_restarts_the_streak_from_zero", () => {
  reset();
  repeat(SUSTAIN, { process_speed: "0.5" });
  poll();
  assert.deepEqual(repeat(SUSTAIN - 1, { process_speed: "0.5" }), []);
});

test("test_an_idle_engine_does_not_accumulate_a_streak", () => {
  reset();
  for (let i = 0; i < SUSTAIN; i += 1) poll({ state: "0", process_speed: "0.5" });
  assert.deepEqual(poll({ process_speed: "0.5" }), []);
});

for (const bad of ["0", "-1", "abc", ""]) {
  test(`test_an_unusable_process_speed_never_alerts: ${JSON.stringify(bad)}`, () => {
    reset();
    assert.deepEqual(repeat(SUSTAIN + 1, { process_speed: bad }), []);
  });
}

test("test_a_missing_process_speed_never_alerts", () => {
  reset();
  assert.deepEqual(repeat(SUSTAIN + 1, { process_speed: undefined }), []);
});

// --- output buffer ----------------------------------------------------------

test("test_a_sustained_low_output_buffer_warns", () => {
  reset();
  assert.deepEqual(sevs(repeat(SUSTAIN, { output_fill: "0.02" })), ["warn"]);
});

test("test_the_buffer_threshold_is_exclusive", () => {
  reset();
  assert.deepEqual(repeat(SUSTAIN, { output_fill: "0.15" }), []);
});

test("test_a_negative_buffer_reading_means_not_applicable_and_never_alerts", () => {
  // -1 is the daemon's "buffer doesn't apply" sentinel, not starvation
  reset();
  assert.deepEqual(repeat(SUSTAIN + 1, { output_fill: "-1" }), []);
});

test("test_a_starved_buffer_reports_its_percentage", () => {
  reset();
  assert.ok(texts(repeat(SUSTAIN, { output_fill: "0.02" })).includes("at 2%"));
});

// --- clipping counters ------------------------------------------------------

test("test_clipping_within_a_track_alerts_on_the_delta", () => {
  reset({ clips: "10" });
  assert.ok(texts(poll({ clips: "13" })).includes("×3 this track"));
});

test("test_a_new_track_rebaselines_the_clip_counter", () => {
  reset({ clips: "10" });
  poll({ clips: "13" });
  reset({ clips: "13" });
  assert.deepEqual(poll({ clips: "13" }), []);
});

test("test_a_counter_that_goes_backwards_clamps_to_zero", () => {
  reset({ clips: "10" });
  assert.equal(trackCounters.value.clips, 0);
});

test("test_the_track_counter_reports_the_delta_not_the_total", () => {
  reset({ clips: "100" });
  poll({ clips: "104" });
  assert.equal(trackCounters.value.clips, 4);
});

// --- apodizing events -------------------------------------------------------

test("test_apodizing_events_alert_when_the_active_filter_is_not_apodizing", () => {
  enums.value = { filters: [{ name: "plain-filter", arg: 0, desc: "3/5 timbre ⥮ 1:1" }] };
  reset({ apod: "0", active_filter: "plain-filter" });
  assert.ok(texts(poll({ apod: "3", active_filter: "plain-filter" })).includes("non-apodizing"));
});

test("test_apodizing_events_are_not_flagged_on_an_apodizing_filter", () => {
  // the backend derives `apodizing` from arg bit 0 (metadata.py) and ships it as
  // a field; only ½-apodizing is read off the raw arg client-side
  enums.value = { filters: [{ name: "apod-filter", apodizing: true, desc: "5/5 timbre ⥮ 1:1" }] };
  reset({ apod: "0", active_filter: "apod-filter" });
  assert.deepEqual(poll({ apod: "3", active_filter: "apod-filter" }), []);
});

test("test_apodizing_events_are_not_flagged_on_a_half_apodizing_filter", () => {
  enums.value = { filters: [{ name: "half-filter", arg: 2, desc: "4/5 timbre ⥮ 1:1" }] };
  reset({ apod: "0", active_filter: "half-filter" });
  assert.deepEqual(poll({ apod: "3", active_filter: "half-filter" }), []);
});

test("test_apodizing_events_are_not_flagged_on_an_unknown_filter", () => {
  enums.value = { filters: [] };
  reset({ apod: "0", active_filter: "mystery" });
  assert.deepEqual(poll({ apod: "3", active_filter: "mystery" }), []);
});

// --- ordering and combination -----------------------------------------------

test("test_a_critical_speed_is_reported_before_a_starved_buffer", () => {
  reset();
  assert.deepEqual(sevs(repeat(SUSTAIN, { process_speed: "0.5", output_fill: "0.02" })), ["crit", "warn"]);
});

test("test_independent_faults_are_reported_together", () => {
  reset({ clips: "0" });
  assert.equal(repeat(SUSTAIN, { process_speed: "0.5", output_fill: "0.02", clips: "2" }).length, 3);
});

// --- registration -----------------------------------------------------------

test("test_registering_health_twice_does_not_shorten_the_sustain_threshold", () => {
  // a second effect would advance the shared streak twice per poll, firing on
  // the 2nd poll instead of the 3rd
  initHealth();
  reset();
  assert.deepEqual(repeat(SUSTAIN - 1, { process_speed: "0.5" }), []);
});

test("test_registering_health_twice_returns_the_same_disposer", () => {
  assert.equal(initHealth(), initHealth());
});
