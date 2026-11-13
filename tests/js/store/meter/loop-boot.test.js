// Boot suite for the meter loop (hqptuner/static/store/meter/loop.js): once the app has started in a browser, the loop
// runs. While the meter feed is open, a painter subscribed through onMeterPaint is handed each paint's `dt`, the wall
// time since the paint before it, in seconds.
//
// The app boots through `boot(doc, clock)` of its entry module (hqptuner/static/app.js) on the page and clock
// tests/js/support/bootpage.js builds, whose animation frames run only when the case hands them out, at the wall
// times in FRAME_TIMES_MS, so paints are unevenly spaced. Metering and playback reach the stores through fresh /api/status objects on engineStatus
// written by the poll seam (tests/js/support/apodpolls.js); the feed is the EventSource fake, its stamps the tables in
// tests/js/support/meterfeed.js. What the loop does with each paint is the store suites' (loop.test.js,
// loop-painters.test.js); this suite asks only that the started app runs it, and only while the engine plays: once
// the engine stops, a painter is handed the one cleared scene, `dt` 0, and no paint after it
// (docs/superpowers/specs/meter-loop-idle-design.md, Modules).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/loop-boot.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { onMeterPaint } from "../../../../hqptuner/static/store/meter/loop.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { bootPage } from "../../support/bootpage.js";
import { lastStream } from "../../support/eventsource.js";
import { STOPPED, newTrack, poll } from "../../support/apodpolls.js";
import { CONTIGUOUS_44K, RATE_44K, geometry, play } from "../../support/meterfeed.js";

/** @typedef {import("../../../../hqptuner/static/store/meter/loop.js").MeterScene} MeterScene */

/** Wall time, ms on the page, of each animation frame the case hands out, in turn: 16, 33, 250, 17 and 1000 ms apart. */
const FRAME_TIMES_MS = [5000, 5016, 5049, 5299, 5316, 6316];

/** One second, in ms. */
const SECOND_MS = 1000;

/** Wall times in ms rounded to a millionth of a ms. */
const same = (/** @type {number} */ ms) => Math.round(ms * 1e6) / 1e6;

test("test_once_the_app_has_started_each_paint_hands_its_painters_the_wall_time_since_the_paint_before_it", async (t) => {
  const { start, runFrame, cleanup } = bootPage();
  t.after(cleanup);
  start();
  /** @type {number[]} wall time, s, each paint handed */
  const handed = [];
  const unsubscribe = onMeterPaint((/** @type {unknown} */ _scene, /** @type {number} */ dt) => void handed.push(dt));
  t.after(unsubscribe);
  engineStatus.value = { metering: false };
  newTrack();
  poll();
  lastStream()?.emit("geometry", geometry(RATE_44K));
  play(CONTIGUOUS_44K);
  for (const ms of FRAME_TIMES_MS) runFrame(ms);
  const gaps = FRAME_TIMES_MS.slice(1).map((ms, i) => same(ms - FRAME_TIMES_MS[i]));
  assert.deepEqual(
    handed.slice(1).map((dt) => same(dt * SECOND_MS)),
    gaps,
  );
});

/** Wall time, ms on the page, of the animation frames the case hands out before the engine stops. */
const PLAYING_TIMES_MS = [7000, 7016, 7049];

/** Wall time, ms on the page, of the animation frames the case hands out once the engine has stopped. */
const STOPPED_TIMES_MS = [7299, 7316, 8316];

/** Channels, and bins in each, of the feed the stopping case plays: more than one of each, so the claim reaches all. */
const STEREO = 2;
const BINS = 4;

/** One channel of a scene with nothing heard: every level, and every one of its bins, at -Infinity dBFS. */
const SILENT = { peak: -Infinity, rms: -Infinity, bins: Array.from({ length: BINS }, () => -Infinity) };

/** The scene a painter is handed when the engine stops: no time passed, restarted, nothing heard on any channel. */
const CLEARED = { dt: 0, restart: true, channels: Array.from({ length: STEREO }, () => SILENT) };

test("test_once_the_app_has_started_a_stopped_engine_hands_painters_one_cleared_scene_and_no_paint_after_it", async (t) => {
  const { start, runFrame, cleanup } = bootPage();
  t.after(cleanup);
  start();
  /** @type {Array<{ dt: number, restart: boolean, channels: Array<{ peak: number, rms: number, bins: number[] }> }>} */
  const handed = [];
  const unsubscribe = onMeterPaint(
    (/** @type {MeterScene} */ scene, /** @type {number} */ dt) =>
      void handed.push({
        dt,
        restart: scene.restart,
        channels: scene.channels.map((c) => ({ peak: c.peak, rms: c.rms, bins: Array.from(c.bins) })),
      }),
  );
  t.after(unsubscribe);
  engineStatus.value = { metering: false };
  newTrack();
  poll();
  lastStream()?.emit("geometry", geometry(RATE_44K, STEREO, BINS));
  play(CONTIGUOUS_44K, STEREO);
  for (const ms of PLAYING_TIMES_MS) runFrame(ms);
  const painted = handed.length;
  poll({ state: STOPPED });
  for (const ms of STOPPED_TIMES_MS) runFrame(ms);
  assert.deepEqual([painted > 0, handed.slice(painted)], [true, [CLEARED]]);
});
