// Rendered suite for the alert home on hqptuner/static/components/faceplate/EngineRow.js: a sustained slow engine blinks
// the speed gauge in its colour, and the gauge takes taps like a button only while an alert is homed on it.
//
// The wire is the seam, as tests/js/components/faceplate/engine-row.test.js drives it: each case writes Status frames
// into `engineStatus`, as the poll does, with the health store's baseline effect registered. Every case starts a track
// of its own on a healthy frame, which zeroes the speed streak, then holds the speed it names for as many polls as the
// health store takes to raise it, as tests/js/store/faceplate/alerts.test.js sustains it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-alerts/engine-row.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { initHealth } from "../../../../hqptuner/static/store/health.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { html } from "../../../../hqptuner/static/lib/dom.js";
import { EngineRow } from "../../../../hqptuner/static/components/faceplate/EngineRow.js";
import { elements, attr, classes } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {Record<string, string>} Frame */

initHealth();

const SUSTAIN = 3;

/** A Status frame while playing. @type {Frame} */
const PLAYING = {
  state: "2",
  process_speed: "1.62",
  input_fill: "0.82",
  output_fill: "0.74",
  clips: "3",
  apod: "5398",
};

let track = 0;

/**
 * The gauge after a track starts on a healthy frame and the poll then reads `frame` SUSTAIN times on the same track.
 *
 * @param {Frame} frame  overrides on PLAYING
 * @returns {MarkupElement | undefined}
 */
function gauge(frame) {
  track += 1;
  const serial = String(track);
  engineStatus.value = { status: { ...PLAYING, track_serial: serial } };
  for (let i = 0; i < SUSTAIN; i += 1) engineStatus.value = { status: { ...PLAYING, ...frame, track_serial: serial } };
  return elements(render(html`<${EngineRow} />`)).find((e) => classes(e).includes("gauge"));
}

/**
 * One attribute of the gauge, or undefined when the gauge or the attribute is missing.
 *
 * @param {Frame} frame
 * @param {string} name
 */
const gaugeAttr = (frame, name) => {
  const g = gauge(frame);
  return g && attr(g, name);
};

test("test_a_sustained_below_realtime_speed_blinks_the_gauge_red", () => {
  assert.equal(gaugeAttr({ process_speed: "0.5" }, "data-alert"), "crit");
});

test("test_a_sustained_slow_speed_above_realtime_blinks_the_gauge_amber", () => {
  assert.equal(gaugeAttr({ process_speed: "1.02" }, "data-alert"), "warn");
});

test("test_the_gauge_is_a_button_while_an_alert_is_homed_on_it", () => {
  assert.equal(gaugeAttr({ process_speed: "0.5" }, "role"), "button");
});

test("test_the_gauge_carries_no_role_while_no_alert_is_homed_on_it", () => {
  assert.equal(gaugeAttr({}, "role"), undefined);
});
