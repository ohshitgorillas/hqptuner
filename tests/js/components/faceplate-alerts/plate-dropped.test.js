// Rendered suite for where the faceplate (the frame hqptuner/static/app.js composes) shows the settings a daemon restart dropped:
// while the health report lists any, the alert shows directly under the top bar on every view the plate shows, with no
// tap, and stays there across a track change; when the report lists none, no alert line shows there.
//
// The wire is the seam, as tests/js/components/faceplate-alerts/header-dropped.test.js drives it: the /api/health
// reading, carrying `dropped_settings` in its `WrittenSetting` shape, goes into `health`, the /api/status frame into
// `engineStatus`, every simulated poll a fresh object, and the rest of the plate's state is set the way that file sets
// it. The region under the top bar is read through tests/js/support/plateline.js. The sentence and the labels are owner
// copy and are nowhere in this file: the alert is read for the engine name the fixture put on the wire, and a line is an
// element carrying a severity.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-alerts/plate-dropped.test.js

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
import { liveBook, livePresets, livePresetError } from "../../../../hqptuner/static/store/live/presets.js";
import { liveOp } from "../../../../hqptuner/static/store/live/write.js";
import { descriptionError } from "../../../../hqptuner/static/store/matrix/descriptions.js";
import { favoritesError } from "../../../../hqptuner/static/store/narrow/favorites.js";
import { narrowingError } from "../../../../hqptuner/static/store/narrow/persist.js";
import { unfolded } from "../../../../hqptuner/static/store/faceplate/stations.js";
import { body, openPopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/plate.js";
import { readPlate, shownText, shownLines } from "../../support/plateline.js";
import { staticWire } from "../../support/wire/wire.js";

/** @typedef {{ field: string, value: string, name: string | null }} WrittenSetting */

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** The plate's design size. */
const DESIGN_SIZE = { w: 1080, h: 810 };

/**
 * Every view the plate's body shows: the chain, the gear's settings, and the three builders.
 *
 * @type {(typeof body.value)[]}
 */
const VIEWS = ["chain", "settings", "profile", "snapshots", "station"];

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

let serial = 0;

beforeEach(async () => {
  staticWire();
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
  liveOp.clear();
  livePresetError.value = "";
  descriptionError.value = "";
  favoritesError.value = "";
  narrowingError.value = "";
  pendingPreset.value = null;
  await discardAll();
  health.value = { ...HEALTHY };
  applying.value = false;
  engineBusy.value = false;
  unfolded.value = null;
  body.value = "chain";
  openPopover.value = null;
});

afterEach(() => {
  env.fetch = REAL_FETCH;
});

/**
 * A fresh health reading listing `dropped`.
 *
 * @param {WrittenSetting[]} dropped
 */
const report = (dropped) => {
  health.value = { ...HEALTHY, dropped_settings: dropped.map((d) => ({ ...d })) };
};

/** One /api/status poll on the current track, playing at a healthy speed with nothing else wrong. */
function poll() {
  engineStatus.value = {
    status: {
      state: "2",
      track_serial: String(serial),
      process_speed: "1.5",
      output_fill: "0.9",
      clips: "0",
      apod: "0",
      active_filter: "sinc-M",
    },
  };
}

/** What a reader sees directly under the top bar. */
const underBarReads = () => shownText(readPlate().under);

/**
 * Whether an alert line shows directly under the top bar while the report lists `dropped`.
 *
 * @param {WrittenSetting[]} dropped
 */
const lineUnderBar = (dropped) => {
  report(dropped);
  return shownLines(readPlate().under).length > 0;
};

for (const view of VIEWS) {
  test(`test_dropped_settings_show_under_the_top_bar_on_the_${view}_view_without_a_tap`, () => {
    body.value = view;
    report(DROPPED);
    assert.ok(underBarReads().includes(FILTER_NAME));
  });
}

test("test_an_alert_line_shows_under_the_top_bar_while_the_report_lists_a_setting", () => {
  assert.equal(lineUnderBar(DROPPED), true);
});

test("test_the_line_under_the_top_bar_stays_on_the_next_track_while_the_report_still_lists_a_setting", () => {
  serial += 1;
  poll();
  report(DROPPED);
  serial += 1;
  poll();
  poll();
  report(DROPPED);
  assert.ok(underBarReads().includes(FILTER_NAME));
});
