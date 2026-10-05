// Store suite for hqptuner/static/store/faceplate/page/meter.js: what the page's Source section frames over the v1
// stream. Whether the meter or a no-stream line shows, the page's own Range, the dB scale it sets, the frequency axis to
// the source Nyquist, how many level bars the section draws, and whether the section is slim. What moves inside that
// frame, the trace, the bars and their readings, is the meter loop's scene and the painter's (store/meter/loop.js,
// components/faceplate/page/sourcepaint.js).
//
// The stream reaches the store at the wire: METER feed events through the EventSource fake
// (tests/js/support/eventsource.js), playback through fresh /api/status objects. The feed's clock is a fixed `() => 0`,
// so the feed never goes quiet. Prefs are written through their own setters over a fake storage; the plate through
// the window size the entry writes.
//
// Ticks are fractions of the plot: across from 0 Hz, down from full scale.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-page/meter.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { pageMeter } from "../../../../hqptuner/static/store/faceplate/page/meter.js";
import { engineStatus, matrixConfig } from "../../../../hqptuner/static/store/signals.js";
import { closeMeterFeed, openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { setMeterChannel, setMeterRange } from "../../../../hqptuner/static/store/ui/prefs.js";
import { setPageRange } from "../../../../hqptuner/static/store/ui/faceplate.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/view.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";

const FULL = { w: 1366, h: 1024 };
const SLIM = { w: 1080, h: 810 };

/**
 * A geometry event's data.
 *
 * @param {{ nyquist?: number, channels?: number, bins?: number }} [o]
 */
const geometry = ({ nyquist = 22050, channels = 2, bins = 1025 } = {}) => ({ nyquist, channels, bins });

/**
 * Open a fresh feed over one /api/status object, and send the geometry event unless it is null.
 *
 * @param {{ state?: string, geo?: object | null }} [o]
 */
function stream({ state = "2", geo = geometry() } = {}) {
  closeMeterFeed();
  useEventSource();
  engineStatus.value = { status: { state }, metering: true, metadata: { samplerate: "44100" } };
  openMeterFeed(() => 0);
  if (geo) lastStream()?.emit("geometry", geo);
}

/** @param {number} v */
const r4 = (v) => +v.toFixed(4);

beforeEach(() => {
  useStorage();
  matrixConfig.value = null;
  setMeterChannel("sum");
  setMeterRange("90");
  setPageRange("90");
  viewport.value = FULL;
  stream();
});

// --- which shows ---------------------------------------------------------------------------------------------------

test("test_a_playing_source_with_the_feed_open_shows_the_meter", () => {
  assert.equal(pageMeter().state, "live");
});

test("test_nothing_playing_shows_the_idle_line", () => {
  stream({ state: "0" });
  assert.equal(pageMeter().state, "idle");
});

// --- the page's range ----------------------------------------------------------------------------------------------

test("test_the_range_is_the_pages_own_range", () => {
  setPageRange("120");
  assert.equal(pageMeter().range, 120);
});

test("test_the_drawers_range_leaves_the_pages_range_standing", () => {
  setPageRange("60");
  setMeterRange("120");
  assert.equal(pageMeter().range, 60);
});

// --- the dB scale --------------------------------------------------------------------------------------------------

test("test_the_db_scale_ends_at_a_60_db_range", () => {
  setPageRange("60");
  assert.equal(pageMeter().db.at(-1)?.db, -60);
});

test("test_the_db_scale_ends_at_a_120_db_range", () => {
  setPageRange("120");
  assert.equal(pageMeter().db.at(-1)?.db, -120);
});

test("test_the_db_scale_runs_from_full_scale_on_top_to_the_floor_at_the_bottom", () => {
  const { db } = pageMeter();
  assert.deepEqual([db[0]?.db, db[0]?.at, db.at(-1)?.at], [0, 0, 1]);
});

// --- the frequency axis --------------------------------------------------------------------------------------------

test("test_the_nyquist_is_the_geometrys", () => {
  stream({ geo: geometry({ nyquist: 96000 }) });
  assert.equal(pageMeter().nyquist, 96000);
});

test("test_a_new_geometry_moves_the_nyquist", () => {
  stream({ geo: geometry({ nyquist: 96000 }) });
  lastStream()?.emit("geometry", geometry({ nyquist: 48000 }));
  assert.equal(pageMeter().nyquist, 48000);
});

test("test_the_frequency_axis_ends_at_the_source_nyquist", () => {
  stream({ geo: geometry({ nyquist: 48000 }) });
  assert.equal(pageMeter().freq.nyq.khz, 48);
});

test("test_the_frequency_axis_is_linear_across_the_spectrum", () => {
  stream({ geo: geometry({ nyquist: 48000 }) });
  const at = pageMeter().freq.ticks.find((t) => t.khz === 20)?.at;
  assert.equal(at === undefined ? NaN : r4(at), 0.4167);
});

// --- the bars ------------------------------------------------------------------------------------------------------

test("test_a_stereo_source_draws_two_bars", () => {
  assert.equal(pageMeter().channels, 2);
});

test("test_a_six_channel_source_draws_six_bars", () => {
  stream({ geo: geometry({ channels: 6 }) });
  assert.equal(pageMeter().channels, 6);
});

test("test_before_any_geometry_the_section_draws_two_bars", () => {
  stream({ geo: null });
  assert.equal(pageMeter().channels, 2);
});

test("test_a_new_geometry_redraws_the_bar_count", () => {
  stream({ geo: geometry({ channels: 6 }) });
  lastStream()?.emit("geometry", geometry({ channels: 8 }));
  assert.equal(pageMeter().channels, 8);
});

// --- slim ----------------------------------------------------------------------------------------------------------

test("test_the_section_is_slim_on_a_10_inch_plate_and_full_on_a_13_inch_plate", () => {
  viewport.value = SLIM;
  const ten = pageMeter().slim;
  viewport.value = FULL;
  assert.deepEqual([ten, pageMeter().slim], [true, false]);
});
