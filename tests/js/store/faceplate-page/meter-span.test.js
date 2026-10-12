// Store suite for the frequency span on hqptuner/static/store/faceplate/page/meter.js: at a span, the frequency axis the
// page's Source section frames follows the top of the view, Full, a half or a quarter of the band up to the source
// Nyquist. Its ticks sit at their frequency's share of the view, a tick above the top of the view is dropped, the
// right-edge label reads the top of the view in kHz, and the narrowest view of a 44.1 kHz source still carries ticks
// inside it. The cases read the grid lines as drawn on the frame's ticks, so where a tick sits is where its line sits.
// What the span does to the spectrum's columns is tests/js/store/meter/loop-span.test.js's.
//
// The stream reaches the store at the wire, as in tests/js/store/faceplate-page/meter.test.js: meter feed events through
// the EventSource fake, playback through fresh /api/status objects. The span is set through the view store's setter.
// Ticks are fractions of the plot across from 0 Hz.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-page/meter-span.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { pageMeter } from "../../../../hqptuner/static/store/faceplate/page/meter.js";
import { engineStatus, matrixConfig } from "../../../../hqptuner/static/store/signals.js";
import { closeMeterFeed, openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { setFreqSpan } from "../../../../hqptuner/static/store/faceplate/view.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/plate.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { fakeClock } from "../../support/clock.js";

const FULL_PLATE = { w: 1366, h: 1024 };

// The spans, as the store holds them: the whole band, its lower half, its lower quarter.
const FULL = "full";
const HALF = "half";
const QUARTER = "quarter";

// Source Nyquists, in Hz: a 44.1, a 96 and a 192 kHz source.
const NYQ_44 = 22050;
const NYQ_96 = 48000;
const NYQ_192 = 96000;

//: The top of the half view of a 96 kHz source, in kHz.
const HALF_OF_96_KHZ = 24;
//: The top of the quarter view of a 96 kHz source, in kHz.
const QUARTER_OF_96_KHZ = 12;
//: The top of the quarter view of a 44.1 kHz source, in kHz.
const QUARTER_OF_44_KHZ = 5.5125;

/**
 * Open a fresh feed over one /api/status object, and send a geometry event at Nyquist `nyquist`.
 *
 * @param {number} nyquist
 */
function stream(nyquist) {
  closeMeterFeed();
  useEventSource();
  engineStatus.value = { status: { state: "2" }, metering: true, metadata: { samplerate: String(nyquist * 2) } };
  openMeterFeed(fakeClock().clock);
  lastStream()?.emit("geometry", { nyquist, channels: 2, bins: 1025 });
}

/**
 * The frame's frequency ticks at span `span` over a source at Nyquist `nyquist`.
 *
 * @param {string} span
 * @param {number} nyquist
 * @returns {{ khz: number, at: number }[]}
 */
function ticksAt(span, nyquist) {
  setFreqSpan(span);
  stream(nyquist);
  return pageMeter().freq.ticks;
}

/** @param {number} v */
const r4 = (v) => +v.toFixed(4);

beforeEach(() => {
  useStorage();
  matrixConfig.value = null;
  setFreqSpan(FULL);
  viewport.value = FULL_PLATE;
});

test("test_a_frequency_tick_sits_at_its_frequencys_share_of_the_view", () => {
  const ticks = ticksAt(HALF, NYQ_96);
  assert.deepEqual(
    ticks.map((t) => r4(t.at * HALF_OF_96_KHZ)),
    ticks.map((t) => r4(t.khz)),
  );
});

test("test_a_tick_above_the_top_of_the_view_is_dropped", () => {
  /** @param {{ khz: number }[]} ticks */
  const above = (ticks) => ticks.filter((t) => t.khz > QUARTER_OF_96_KHZ).length > 0;
  const full = above(ticksAt(FULL, NYQ_96));
  assert.deepEqual([full, above(ticksAt(QUARTER, NYQ_96))], [true, false]);
});

for (const { span, nyquist, khz } of [
  { span: HALF, nyquist: NYQ_192, khz: 48 },
  { span: QUARTER, nyquist: NYQ_96, khz: QUARTER_OF_96_KHZ },
]) {
  test(`test_the_right_edge_label_reads_${khz}_khz_at_the_${span}_view_of_a_${nyquist}_hz_nyquist`, () => {
    setFreqSpan(span);
    stream(nyquist);
    assert.equal(pageMeter().freq.nyq.khz, khz);
  });
}

test("test_the_quarter_view_of_a_44_1_khz_source_carries_ticks_inside_it", () => {
  const inside = ticksAt(QUARTER, NYQ_44).filter(
    (t) => t.khz > 0 && t.at < 1 && r4(t.at * QUARTER_OF_44_KHZ) === r4(t.khz),
  );
  assert.equal(inside.length >= 2, true);
});
