// Behavioral suite for the junk-filter advice chip: store/alerts/junkadvice.js's
// `junkAdvice` computed plus its rendering inside components/AlertStrip.js.
//
// The /api/status payload's `data` object carries a `junk` key — null, or an
// advice object {filter, reason, ceiling_khz} from the backend spectral
// advisor. The frontend surfaces it as a TEXT-ONLY chip in the alert strip:
// no apply button, no dismiss button, and nothing at all once `junk` returns
// to null.
//
// Policy (docs/testing.md): public API only, one assertion per test, drive
// through exported signals. Every case assigns a fresh payload object to
// `engineStatus` (writing the same reference does not notify). Status frames
// use state "0" (idle) so store/health.js contributes no engine alerts and
// the advice chip is the only thing that could render.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/junkadvice.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { AlertStrip } from "../../../hqptuner/static/components/AlertStrip.js";
import { junkAdvice } from "../../../hqptuner/static/store/alerts/junkadvice.js";
import { engineStatus } from "../../../hqptuner/static/store/signals.js";

// An idle engine: health derives no alerts from a non-playing state, so the
// strip's output is governed by the advice chip alone.
const IDLE = { state: "0", track_serial: "1" };

const ADVICE = {
  filter: "30k",
  reason: "Ultrasonic junk above 30 kHz suggests the 30k filter",
  ceiling_khz: 30,
};

// One fresh payload per call, then the rendered strip.
/**
 * @param {{ status: Record<string, string>,
 *   junk: { filter: string, reason: string, ceiling_khz: number } | null }} payload
 */
function strip(payload) {
  engineStatus.value = payload;
  return render(html`<${AlertStrip} />`);
}

test("test_an_advice_object_in_the_payload_surfaces_through_junkAdvice", () => {
  engineStatus.value = { status: { ...IDLE }, junk: { ...ADVICE } };
  assert.deepEqual(junkAdvice.value, ADVICE);
});

test("test_a_null_junk_key_yields_null_advice", () => {
  engineStatus.value = { status: { ...IDLE }, junk: null };
  assert.equal(junkAdvice.value, null);
});

test("test_a_payload_without_a_junk_key_yields_null_advice", () => {
  engineStatus.value = { status: { ...IDLE } };
  assert.equal(junkAdvice.value, null);
});

test("test_a_missing_status_payload_yields_null_advice", () => {
  engineStatus.value = null;
  assert.equal(junkAdvice.value, null);
});

test("test_present_advice_puts_its_reason_text_on_screen", () => {
  const out = strip({ status: { ...IDLE }, junk: { ...ADVICE } });
  assert.ok(out.includes(ADVICE.reason));
});

test("test_the_advice_chip_carries_no_button", () => {
  const out = strip({ status: { ...IDLE }, junk: { ...ADVICE } });
  assert.ok(!out.includes("<button"));
});

test("test_no_advice_and_no_alerts_renders_nothing", () => {
  assert.equal(strip({ status: { ...IDLE }, junk: null }), "");
});
