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

import { engineStatus, enums } from "../../hqptuner/static/store/signals.js";
import { initHealth, engineAlerts, trackCounters, outputBufferApplies } from "../../hqptuner/static/store/health.js";

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
// A real output-buffer underrun is transient by design — the buffer drains to 0,
// playback skips for an instant, then refills to 100% — never a sustained low.
// So there is no sustained-low "starvation" alert; a flat low/zero/-1 reading
// just means the buffer does not apply to this output (SDM/DSD direct paths).

test("test_a_sustained_low_output_buffer_raises_no_alert", () => {
  reset();
  assert.deepEqual(repeat(SUSTAIN + 1, { output_fill: "0.02" }), []);
});

test("test_a_flat_zero_output_buffer_raises_no_alert", () => {
  reset();
  assert.deepEqual(repeat(SUSTAIN + 1, { output_fill: "0" }), []);
});

test("test_a_negative_buffer_reading_raises_no_alert", () => {
  // -1 is the daemon's "buffer doesn't apply" sentinel
  reset();
  assert.deepEqual(repeat(SUSTAIN + 1, { output_fill: "-1" }), []);
});

test("test_output_buffer_does_not_apply_until_a_positive_fill_is_seen", () => {
  serial += 1;
  poll({ output_fill: "0" }); // fresh track, buffer flat at zero
  assert.equal(outputBufferApplies.value, false);
});

test("test_output_buffer_applies_once_a_positive_fill_is_seen", () => {
  serial += 1;
  poll({ output_fill: "0" });
  poll({ output_fill: "0.5" }); // buffer populates → applies
  assert.equal(outputBufferApplies.value, true);
});

// --- clipping counters ------------------------------------------------------

test("test_clipping_within_a_track_alerts_on_the_delta", () => {
  reset({ clips: "10" });
  assert.ok(texts(poll({ clips: "23" })).includes("×13 this track"));
});

