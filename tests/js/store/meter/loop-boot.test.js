// Boot suite for the meter loop (hqptuner/static/store/meter/loop.js): once the app has started in a browser, the loop
// runs. While the meter feed is open, a painter subscribed through onMeterPaint is handed each paint's `dt`, the wall
// time since the paint before it, in seconds.
//
// The app boots by importing its entry module (hqptuner/static/app.js) into the page tests/js/support/bootpage.js
// installs, whose animation frames run only when the case hands them out, at the wall times in FRAME_TIMES_MS, so
// paints are unevenly spaced. Metering and playback reach the stores through fresh /api/status objects on engineStatus
// written by the poll seam (tests/js/support/apodpolls.js); the feed is the EventSource fake, its stamps the tables in
// tests/js/support/meterfeed.js. What the loop does with each paint is the store suites' (loop.test.js,
// loop-painters.test.js); this suite asks only that the started app runs it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/loop-boot.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { onMeterPaint } from "../../../../hqptuner/static/store/meter/loop.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { installBootPage } from "../../support/bootpage.js";
import { lastStream } from "../../support/eventsource.js";
import { newTrack, poll } from "../../support/apodpolls.js";
import { CONTIGUOUS_44K, RATE_44K, geometry, play } from "../../support/meterfeed.js";

/** Wall time, ms on the page, of each animation frame the case hands out, in turn: 16, 33, 250, 17 and 1000 ms apart. */
const FRAME_TIMES_MS = [5000, 5016, 5049, 5299, 5316, 6316];

/** One second, in ms. */
const SECOND_MS = 1000;

/** Wall times in ms rounded to a millionth of a ms. */
const same = (/** @type {number} */ ms) => Math.round(ms * 1e6) / 1e6;

test("test_once_the_app_has_started_each_paint_hands_its_painters_the_wall_time_since_the_paint_before_it", async (t) => {
  const { runFrame, cleanup } = installBootPage();
  t.after(cleanup);
  await import("../../../../hqptuner/static/app.js");
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
