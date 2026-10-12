// Rendered suite for what the faceplate (the frame hqptuner/static/app.js composes) shows directly under its top bar of
// the settings a daemon restart dropped, with no tap: one row per setting, each reading the setting's label and its
// engine name, a pinned rate in the form the page prints rates (kHz), and adaptive volume as a word that tells its two
// states apart.
//
// The wire is the seam, as tests/js/components/faceplate-alerts/header.test.js drives it: the /api/health reading,
// carrying `dropped_settings` in its `WrittenSetting` shape, goes into `health`, and the rest of the frame's state is
// set the way that file sets the header's. The region under the top bar is read through
// tests/js/support/plateline.js. The sentence, the labels and the On / Off words are owner copy and are nowhere in this
// file: a row is read for the engine name or the rate number the fixture put on the wire, and a label or a flag word
// only by comparing two renders that differ in that one field.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-alerts/header-dropped.test.js

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
import { readPlate, shownText } from "../../support/plateline.js";
import { staticWire } from "../../support/wire/wire.js";

/** @typedef {{ field: string, value: string, name: string | null }} WrittenSetting */

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** The plate's design size. */
const DESIGN_SIZE = { w: 1080, h: 810 };

/** A /api/health reading whose credentials the daemon accepted and which lists no dropped setting. */
const HEALTHY = { reachable: true, ready: true, connected: true, credentials_ok: true, info: {}, dropped_settings: [] };

/**
 * Two dropped settings whose engine names differ from their form values.
 *
 * @type {{ field: string, value: string, name: string }[]}
 */
const NAMED = [
  { field: "filter", value: "42", name: "poly-sinc-gauss-xla" },
  { field: "modulator", value: "7", name: "ASDM7EC-super" },
];

/** One engine name two fields can both hold. */
const SHARED_NAME = "poly-sinc-gauss-long";

/** Pinned rates in Hz as the wire carries them, each with the kHz figure the page prints for it. */
const RATES = [
  { hz: "352800", khz: "352.8" },
  { hz: "44100", khz: "44.1" },
];

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

/**
 * What shows directly under the top bar, with the report listing `dropped` and nothing tapped.
 *
 * @param {WrittenSetting[]} dropped
 */
const underBarReads = (dropped) => {
  report(dropped);
  return shownText(readPlate().under);
};

for (const [i, setting] of NAMED.entries()) {
  test(`test_the_line_under_the_top_bar_shows_dropped_setting_${i + 1}_by_its_engine_name`, () => {
    assert.ok(underBarReads(NAMED).includes(setting.name));
  });
}

test("test_two_fields_dropped_on_one_engine_name_read_apart_by_their_labels", () => {
  const onFilter1x = underBarReads([{ field: "filter1x", value: "40", name: SHARED_NAME }]);
  const onFilterNx = underBarReads([{ field: "filter", value: "40", name: SHARED_NAME }]);
  assert.notEqual(onFilter1x, onFilterNx);
});

for (const { hz, khz } of RATES) {
  test(`test_a_dropped_rate_of_${hz}_hz_reads_${khz.replace(".", "_")}_khz`, () => {
    assert.ok(underBarReads([{ field: "rate", value: hz, name: null }]).includes(khz));
  });
}

test("test_dropped_adaptive_volume_on_and_off_read_apart", () => {
  const on = underBarReads([{ field: "adaptive_volume", value: "1", name: null }]);
  const off = underBarReads([{ field: "adaptive_volume", value: "0", name: null }]);
  assert.notEqual(on, off);
});
