// Store suite for what the Source drawer's painter reads on every paint from
// hqptuner/static/store/faceplate/drawers/source.js, under timing rule 9: a paint allocates nothing except
// the strings a DOM or canvas write needs. While nothing behind the meter has changed, a second read hands back the very
// object the first one did. The apodizing strip is the painter's: each paint hands back the strip it was handed last,
// and gets that strip back filled with its own columns, edge moved or not. Reading the same object back is the one
// sign of that the store's public surface shows; no case measures memory or time. The strip is the caller's, sized to
// its column count; the strip's call is read off the module namespace, typed with the strip handed in, so it
// type-checks before the store takes one.
//
// The stream reaches the store at the wire, as in tests/js/store/faceplate/drawers-source/drawers-source.test.js:
// meter feed events through the EventSource fake (tests/js/support/eventsource.js), playback through a fresh
// /api/status object, on a Ready connection. The feed's clock is a fake one no case advances, so the feed never goes
// quiet between two reads.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/drawers-source/drawers-source-reuse.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import * as sourceStore from "../../../../../hqptuner/static/store/faceplate/drawers/source.js";
import { engineStatus, health, matrixConfig } from "../../../../../hqptuner/static/store/signals.js";
import { closeMeterFeed, openMeterFeed } from "../../../../../hqptuner/static/store/meter/feed.js";
import { setApodWindow, setMeterChannel } from "../../../../../hqptuner/static/store/ui/prefs.js";
import { lastStream, useEventSource } from "../../../support/eventsource.js";
import { useStorage } from "../../../support/storage.js";
import { fakeClock } from "../../../support/clock.js";

const { sourceMeter } = sourceStore;

/**
 * The strip's events per column as a paint asks for it: the strip it hands in, one column a level, filled and returned.
 *
 * @type {(
 *   bins: Array<{ ms: number, n: number, at: number | null }>, span: number, end: number, strip: Uint8Array,
 * ) => Uint8Array}
 */
const stripEvents = /** @type {any} */ (sourceStore).stripEvents;

/** The lifecycle generation every /api/health reply below carries. */
const GEN = 3;

/** A 96 kHz source's geometry: Nyquist in Hz, two channels. */
const GEOMETRY = { nyquist: 48000, channels: 2, bins: 1025 };

/**
 * One bin of the apodizing history.
 *
 * @param {number} ms  the playback it observed, ms
 * @param {number} n  the events it counted
 * @param {number} at  its stamp, where its playback ends: playback, ms
 */
const bin = (ms, n, at) => ({ ms, n, at });

/**
 * Three stamped bins, one a second, 3 s of playback ending at 3 s: three events, none, three. A bin-wide column over a
 * bin of three events reads 3 and over an empty one 0, as
 * tests/js/store/faceplate/drawers-source/drawers-source.test.js pins.
 */
const BINS = [bin(1000, 3, 1000), bin(1000, 0, 2000), bin(1000, 3, 3000)];
/** The strip's window, playback, ms, and its pixel columns: one column a bin wide. */
const SPAN_MS = 2000;
const COLS = 2;
/** One paint's right edge and the next one's, a bin later: playback, ms. */
const EARLIER_END_MS = 2000;
const LATER_END_MS = 3000;
/**
 * The columns at the later edge: the window (1000, 3000] ms holds the empty bin, then the second three. Each differs
 * from the earlier edge's column, 3 then 0, so a strip still holding the earlier paint's columns fails in both.
 */
const LATER_COLUMNS = [0, 3];

beforeEach(() => {
  health.value = { phase: "Ready", generation: GEN };
  useStorage();
  matrixConfig.value = null;
  setApodWindow("60");
  setMeterChannel("sum");
  closeMeterFeed();
  useEventSource();
  engineStatus.value = { status: { state: "2" }, metering: true, metadata: { samplerate: "96000" } };
  openMeterFeed(fakeClock().clock);
  lastStream()?.emit("geometry", GEOMETRY);
});

// Break: sourceMeter() builds a fresh meter object, with its axes and tick lists, on every call.
test("test_reading_the_source_meter_twice_with_nothing_changed_hands_back_the_same_meter", () => {
  const first = sourceMeter();
  assert.equal(sourceMeter(), first);
});

// The painter's edge moves on every paint. Each paint hands in the strip the paint before it filled, and gets it back
// filled with this paint's columns.

// Break: stripEvents ignores the strip handed back and allocates a new one on every call.
test("test_a_paint_with_the_edge_moved_gets_back_the_strip_it_handed_in", () => {
  const strip = new Uint8Array(COLS);
  stripEvents(BINS, SPAN_MS, EARLIER_END_MS, strip);
  assert.equal(stripEvents(BINS, SPAN_MS, LATER_END_MS, strip), strip);
});

// Break: stripEvents leaves the strip handed back holding the earlier edge's columns, [3, 0], or adds this paint's
// columns onto them, [3, 3]; or ignores it and fills a new one.
test("test_a_paint_with_the_edge_moved_finds_the_strip_it_handed_in_holding_its_own_columns", () => {
  const strip = new Uint8Array(COLS);
  stripEvents(BINS, SPAN_MS, EARLIER_END_MS, strip);
  stripEvents(BINS, SPAN_MS, LATER_END_MS, strip);
  assert.deepEqual(Array.from(strip), LATER_COLUMNS);
});
