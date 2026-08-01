// Behavioral suite for components/Knob.js — only the render-visible contracts
// its parent suite does not already pin. tests/js/playbackvolume.test.js owns
// the dial's ARIA surface (aria-valuemin/max/now/text) and the off/live
// classes through PlaybackVolume; asserted here is what that route never
// touches: the slider's step quantum and its opt-out, the dial's tab-order
// gating, and the unit label.
//
// Policy (docs/testing.md): public API only, one assertion per test. The knob
// is a pure function of its props, so every case renders it directly with
// props the test owns.
//
// DOCUMENTED-UNTESTABLE, per policy: the entire interaction contract —
// vertical drag (Shift fine), arrow/Page/Home/End keys, double-click reset,
// the deliberate wheel refusal, and the onLive/onCommit snapping behind them —
// lives in pointer and keyboard handlers SSR never fires, and belongs to the
// playwright hand-back protocol, not a unit test. The number box is an
// uncontrolled input synced by ref in useEffect, so its VALUE is likewise not
// observable server-side (docs/testing.md harness facts).
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/knob.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../hqptuner/static/lib/dom.js";
import { Knob } from "../../hqptuner/static/components/Knob.js";

const knob = (props = {}) => render(html`<${Knob} min="-60" max="0" ...${props} />`);

test("test_the_slider_steps_at_the_given_quantum", () => {
  assert.ok(knob({ step: 0.5 }).includes('step="0.5"'));
});

test("test_a_missing_step_defaults_to_a_whole_unit", () => {
  assert.ok(knob().includes('step="1"'));
});

test("test_a_knob_without_a_slider_renders_no_range_input", () => {
  assert.equal(knob({ slider: false }).includes('type="range"'), false);
});

test("test_the_unit_is_shown_beside_the_readout", () => {
  assert.ok(knob({ unit: "dB" }).includes('<span class="knob-unit">dB</span>'));
});

test("test_an_enabled_dial_sits_in_the_tab_order", () => {
  assert.ok(knob().includes('tabindex="0"'));
});

test("test_a_disabled_dial_leaves_the_tab_order", () => {
  assert.ok(knob({ disabled: true }).includes('tabindex="-1"'));
});

// --- log-scale knobs with a missing or zero minimum ------------------------------
// These render Knob without the helper's baked-in min: the case under test is
// the absent (or zero) minimum itself, which log math must not turn into
// NaN/Infinity anywhere in the rendered dial or slider.

const logKnob = (extra = {}) => render(html`<${Knob} scale="log" max=${20000} value=${80} ...${extra} />`);

test("test_a_log_knob_with_no_minimum_renders_only_finite_values", () => {
  assert.equal(/NaN|Infinity/.test(logKnob()), false);
});

test("test_a_log_knob_with_a_zero_minimum_renders_only_finite_values", () => {
  assert.equal(/NaN|Infinity/.test(logKnob({ min: 0 })), false);
});

test("test_a_log_knob_with_a_zero_minimum_reports_a_positive_aria_minimum", () => {
  const min = parseFloat((/aria-valuemin="([^"]*)"/.exec(logKnob({ min: 0 })) || [])[1]);
  assert.ok(min > 0);
});

test("test_a_log_knob_with_no_minimum_defaults_its_aria_minimum_to_one", () => {
  assert.ok(logKnob().includes('aria-valuemin="1"'));
});
