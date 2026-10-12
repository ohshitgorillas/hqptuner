// Behavioral suite for store/health.js — the engine-health alert derivation.
// Written BEFORE the complexity refactor of its two arrows (21 and 13).
//
// Two hazards this module imposes on any test, both measured rather than
// assumed. Getting them wrong produces a suite that passes alone and fails in
// sequence:
//
//   1. `track` and the slow-speed wait are module-private with no reset export,
//      so state carries across cases. `poll()` below is the only way to start
//      the wait over — one healthy PLAYING frame does it — and a fresh
//      track_serial is the only way to rebaseline the counters. Both are
//      public-API routes.
//   2. Writing the SAME object reference to engineStatus does not notify, so the
//      effect never runs. Every simulated poll must be a fresh object.
//
// The store runs on the suite's fake clock (tests/js/support/clock.js), handed in
// through initHealth, so every "for N ms" below is a reading of that clock and
// never a duration this suite spends.

import test from "node:test";
import assert from "node:assert/strict";

import { engineStatus, enums } from "../../../../hqptuner/static/store/signals.js";
import {
  initHealth,
  engineAlerts,
  trackCounters,
  outputBufferApplies,
} from "../../../../hqptuner/static/store/health.js";
import { fakeClock } from "../../support/clock.js";

const fake = fakeClock();
initHealth(fake.clock);

const PLAYING = "2";
/** How long speed stays below a threshold before its alert fires, in ms on the clock. */
const HOLD_MS = 6000;
/** About how far apart Status frames reach the browser while playing, in ms. */
const CADENCE = 1000;

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

/** @typedef {import("../../../../hqptuner/static/store/health.js").Alert} Alert */

/** @param {Alert[]} alerts */
const sevs = (alerts) => alerts.map((a) => a.sev);
/** @param {Alert[]} alerts */
const kinds = (alerts) => alerts.map((a) => a.kind);
/**
 * Poll `fields` now and once every CADENCE up to `ms` on, the clock moving between polls, and answer the alerts after
 * the last poll.
 *
 * @param {number} ms
 * @param {Record<string, unknown>} fields
 */
const hold = (ms, fields) => {
  let last = poll(fields);
  for (let at = CADENCE; at <= ms; at += CADENCE) {
    fake.advance(CADENCE);
    last = poll(fields);
  }
  return last;
};

// --- quiet by default -------------------------------------------------------

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

// Two frames, and no frame at all when the hold runs out: the warning fires on
// the clock, and a slow frame arriving mid-wait does not start it over.
test("test_a_sustained_slow_speed_warns", () => {
  reset();
  poll({ process_speed: "1.02" });
  fake.advance(HOLD_MS / 2);
  poll({ process_speed: "1.02" });
  fake.advance(HOLD_MS / 2);
  assert.deepEqual(sevs(engineAlerts.value), ["warn"]);
});

test("test_a_sustained_below_realtime_speed_is_critical", () => {
  reset();
  poll({ process_speed: "0.5" });
  fake.advance(HOLD_MS / 2);
  poll({ process_speed: "0.5" });
  fake.advance(HOLD_MS / 2);
  assert.deepEqual(sevs(engineAlerts.value), ["crit"]);
});

test("test_the_critical_threshold_is_exclusive", () => {
  reset();
  assert.deepEqual(sevs(hold(HOLD_MS, { process_speed: "1.00" })), ["warn"]);
});

// --- output buffer ----------------------------------------------------------
// A real output-buffer underrun is transient by design — the buffer drains to 0,
// playback skips for an instant, then refills to 100% — never a sustained low.
// So there is no sustained-low "starvation" alert; a flat low/zero/-1 reading
// just means the buffer does not apply to this output (SDM/DSD direct paths).

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

test("test_clipping_within_a_track_raises_a_clipping_alert", () => {
  reset({ clips: "10" });
  assert.deepEqual(kinds(poll({ clips: "23" })), ["clipping"]);
});

test("test_a_new_track_rebaselines_the_clip_counter", () => {
  reset({ clips: "10" });
  poll({ clips: "23" });
  reset({ clips: "23" });
  assert.deepEqual(poll({ clips: "23" }), []);
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
  assert.deepEqual(kinds(poll({ apod: String(APOD_MIN), active_filter: "plain-filter" })), ["apodizing"]);
});

for (const count of [9]) {
  test(`test_an_apodizing_delta_below_the_threshold_is_silent: ${count}`, () => {
    enums.value = { filters: [{ name: "plain-filter", arg: 0, desc: "3/5 timbre ⥮ 1:1" }] };
    reset({ apod: "0", active_filter: "plain-filter" });
    assert.deepEqual(poll({ apod: String(count), active_filter: "plain-filter" }), []);
  });
}

// The counter the alert reads is the per-track delta, and the total is well past
// the threshold here: a store alerting on the total fires and fails.
test("test_the_apodizing_alert_counts_the_track_delta_not_the_total", () => {
  enums.value = { filters: [{ name: "plain-filter", arg: 0, desc: "3/5 timbre ⥮ 1:1" }] };
  reset({ apod: "100", active_filter: "plain-filter" });
  assert.deepEqual(poll({ apod: "105", active_filter: "plain-filter" }), []);
});

test("test_the_apodizing_alert_accrues_across_polls_within_one_track", () => {
  // no single poll steps by APOD_MIN; only the per-track total reaches it
  enums.value = { filters: [{ name: "plain-filter", arg: 0, desc: "3/5 timbre ⥮ 1:1" }] };
  reset({ apod: "0", active_filter: "plain-filter" });
  poll({ apod: "4", active_filter: "plain-filter" });
  poll({ apod: "8", active_filter: "plain-filter" });
  assert.deepEqual(kinds(poll({ apod: "12", active_filter: "plain-filter" })), ["apodizing"]);
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
