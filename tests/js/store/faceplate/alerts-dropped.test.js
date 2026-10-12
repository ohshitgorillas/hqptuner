// Behavioral suite for the engine alert hqptuner/static/store/faceplate/alerts.js raises from the health report's
// `dropped_settings`: the brand knob shows connection status only, so the alert never lights the knob and never joins
// the credentials alert in the knob's popover, and the alert comes down once the report lists nothing. Where it does
// show, directly under the top bar, is pinned in tests/js/components/faceplate-alerts/plate-dropped.test.js.
//
// Driven at the wire as tests/js/store/faceplate/alerts.test.js drives it: the /api/health reading goes into `health`
// and the /api/status frame into `engineStatus`, every simulated poll a fresh object, each case starting on a fresh track
// with a healthy speed and nothing else wrong. The new alert's kind is the implementation's to name, so no case names
// it: the knob is read with the report listing settings and compared with the knob read with the report empty. The
// sentences are owner copy and are nowhere in this file.
//
// Not reachable here: a timeout measured on a clock. The alerts store takes no clock seam, so this file pins the
// alert's dependence on the report alone, and not on elapsed time.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/alerts-dropped.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { health, engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { initHealth } from "../../../../hqptuner/static/store/health.js";
import { faceplateAlerts, alertsNow, alertNotes } from "../../../../hqptuner/static/store/faceplate/alerts.js";
import { reset, DSD1024, PCM_8X } from "../../support/shaperfit-fixtures.js";
import { fakeClock } from "../../support/clock.js";

initHealth(fakeClock().clock);

/** The brand knob's header element id, as the credentials alert homes on it. */
const KNOB = "conn";

/** A /api/health reading whose credentials the daemon accepted and which lists no dropped setting. */
const HEALTHY = { reachable: true, ready: true, connected: true, credentials_ok: true, dropped_settings: [] };

/** @typedef {{ field: string, value: string, name: string | null }} WrittenSetting */

/**
 * Two settings a daemon restart dropped, as `WrittenSetting` carries them.
 *
 * @type {WrittenSetting[]}
 */
const DROPPED = [
  { field: "filter", value: "42", name: "poly-sinc-gauss-xla" },
  { field: "rate", value: "352800", name: null },
];

let serial = 0;

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

/** Start a case with nothing wrong: SDM at DSD1024, accepted credentials, an empty report, a fresh track. */
async function quiet() {
  await reset({ chain: "sdm", mode: "2", sdmRate: DSD1024, pcmRate: PCM_8X });
  health.value = { ...HEALTHY };
  serial += 1;
  poll();
}

/**
 * A fresh health reading listing `dropped`, credentials accepted unless `refused`.
 *
 * @param {WrittenSetting[]} dropped
 * @param {boolean} [refused]
 */
const report = (dropped, refused = false) => {
  health.value = { ...HEALTHY, credentials_ok: !refused, dropped_settings: dropped.map((d) => ({ ...d })) };
};

/**
 * The knob's blink while the report lists `dropped`, on a quiet plate.
 *
 * @param {WrittenSetting[]} dropped
 */
const knobBlink = async (dropped) => {
  await quiet();
  report(dropped);
  return alertsNow.value.blinks.el.get(KNOB);
};

/**
 * The severities in the knob's popover while the credentials are refused and the report lists `dropped`.
 *
 * @param {WrittenSetting[]} dropped
 */
const knobNotes = async (dropped) => {
  await quiet();
  report(dropped, true);
  return alertNotes(KNOB).map((a) => a.sev);
};

test("test_dropped_settings_leave_the_knob_unlit", async () => {
  const unlit = await knobBlink([]);
  assert.equal(await knobBlink(DROPPED), unlit);
});

test("test_the_knobs_popover_holds_only_the_credentials_alert_while_settings_are_dropped", async () => {
  const credentialsOnly = await knobNotes([]);
  assert.deepEqual(await knobNotes(DROPPED), credentialsOnly);
});

test("test_an_emptied_report_takes_down_the_alert_it_raised", async () => {
  await quiet();
  report(DROPPED);
  const listing = faceplateAlerts().length;
  report([]);
  assert.equal(listing - faceplateAlerts().length, 1);
});
