// Rendered suite for the VU meters in hqptuner/static/components/faceplate/page/SourceMeter.js: what the Source
// section's levels column draws under each Meters pick. Slim, at Compact and Normal, it draws the level bars under
// Levels and one VU meter per channel under VU, never both. Full, at Expanded, it draws the level bars and the VU
// meters both, whatever Meters holds. Where each needle points is painted each animation frame from the scene's
// readings (tests/js/store/meter/loop-vu.test.js); this suite covers which meters the column renders.
//
// Renders through preact-render-to-string over a live stereo stream reaching the store at the wire, as
// tests/js/components/faceplate-page/meter.test.js does. A level bar is an element of class `lvb`; a VU meter is an
// element carrying `data-testid="vu-meter"`. The Meters pick goes through the prefs store's setter, read off the module
// namespace with optional access, so a store without one fails these cases on their assertions.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/meter-vu.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { SourceMeter } from "../../../../hqptuner/static/components/faceplate/page/SourceMeter.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { closeMeterFeed, openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/plate.js";
import * as uiPrefs from "../../../../hqptuner/static/store/ui/prefs.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { fakeClock } from "../../support/clock.js";
import { attr, classes, elements } from "../../support/markup.js";

const FULL = { w: 1366, h: 1024 };
const SLIM = { w: 1080, h: 810 };
//: The channels the stream reports.
const CHANNELS = 2;

//: The two meters on offer, as the store holds them.
const LEVELS = "levels";
const VU = "vu";

/** @type {{ setMeters?(v: string): void }} */
const metersStore = uiPrefs;

/**
 * Pick the meter `v`.
 *
 * @param {string} v
 */
const pickMeters = (v) => metersStore.setMeters?.(v);

/** Open a fresh feed over one /api/status object at play, and send a stereo geometry event. */
function stream() {
  closeMeterFeed();
  useEventSource();
  engineStatus.value = { status: { state: "2" }, metering: true, metadata: { samplerate: "44100" } };
  openMeterFeed(fakeClock().clock);
  lastStream()?.emit("geometry", { nyquist: 22050, channels: CHANNELS, centers: [1000, 2000] });
}

const draw = () => elements(render(html`<${SourceMeter} />`));

/** The number of level bars drawn. */
const bars = () => draw().filter((e) => classes(e).includes("lvb")).length;

/** The number of VU meters drawn. */
const needles = () => draw().filter((e) => attr(e, "data-testid") === "vu-meter").length;

/** The level bars and VU meters drawn, as counts. */
const meters = () => ({ bars: bars(), vu: needles() });

beforeEach(() => {
  useStorage();
  pickMeters(LEVELS);
  viewport.value = FULL;
  stream();
});

test("test_slim_under_the_vu_pick_draws_one_vu_meter_per_channel", () => {
  viewport.value = SLIM;
  pickMeters(VU);
  assert.equal(needles(), CHANNELS);
});

test("test_slim_under_the_vu_pick_draws_no_level_bars", () => {
  viewport.value = SLIM;
  pickMeters(VU);
  assert.equal(bars(), 0);
});

test("test_full_under_the_levels_pick_draws_both_the_level_bars_and_the_vu_meters", () => {
  pickMeters(LEVELS);
  assert.deepEqual(meters(), { bars: CHANNELS, vu: CHANNELS });
});

test("test_full_under_the_vu_pick_draws_both_the_level_bars_and_the_vu_meters", () => {
  pickMeters(VU);
  assert.deepEqual(meters(), { bars: CHANNELS, vu: CHANNELS });
});
