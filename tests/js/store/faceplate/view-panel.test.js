// Behavioral suite for the connection panel as one of the faceplate's overlays: its open flag is kept in
// hqptuner/static/store/faceplate/view.js beside the open drawer, list and popover, Escape takes it down the way it
// takes the others down, and taking it down by any route forgets the save it was reporting on, so a save still
// waiting on the health watcher gets no verdict once the panel is gone.
//
// view.js is read as a namespace and the flag through `overlay()`, so a view.js that keeps no flag reads as
// `undefined` and fails the assertion rather than the module link.
//
// `fetch` is faked at the real REST paths with the real response shapes, the `health` signal is assigned the
// readings a poll would have delivered, and the suite's fake clock (tests/js/support/clock.js) is handed in through
// `createConnPanel`, so every "at N ms" below is a reading of that clock and never a duration this suite spends; `settle()`
// turns the event loop rather than waiting on one. Readings are fresh objects every time: writing the same reference
// to a signal does not notify.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/view-panel.test.js

import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { health } from "../../../../hqptuner/static/store/signals.js";
import * as view from "../../../../hqptuner/static/store/faceplate/view.js";
import {
  CONTROL_ONLY,
  HEALTHY,
  connectionWire as wire,
  fake,
  panel,
  settle,
  start,
  stop,
  submitForm,
} from "../../support/rendered/connpanel.js";

/** @typedef {import("../../support/rendered/connpanel.js").Reading} Reading */

// The health reading this suite adds to the shared ones: no daemon found at all, with the 8088 lane silent too.
/** @type {Reading} */
const SILENT = { phase: "Down", credentials_ok: null, address_found: false };

/** Ten minutes after the save, in ms: past any window a watcher waits before calling a silent daemon unreachable. */
const LONG_AFTER = 600000;

/**
 * The faceplate's own flag for the connection panel, or `undefined` where view.js keeps none.
 *
 * @returns {{ value: boolean } | undefined}
 */
function overlay() {
  return Reflect.get(view, "panelOpen");
}

/**
 * Puts the connection panel up or takes it down by writing the faceplate's flag, the route every closer shares.
 *
 * @param {boolean} open
 * @returns {void}
 */
function setOverlay(open) {
  const flag = overlay();
  if (flag) flag.value = open;
}

beforeEach(() => {
  view.body.value = "chain";
  view.openStage.value = null;
  view.openPopover.value = null;
  view.openList.value = null;
  setOverlay(false);
});

afterEach(() => {
  stop();
  setOverlay(false);
});

// --- the panel's flag is the faceplate's ------------------------------------

test("test_escape_with_the_connection_panel_up_takes_it_down", () => {
  setOverlay(true);
  view.closeTop();
  assert.equal(overlay()?.value, false);
});

test("test_opening_the_connection_panel_raises_the_faceplates_panel_flag", async () => {
  start();
  wire({ lane: "ok" });
  panel.openPanel();
  await settle();
  assert.equal(overlay()?.value, true);
});

// --- taking the panel down forgets the save it was reporting on -------------

/**
 * @typedef {{ name: string, lane: string, reading: Reading, at: number, leftover: string }} ForgetCase
 */

/** @type {ForgetCase[]} */
const FORGOTTEN = [
  {
    name: "test_a_save_pending_when_the_panel_is_taken_down_is_not_reported_saved_later",
    lane: "ok",
    reading: HEALTHY,
    at: 1000,
    leftover: "saved",
  },
  {
    name: "test_a_save_pending_when_the_panel_is_taken_down_is_not_reported_refused_later",
    lane: "refused",
    reading: CONTROL_ONLY,
    at: 0,
    leftover: "refused",
  },
  {
    name: "test_a_save_pending_when_the_panel_is_taken_down_is_not_reported_unreachable_later",
    lane: "ok",
    reading: SILENT,
    at: LONG_AFTER,
    leftover: "unreachable",
  },
];

for (const kase of FORGOTTEN) {
  test(kase.name, async () => {
    start();
    await submitForm({ lane: kase.lane }, { host: "10.0.0.9", username: "tuner", password: "s3cret" });
    setOverlay(false);
    fake.advance(kase.at);
    health.value = { ...kase.reading };
    await settle();
    assert.notEqual(panel.verdict.value, kase.leftover);
  });
}
