// Behavioral suite for the faceplate's alert list (hqptuner/static/store/faceplate/alerts.js) and three saves the
// server can refuse: a profile description, a favorite star and the narrowing facets. A refused save raises one alert
// on the list, and that alert comes down when the same area next saves successfully. Where the line shows, under the
// top bar, and what a tap on it does, are pinned in
// tests/js/components/faceplate-alerts/plate-unread-saves.test.js.
//
// Driven at the wire: each save goes through the store's own public API, and the three REST paths are answered by the
// route table in tests/js/support/wire/unreadsaves.js, which refuses one area's saves when a case asks it to. The plate
// starts quiet as tests/js/store/faceplate-alerts/alerts-dropped.test.js starts it: SDM at DSD1024, a healthy reading with
// nothing dropped, a fresh track at a healthy speed. The alert's kind and sentence are the implementation's and the
// owner's, so no case names them: the list is read for how many alerts it holds.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-alerts/alerts-unread-saves.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { health, engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { initHealth } from "../../../../hqptuner/static/store/health.js";
import { faceplateAlerts } from "../../../../hqptuner/static/store/faceplate/alerts.js";
import { reset, DSD1024, PCM_8X } from "../../support/shaperfit-fixtures.js";
import { fakeClock } from "../../support/clock.js";
import { stagingWire, quiesce } from "../../support/wire/wire.js";
import { AREAS, save, saveRoutes, resetSaves } from "../../support/wire/unreadsaves.js";

initHealth(fakeClock().clock);

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** A /api/health reading whose credentials the daemon accepted and which lists no dropped setting. */
const HEALTHY = { reachable: true, ready: true, connected: true, credentials_ok: true, dropped_settings: [] };

let serial = 0;

beforeEach(async () => {
  await reset({ chain: "sdm", mode: "2", sdmRate: DSD1024, pcmRate: PCM_8X });
  const wire = stagingWire({ routes: saveRoutes });
  await resetSaves();
  await quiesce(wire);
  health.value = { ...HEALTHY };
  serial += 1;
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
});

afterEach(() => {
  env.fetch = REAL_FETCH;
});

for (const area of AREAS) {
  test(`test_a_successful_${area}_save_takes_down_the_alert_its_refused_save_raised`, async () => {
    await save(area, true);
    const listing = faceplateAlerts().length;
    await save(area, false);
    assert.equal(listing - faceplateAlerts().length, 1);
  });
}