test("test_a_new_track_rebaselines_the_clip_counter", () => {
  reset({ clips: "10" });
  poll({ clips: "23" });
  reset({ clips: "23" });
  assert.deepEqual(poll({ clips: "23" }), []);
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

// The alert fires only once the per-track delta reaches APOD_MIN; anything
// below that is silent even on a non-apodizing filter. Counts used by the
// "never flagged" cases are deliberately at or above the threshold, so they
// would fire if the filter's apodizing-ness were misread.
const APOD_MIN = 10;

test("test_apodizing_events_alert_when_the_active_filter_is_not_apodizing", () => {
  enums.value = { filters: [{ name: "plain-filter", arg: 0, desc: "3/5 timbre ⥮ 1:1" }] };
  reset({ apod: "0", active_filter: "plain-filter" });
  assert.equal(
    texts(poll({ apod: String(APOD_MIN), active_filter: "plain-filter" })),
    "Apodizing events ×10 this track, but plain-filter is non-apodizing — consider an apodizing filter.",
  );
});

test("test_an_apodizing_alert_is_a_warning", () => {
  enums.value = { filters: [{ name: "plain-filter", arg: 0, desc: "3/5 timbre ⥮ 1:1" }] };
  reset({ apod: "0", active_filter: "plain-filter" });
  assert.deepEqual(sevs(poll({ apod: String(APOD_MIN), active_filter: "plain-filter" })), ["warn"]);
});

for (const count of [1, 4, 6, 9]) {
  test(`test_an_apodizing_delta_below_the_threshold_is_silent: ${count}`, () => {
    enums.value = { filters: [{ name: "plain-filter", arg: 0, desc: "3/5 timbre ⥮ 1:1" }] };
    reset({ apod: "0", active_filter: "plain-filter" });
    assert.deepEqual(poll({ apod: String(count), active_filter: "plain-filter" }), []);
  });
}

test("test_an_apodizing_delta_above_the_threshold_still_alerts", () => {
  enums.value = { filters: [{ name: "plain-filter", arg: 0, desc: "3/5 timbre ⥮ 1:1" }] };
  reset({ apod: "0", active_filter: "plain-filter" });
  assert.ok(texts(poll({ apod: "12", active_filter: "plain-filter" })).includes("×12 this track"));
});

test("test_the_apodizing_alert_counts_the_track_delta_not_the_total", () => {
  enums.value = { filters: [{ name: "plain-filter", arg: 0, desc: "3/5 timbre ⥮ 1:1" }] };
  reset({ apod: "100", active_filter: "plain-filter" });
  assert.ok(texts(poll({ apod: "111", active_filter: "plain-filter" })).includes("×11 this track"));
});

test("test_the_apodizing_alert_accrues_across_polls_within_one_track", () => {
  // no single poll steps by APOD_MIN; only the per-track total reaches it
  enums.value = { filters: [{ name: "plain-filter", arg: 0, desc: "3/5 timbre ⥮ 1:1" }] };
  reset({ apod: "0", active_filter: "plain-filter" });
  poll({ apod: "4", active_filter: "plain-filter" });
  poll({ apod: "8", active_filter: "plain-filter" });
  assert.ok(texts(poll({ apod: "12", active_filter: "plain-filter" })).includes("×12 this track"));
});

test("test_a_new_track_rebaselines_the_apodizing_counter", () => {
  enums.value = { filters: [{ name: "plain-filter", arg: 0, desc: "3/5 timbre ⥮ 1:1" }] };
  reset({ apod: "0", active_filter: "plain-filter" });
  poll({ apod: "9", active_filter: "plain-filter" });
  reset({ apod: "9", active_filter: "plain-filter" });
  assert.deepEqual(poll({ apod: "9", active_filter: "plain-filter" }), []);
});

test("test_apodizing_events_are_not_flagged_on_an_apodizing_filter", () => {
  // the backend derives `apodizing` from arg bit 0 (metadata.py) and ships it as
  // a field; only ½-apodizing is read off the raw arg client-side
  enums.value = { filters: [{ name: "apod-filter", apodizing: true, desc: "5/5 timbre ⥮ 1:1" }] };
  reset({ apod: "0", active_filter: "apod-filter" });
  assert.deepEqual(poll({ apod: "20", active_filter: "apod-filter" }), []);
});

test("test_apodizing_events_are_not_flagged_on_a_half_apodizing_filter", () => {
  enums.value = { filters: [{ name: "half-filter", arg: 2, desc: "4/5 timbre ⥮ 1:1" }] };
  reset({ apod: "0", active_filter: "half-filter" });
  assert.deepEqual(poll({ apod: "20", active_filter: "half-filter" }), []);
});

test("test_apodizing_events_are_not_flagged_on_an_unknown_filter", () => {
  enums.value = { filters: [] };
  reset({ apod: "0", active_filter: "mystery" });
  assert.deepEqual(poll({ apod: "20", active_filter: "mystery" }), []);
});

test("test_apodizing_events_are_not_flagged_while_the_engine_is_idle", () => {
  enums.value = { filters: [{ name: "plain-filter", arg: 0, desc: "3/5 timbre ⥮ 1:1" }] };
  reset({ apod: "0", active_filter: "plain-filter" });
  assert.deepEqual(poll({ state: "0", apod: "20", active_filter: "plain-filter" }), []);
});

// --- ordering and combination -----------------------------------------------

test("test_a_sustained_low_buffer_adds_nothing_to_a_speed_alert", () => {
  // regression (item 12): the buffer no longer contributes an alert of its own
  reset();
  assert.deepEqual(sevs(repeat(SUSTAIN, { process_speed: "0.5", output_fill: "0.02" })), ["crit"]);
});

test("test_independent_faults_are_reported_together", () => {
  reset({ clips: "0" });
  assert.equal(repeat(SUSTAIN, { process_speed: "0.5", clips: "12" }).length, 2);
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
