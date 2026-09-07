// Behavioral suite for components/AlertStrip.js — the engine-health warning
// row under the signal-path bar. Healthy means ZERO pixels: the component
// returns null unless store/health.js derives at least one alert.
//
// Policy (docs/testing.md): public API only, one assertion per test. The strip
// is a pure function of the exported `engineAlerts` computed, which derives
// from the exported `engineStatus` signal — so both branches (a rendered list,
// and nothing at all) are reachable by assigning status frames the test owns.
// The alert DERIVATION itself (streak sustain, rebaselining, thresholds) is
// tests/js/health.test.js's contract, not re-proven here: this suite drives it
// only far enough to put an alert on screen (a clip delta needs one frame and
// no initHealth() effect — the counter baseline starts at zero).
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/alertstrip.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { AlertStrip } from "../../../../hqptuner/static/components/AlertStrip.js";
import { engineStatus, health } from "../../../../hqptuner/static/store/signals.js";
import { presetPickFailure } from "../../../../hqptuner/static/store/alerts/presetpick.js";

// One status frame — always a fresh object (writing the same reference to a
// signal does not notify), then the rendered strip.
/** @param {Record<string, string> | null} status */
function strip(status) {
  engineStatus.value = status === null ? null : { status };
  return render(html`<${AlertStrip} />`);
}

const PLAYING = { state: "2", track_serial: "1", process_speed: "1.5" };

// The KINDS of alert on screen, read off the `data-alert` each row carries —
// the alert's own machine identity, contract like any other wire-side marking,
// so a reworded sentence changes nothing here (docs/testing.md rule 9).
/** @param {string} out */
const alertKinds = (out) => [...out.matchAll(/data-alert="([^"]*)"/g)].map((m) => m[1]);

test("test_a_missing_status_frame_renders_no_strip", () => {
  assert.equal(strip(null), "");
});

test("test_a_healthy_playing_engine_renders_no_strip", () => {
  assert.equal(strip({ ...PLAYING, clips: "0" }), "");
});

test("test_an_idle_engine_renders_no_strip_even_with_leftover_counters", () => {
  assert.equal(strip({ state: "0", track_serial: "1", clips: "7" }), "");
});

test("test_a_clipping_track_puts_its_alert_on_screen", () => {
  assert.deepEqual(alertKinds(strip({ ...PLAYING, clips: "13" })), ["clipping"]);
});

test("test_a_clip_alert_renders_at_warning_severity", () => {
  assert.ok(strip({ ...PLAYING, clips: "13" }).includes('class="alert alert-warn"'));
});

test("test_the_alert_list_renders_inside_the_strip_row", () => {
  assert.ok(strip({ ...PLAYING, clips: "13" }).includes('class="alert-strip"'));
});

// A refused management credential is not a playback fault: the 8088 configuration
// lane is dead while the 4321 control lane answers normally, so the app looks
// connected and an install in this state is typically sitting idle. The row
// therefore has to render with NO status frame at all — the state every other
// alert in this strip is silent in — which is what these cases pin.
/** @param {boolean | null} credentialsOk */
function idleStrip(credentialsOk) {
  engineStatus.value = null;
  health.value = { reachable: true, credentials_ok: credentialsOk };
  return render(html`<${AlertStrip} />`);
}

/** @type {[boolean, string[]][]} */
const CREDENTIAL_CASES = [
  [false, ["credentials-rejected"]],
  [true, []],
];

for (const [credentialsOk, kinds] of CREDENTIAL_CASES) {
  test(`test_an_idle_engine_shows_the_credential_row_when_credentials_ok_is_${credentialsOk}`, () => {
    assert.deepEqual(alertKinds(idleStrip(credentialsOk)), kinds);
  });
}

// A preset pick or delete that failed is reported here, not on the pending
// bar's result line, because LIVE never puts that bar on screen. The strip is
// rendered in the same idle, credentials-accepted state as above, so the only
// row that can appear is the one `presetPickFailure` drives. The reason string
// is the test's own, never asserted; the row's `data-alert` kind is.
/** @param {string | null} reason */
function pickStrip(reason) {
  engineStatus.value = null;
  health.value = { reachable: true, credentials_ok: true };
  presetPickFailure.value = reason;
  return render(html`<${AlertStrip} />`);
}

/** @type {[string | null, string, string[]][]} */
const PRESET_PICK_CASES = [
  ["the daemon refused the profile switch", "failed", ["preset-pick"]],
  [null, "succeeded", []],
];

for (const [reason, outcome, kinds] of PRESET_PICK_CASES) {
  test(`test_an_idle_engine_shows_the_preset_pick_row_only_when_the_last_pick_${outcome}`, () => {
    assert.deepEqual(alertKinds(pickStrip(reason)), kinds);
  });
}
