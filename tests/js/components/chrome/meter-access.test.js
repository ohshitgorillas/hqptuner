// Behavioral suite for the METER page's access: the LIVE and METER modes
// exclude each other, the App body under METER keeps the pending bar, and the
// mini spectrum toggles METER and reports its state through aria-pressed.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/chrome/meter-access.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { App } from "../../../../hqptuner/static/components/App.js";
import {
  health,
  engineState,
  engineStatus,
  config,
  matrixConfig,
  enums,
} from "../../../../hqptuner/static/store/signals.js";
import * as prefs from "../../../../hqptuner/static/store/ui/prefs.js";
import { MiniSpectrum } from "../../../../hqptuner/static/components/MiniSpectrum.js";
import { renderTree } from "../../support/vnodeseam.js";

// Both mode flags off: module signals outlive a test.
function modesOff() {
  prefs.liveMode.value = false;
  prefs.meterMode.value = false;
}

/** @type {Array<[string, () => void, () => void, boolean[]]>} */
const SWITCHES = [
  ["meter_from_live_turns_live_off", () => prefs.setLiveMode(true), () => prefs.setMeterMode(true), [false, true]],
  ["live_from_meter_turns_meter_off", () => prefs.setMeterMode(true), () => prefs.setLiveMode(true), [true, false]],
];

for (const [name, first, second, expected] of SWITCHES) {
  test(`test_switching_${name}`, () => {
    modesOff();
    first();
    second();
    assert.deepEqual([prefs.liveMode.value, prefs.meterMode.value], expected);
  });
}

const MARKERS = {
  "tab-nav": 'class="tab-nav"',
  "pending-bar": 'class="pending-bar',
  "meter-page": 'data-testid="meter-page"',
};

/**
 * The markers, of the three, that App carries with the given METER flag.
 *
 * @param {boolean} meter
 * @returns {string[]}
 */
function markersOf(meter) {
  health.value = { reachable: true, ready: true, info: {} };
  engineState.value = {};
  engineStatus.value = null;
  config.value = null;
  matrixConfig.value = null;
  enums.value = null;
  prefs.liveMode.value = false;
  prefs.meterMode.value = meter;
  const out = render(html`<${App} />`);
  return Object.entries(MARKERS)
    .filter(([, needle]) => out.includes(needle))
    .map(([marker]) => marker);
}

/** @type {Array<[string, boolean, string[]]>} */
const BODIES = [
  ["meter_on_shows_the_meter_page_and_keeps_the_pending_bar", true, ["pending-bar", "meter-page"]],
  ["meter_off_shows_the_tabs_and_the_pending_bar", false, ["tab-nav", "pending-bar"]],
];

for (const [name, meter, expected] of BODIES) {
  test(`test_app_with_${name}`, () => {
    assert.deepEqual(markersOf(meter), expected);
  });
}

/**
 * Render MiniSpectrum with the given METER flag, call the onClick of the
 * `data-testid="mini-spectrum"` vnode when there is one, and return the flag
 * afterwards.
 *
 * @param {boolean} meter
 * @returns {boolean}
 */
function meterAfterClick(meter) {
  prefs.liveMode.value = false;
  prefs.meterMode.value = meter;
  const { seen } = renderTree(html`<${MiniSpectrum} />`);
  const node = seen.find((v) => v.props["data-testid"] === "mini-spectrum");
  const onClick = node ? node.props.onClick : undefined;
  if (typeof onClick === "function") {
    onClick({ preventDefault() {}, stopPropagation() {} });
  }
  return prefs.meterMode.value;
}

/** @type {Array<[string, boolean, boolean]>} */
const CLICKS = [
  ["with_meter_off_opens_meter", false, true],
  ["with_meter_on_closes_meter", true, false],
];

for (const [name, meter, expected] of CLICKS) {
  test(`test_a_mini_spectrum_click_${name}`, () => {
    assert.equal(meterAfterClick(meter), expected);
  });
}

/**
 * The aria-pressed value on the rendered `data-testid="mini-spectrum"`
 * element, or "" where the element or the attribute is absent.
 *
 * @param {boolean} meter
 * @returns {string}
 */
function pressedOf(meter) {
  prefs.liveMode.value = false;
  prefs.meterMode.value = meter;
  const out = render(html`<${MiniSpectrum} />`);
  const at = out.indexOf('data-testid="mini-spectrum"');
  if (at < 0) {
    return "";
  }
  const tag = out.slice(out.lastIndexOf("<", at), out.indexOf(">", at));
  const key = 'aria-pressed="';
  const from = tag.indexOf(key);
  if (from < 0) {
    return "";
  }
  const start = from + key.length;
  return tag.slice(start, tag.indexOf('"', start));
}

/** @type {Array<[string, boolean, string]>} */
const PRESSED = [
  ["meter_on_is_pressed", true, "true"],
  ["meter_off_is_not_pressed", false, "false"],
];

for (const [name, meter, expected] of PRESSED) {
  test(`test_the_mini_spectrum_with_${name}`, () => {
    assert.equal(pressedOf(meter), expected);
  });
}

/**
 * Whether the `data-testid="mini-spectrum"` element renders at all for one
 * reading of /api/status.
 *
 * @param {{ advisor: boolean }} status
 * @returns {boolean}
 */
function rendersFor(status) {
  prefs.liveMode.value = false;
  prefs.meterMode.value = false;
  engineStatus.value = status;
  const out = render(html`<${MiniSpectrum} />`);
  engineStatus.value = null;
  return out.includes('data-testid="mini-spectrum"');
}

test("test_the_mini_spectrum_renders_only_while_the_advisor_is_on", () => {
  assert.deepEqual([rendersFor({ advisor: true }), rendersFor({ advisor: false })], [true, false]);
});
