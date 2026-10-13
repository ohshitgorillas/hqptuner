// Rendered suite for clearing the dropped-settings report from the faceplate (the frame hqptuner/static/app.js
// composes), where the alert shows directly under the top bar: tapping that line asks the server to clear the report
// (DELETE /api/health/dropped-settings, answered 204 with no body) and then reads /api/health again, and once that
// reading lists nothing the line is gone; while it still lists a setting, the line stays. A tap on the knob clears
// nothing, a refused clear leaves the line up to be tapped again, and the credentials line in the knob's popover clears
// nothing.
//
// The wire is the seam, as tests/js/components/faceplate-alerts/header-dropped.test.js drives it: the /api/health
// reading carrying `dropped_settings` goes into `health`, the rest of the frame's state is set the way that file sets
// it, and a fetch fake answers the staging reads, the clear and the health read from this file's own table. The clear's
// 204 is the platform's own empty Response. The region under the top bar is read through tests/js/support/plateline.js.
// Taps are fired through the renderer's vnode seam, since render-to-string fires no events; a line is the element
// carrying a severity, and tapping it fires the first tap handler on that element or inside it. The sentences are owner
// copy and are nowhere in this file: a line is found by its severity, and the alert is read for the engine name the
// fixture put on the wire.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-alerts/header-dropped-clear.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import "../../support/domseam.js";
import {
  health,
  config,
  pendingPreset,
  engineState,
  engineStatus,
  matrixConfig,
  lastApply,
} from "../../../../hqptuner/static/store/signals.js";
import { applying, discardAll } from "../../../../hqptuner/static/store/actions.js";
import { engineBusy } from "../../../../hqptuner/static/store/enginewrite.js";
import { liveBook, livePresets } from "../../../../hqptuner/static/store/live/presets.js";
import { unfolded } from "../../../../hqptuner/static/store/faceplate/stations.js";
import { body, openPopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/plate.js";
import { readPlate, shownText, lineTap } from "../../support/plateline.js";
import { stagingWire, quiesce, bad } from "../../support/wire/wire.js";

/** @typedef {{ field: string, value: string, name: string | null }} WrittenSetting */
/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** The clear's path. */
const CLEAR_PATH = "/api/health/dropped-settings";

/** The health read's path. */
const HEALTH_PATH = "/api/health";

/** The knob's test id. */
const KNOB = "conn";

/** The plate's design size. */
const DESIGN_SIZE = { w: 1080, h: 810 };

/** The credentials alert's severity, and the dropped-settings alert's, as their lines carry them. */
const CRED_SEV = "crit";
const DROPPED_SEV = "warn";

/** A refusal in the server's own shape. */
const REFUSAL_STATUS = 503;
const REFUSAL_DETAIL = "hqplayerd is not answering";

/** A /api/health reading whose credentials the daemon accepted and which lists no dropped setting. */
const HEALTHY = { reachable: true, ready: true, connected: true, credentials_ok: true, info: {}, dropped_settings: [] };

/** The engine name of the dropped filter, as the wire carries it. */
const FILTER_NAME = "poly-sinc-gauss-xla";

/**
 * Two settings a daemon restart dropped.
 *
 * @type {WrittenSetting[]}
 */
const DROPPED = [
  { field: "filter", value: "42", name: FILTER_NAME },
  { field: "rate", value: "352800", name: null },
];

/** A tap event: the members a tap handler may call. */
const TAP = { preventDefault() {}, stopPropagation() {}, target: {}, currentTarget: {} };

/**
 * The fake server's table: whether it accepts a clear, and the health reading it serves.
 *
 * @type {{ clearRefused: boolean, served: Record<string, unknown> }}
 */
const table = { clearRefused: false, served: { ...HEALTHY } };

/** Every request the fake answered beyond the staging reads: method and path, in arrival order. */
/** @type {[string, string][]} */
const calls = [];

/** @type {StagingWire} */
let wire;

beforeEach(async () => {
  calls.length = 0;
  table.clearRefused = false;
  table.served = { ...HEALTHY };
  wire = stagingWire({
    routes: (path, opts) => {
      const bare = path.split("?")[0];
      calls.push([opts.method || "GET", bare]);
      if (bare === CLEAR_PATH && opts.method === "DELETE") {
        return table.clearRefused ? bad(REFUSAL_STATUS, REFUSAL_DETAIL) : new Response(null, { status: 204 });
      }
      if (bare === HEALTH_PATH) {
        const served = { ...table.served };
        return { ok: true, status: 200, json: async () => served };
      }
      return undefined;
    },
  });
  viewport.value = { ...DESIGN_SIZE };
  engineState.value = {};
  engineStatus.value = null;
  matrixConfig.value = { fields: [] };
  config.value = {
    fields: [],
    file: {},
    active: "Day",
    profiles: { value: "Day", options: ["", "Day"].map((n) => ({ value: n, label: n })) },
  };
  liveBook.value = {};
  livePresets.value = null;
  lastApply.value = null;
  pendingPreset.value = null;
  await discardAll();
  await quiesce(wire);
  health.value = { ...HEALTHY };
  applying.value = false;
  engineBusy.value = false;
  unfolded.value = null;
  body.value = "chain";
  openPopover.value = null;
  calls.length = 0;
});

afterEach(() => {
  env.fetch = REAL_FETCH;
});

/**
 * A fresh health reading listing `dropped`, credentials accepted unless `refused`.
 *
 * @param {WrittenSetting[]} dropped
 * @param {boolean} [refused]
 */
const report = (dropped, refused = false) => {
  health.value = { ...HEALTHY, credentials_ok: !refused, dropped_settings: dropped.map((d) => ({ ...d })) };
};

/** Whether the dropped filter's engine name shows directly under the top bar. */
const underBarShows = () => shownText(readPlate().under).includes(FILTER_NAME);

/**
 * Fire a tap handler, if there is one, and wait for the wire to go quiet. How the handler itself settles is not this
 * suite's question: the wire and the render are.
 *
 * @param {((e?: unknown) => unknown) | undefined} onTap
 */
async function fire(onTap) {
  if (typeof onTap === "function") await Promise.resolve(onTap(TAP)).catch(() => undefined);
  await quiesce(wire);
}

/** Tap the knob, from a closed popover. */
async function tapKnob() {
  openPopover.value = null;
  const { seen } = readPlate();
  const hit = seen.find((v) => v.props["data-testid"] === KNOB);
  await fire(/** @type {((e?: unknown) => unknown) | undefined} */ (hit?.props.onClick));
}

/** Tap the first line directly under the top bar carrying the dropped-settings alert's severity. */
async function tapUnderBar() {
  const { seen, under } = readPlate();
  await fire(lineTap(seen, DROPPED_SEV, under));
}

/** Tap the first credentials line anywhere on the faceplate, the knob's popover included. */
async function tapCredentials() {
  const { seen } = readPlate();
  await fire(lineTap(seen, CRED_SEV));
}

/** How many clears the fake has been asked for. */
const clears = () => calls.filter(([method, path]) => method === "DELETE" && path === CLEAR_PATH).length;

/** Every request the fake answered after the first clear, or none when no clear came. */
const callsAfterClear = () => {
  const at = calls.findIndex(([method, path]) => method === "DELETE" && path === CLEAR_PATH);
  return at < 0 ? [] : calls.slice(at + 1);
};

test("test_tapping_the_line_under_the_top_bar_sends_one_clear", async () => {
  report(DROPPED);
  await tapUnderBar();
  assert.deepEqual(
    calls.filter(([, path]) => path === CLEAR_PATH),
    [["DELETE", CLEAR_PATH]],
  );
});

test("test_tapping_the_line_under_the_top_bar_reads_health_once_after_the_clear", async () => {
  report(DROPPED);
  await tapUnderBar();
  assert.deepEqual(
    callsAfterClear().filter(([, path]) => path === HEALTH_PATH),
    [["GET", HEALTH_PATH]],
  );
});

test("test_a_health_read_that_still_lists_a_setting_after_the_clear_keeps_the_line_up", async () => {
  table.served = { ...HEALTHY, dropped_settings: DROPPED.map((d) => ({ ...d })) };
  report(DROPPED);
  await tapUnderBar();
  assert.equal(underBarShows(), true);
});

test("test_tapping_the_line_after_the_knob_sends_one_clear", async () => {
  report(DROPPED);
  await tapKnob();
  await tapUnderBar();
  assert.equal(clears(), 1);
});

test("test_after_a_refused_clear_the_line_can_be_tapped_again", async () => {
  table.clearRefused = true;
  table.served = { ...HEALTHY, dropped_settings: DROPPED.map((d) => ({ ...d })) };
  report(DROPPED);
  await tapUnderBar();
  await tapUnderBar();
  assert.equal(clears(), 2);
});

test("test_with_the_credentials_refused_tapping_the_line_after_the_credentials_line_sends_one_clear", async () => {
  report(DROPPED, true);
  await tapKnob();
  await tapCredentials();
  await tapUnderBar();
  assert.equal(clears(), 1);
});
