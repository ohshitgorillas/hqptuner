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
// The interaction contract — vertical drag (Shift fine), arrow/Page/Home/End
// keys, double-click reset, the deliberate wheel refusal, and the
// onLive/onCommit snapping behind them — lives in pointer and keyboard handlers
// SSR never fires. Those are reached through tests/js/support/pointer.js, which
// models the browser's own dispatch contract rather than stubbing anything of
// the knob's; the bulk of them are pinned by tests/js/components/
// knob-focus-keys.test.js, and the press section at the foot of this file adds
// what a press itself must do. The number box is an uncontrolled input synced by
// ref in useEffect, so its VALUE is not observable server-side (docs/testing.md
// harness facts), and remains a playwright hand-back concern.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/knob.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Knob } from "../../../hqptuner/static/components/Knob.js";
import { knobGestures } from "../support/pointer.js";

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

// --- what a press on the dial itself must do -------------------------------------
//
// Pressing the dial used to start the browser's text-selection gesture, so a
// drag rubber-banded the page text around the knob. The dial cancels that at
// source, by canceling the `pointerdown`. The DOM contract makes that one
// change into two: canceling a `pointerdown` suppresses the compatibility
// `mousedown`, and with it BOTH the selection gesture (wanted) and the browser's
// own focus-on-click (not wanted, since every keyboard gesture the dial has is
// licensed by focus). So the dial must ask for focus itself, and a disabled dial
// must do neither thing.
//
// Read through the public surface only: the event a browser would go on to act
// on, the focus a browser would see asked for, and the callbacks the component
// was handed. Nothing of the knob's is stubbed.

const MIN = -90;
const MAX = 90;
const STEP = 5;
const START = 0;

/**
 * @param {{ live?: number[], commits?: number[], disabled?: boolean }} opts
 */
const pressKnob = ({ live = [], commits = [], disabled = false }) => html`<${Knob}
  min=${MIN}
  max=${MAX}
  step=${STEP}
  value=${START}
  def=${MIN}
  unit="dB"
  disabled=${disabled}
  onLive=${(/** @type {number} */ v) => live.push(v)}
  onCommit=${(/** @type {number} */ v) => commits.push(v)}
/>`;

test("test_a_press_on_the_dial_cancels_the_browsers_selection_gesture", () => {
  assert.equal(knobGestures(pressKnob({})).down(200).defaultPrevented, true);
});

test("test_a_press_on_the_dial_asks_the_pressed_element_for_focus", () => {
  const gestures = knobGestures(pressKnob({}));
  gestures.down(200);
  assert.equal(gestures.focusCalls(), 1);
});

// A disabled knob takes no part in the gesture, so the press is left exactly as
// the browser handed it over. `inert` says a dispatch nobody receives is one way
// of doing that, rather than a harness error.

test("test_a_press_on_a_disabled_dial_leaves_the_browsers_default_alone", () => {
  assert.equal(knobGestures(pressKnob({ disabled: true }), { inert: true }).down(200).defaultPrevented, false);
});

test("test_a_press_on_a_disabled_dial_asks_for_no_focus", () => {
  const gestures = knobGestures(pressKnob({ disabled: true }), { inert: true });
  gestures.down(200);
  assert.equal(gestures.focusCalls(), 0);
});

// --- and the gestures the press is the start of are unchanged --------------------

test("test_a_drag_up_the_dial_commits_a_value_the_knob_did_not_start_on", () => {
  /** @type {number[]} */
  const commits = [];
  const gestures = knobGestures(pressKnob({ commits }));
  gestures.down(200);
  gestures.move(170, 1);
  gestures.up(170);
  assert.deepEqual(
    commits.map((v) => v !== START),
    [true],
  );
});

test("test_a_drag_up_the_dial_reports_live_values_before_it_is_released", () => {
  /** @type {number[]} */
  const live = [];
  const gestures = knobGestures(pressKnob({ live }));
  gestures.down(200);
  gestures.move(170, 1);
  assert.deepEqual([live.length > 0, live.every((v) => v !== START)], [true, true]);
});

// The focus of behavior 2 is what keeps this alive: a click, then a key. With
// no explicit focus the dial never learns it holds any, and the arrow is refused
// as the Safari scroll-gesture case (tests/js/components/knob-focus-keys.test.js).

test("test_an_arrow_key_after_a_press_commits_a_stepped_value", () => {
  /** @type {number[]} */
  const commits = [];
  const gestures = knobGestures(pressKnob({ commits }));
  gestures.down(200);
  gestures.up(200);
  gestures.key("ArrowUp");
  assert.equal(commits[commits.length - 1], START + STEP);
});
