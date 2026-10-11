// Behavioral suite for the connection panel as one of the faceplate's overlays: its open flag is kept in
// hqptuner/static/store/faceplate/view.js beside the open drawer, list and popover, Escape takes it down the way it
// takes the others down, and taking it down by any route forgets the save it was reporting on, so a save still
// waiting on the health watcher gets no verdict once the panel is gone.
//
// view.js is read as a namespace and the flag through `overlay()`, so a view.js that keeps no flag reads as
// `undefined` and fails the assertion rather than the module link.
//
// `fetch` is faked at the real REST paths with the real response shapes, the `health` signal is assigned the
// readings a poll would have delivered, and the clock is injected through `initPanel(now)`, so every "at N ms" below
// is a reading of that function and never a duration this suite spends; `settle()` turns the event loop rather than
// waiting on one. Readings are fresh objects every time: writing the same reference to a signal does not notify.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/view-panel.test.js

import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { health } from "../../../../hqptuner/static/store/signals.js";
import {
  form,
  hostTouched,
  verdict,
  initPanel,
  openPanel,
  submitConnection,
} from "../../../../hqptuner/static/store/connpanel.js";
import * as view from "../../../../hqptuner/static/store/faceplate/view.js";
import { staticWire, ok } from "../../support/wire/wire.js";

/** The globals a wire fake installs a `fetch` on. */
/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** @typedef {Record<string, unknown>} Reading */

// The health readings this suite drives with, in the shape /api/health serves. `credentials_ok` is tri-state: null
// is the 8088 lane's silence.
/** @type {Reading} */
const SILENT = { reachable: false, ready: false, connected: false, credentials_ok: null };
/** @type {Reading} */
const CONTROL_ONLY = { reachable: true, ready: false, connected: true, credentials_ok: null };
/** @type {Reading} */
const HEALTHY = { reachable: true, ready: true, connected: true, credentials_ok: true };

/** Ten minutes after the save, in ms: past any window a watcher waits before calling a silent daemon unreachable. */
const LONG_AFTER = 600000;

/** The injected clock, in milliseconds since the page loaded. */
let clock = 0;
/** @type {(() => void) | undefined} */
let dispose;

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
  if (dispose) dispose();
  dispose = undefined;
  env.fetch = REAL_FETCH;
  setOverlay(false);
});

// A freshly loaded page: no reading seen, no verdict, host field holding the loopback address it opens with and not
// yet edited.
function start() {
  clock = 0;
  health.value = null;
  hostTouched.value = false;
  verdict.value = null;
  form.value = { host: "127.0.0.1", username: "", password: "", remember: false };
  dispose = initPanel(() => clock);
}

// Turns of the event loop, never a duration: enough for the fake's immediate answers and the store's continuations
// off them to have run.
/**
 * @param {number} [turns]
 * @returns {Promise<void>}
 */
async function settle(turns = 8) {
  for (let turn = 0; turn < turns; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

// The REST fake: discovery answering nobody, the saved record GET /api/connection serves, and a 200 on the POST
// carrying the lane the route reached.
/** @param {string} lane */
function wire(lane) {
  staticWire(undefined, (path, opts) => {
    if (path === "/api/discover") return ok([]);
    if (path === "/api/connection" && opts.method === "POST") {
      return ok({ host: "10.0.0.9", username: "tuner", remember: false, has_password: true, lane });
    }
    if (path === "/api/connection") {
      return ok({ host: "10.0.0.9", username: "tuner", remember: false, has_password: false });
    }
    return undefined;
  });
}

// --- the panel's flag is the faceplate's ------------------------------------

test("test_escape_with_the_connection_panel_up_takes_it_down", () => {
  setOverlay(true);
  view.closeTop();
  assert.equal(overlay()?.value, false);
});

test("test_opening_the_connection_panel_raises_the_faceplates_panel_flag", async () => {
  start();
  wire("ok");
  openPanel();
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
    wire(kase.lane);
    openPanel();
    await settle();
    form.value = { ...form.value, host: "10.0.0.9", username: "tuner", password: "s3cret" };
    await submitConnection();
    setOverlay(false);
    clock = kase.at;
    health.value = { ...kase.reading };
    await settle();
    assert.notEqual(verdict.value, kase.leftover);
  });
}
