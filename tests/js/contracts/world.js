// The meter painting stack, replayed on a virtual clock. No test() and no assert lives here.
//
// `replay` runs one schedule (tests/js/contracts/schedules.js) through the real thing: the feed store fed `frame` events
// through the EventSource fake, the meter loop on a clock whose animation frames run only when the replay hands them out,
// at the schedule's paint times, the spectrogram's history, and the Source drawer's real painter on a pixel canvas. Each
// event is handed to the page at its own wall time, the clock reading that time while the page's handler runs (D-13),
// and the events due by a paint's time are delivered, each at its own, before that paint. After each paint the replay
// hands the caller what the paint left: the wall time and `dt`, the playhead, the scene the meters and the spectrum were
// handed, and the frames delivered so far. The caller reads the picture and the history through the world it is handed.
//
// Every frame carries an identity the scene shows back: the spectrum bins of frame `id` hold its id in the first two bins
// and a level pattern of its own in the rest, and its peak and RMS are its own, so a test says which frame a paint showed
// and which levels the meters read. The wire is the real one: `at` and `n` in samples, bins base64, two bytes a bin.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { SPEC_SIZE, meterPainter } from "../../../hqptuner/static/components/faceplate/drawers/source/paint.js";
import { setSpectrogramSpan } from "../../../hqptuner/static/store/faceplate/drawers/source.js";
import { openStage } from "../../../hqptuner/static/store/faceplate/view.js";
import { initApodHistory } from "../../../hqptuner/static/store/apodhistory.js";
import { initMeterFeed } from "../../../hqptuner/static/store/meter/feed.js";
import { initMeterLoop, onMeterPaint } from "../../../hqptuner/static/store/meter/loop.js";
import { setSpectrumOffset } from "../../../hqptuner/static/store/meter/delay.js";
import { playhead } from "../../../hqptuner/static/store/meter/playhead.js";
import { initSpectrogram, spectrogramRange } from "../../../hqptuner/static/store/meter/spectrogram.js";
import { engineStatus } from "../../../hqptuner/static/store/signals.js";
import {
  METER_RANGES,
  setApodWindow,
  setMeterChannel,
  setMeterRange,
} from "../../../hqptuner/static/store/ui/prefs.js";
import { newTrack, poll } from "../support/apodpolls.js";
import { lastStream, useEventSource } from "../support/eventsource.js";
import { dropStorage, useStorage } from "../support/storage.js";
import { pixelCanvas, TOKENS } from "./picture.js";

/** @typedef {import("./schedules.js").Schedule} Schedule */
/**
 * One frame the replay delivered: its identity, where it starts and how long it lasts (playback, ms) and the peak and RMS
 * it carries (dBFS).
 *
 * @typedef {{ id: number, at: number, ms: number, peak: number, rms: number }} Frame
 */
/**
 * What a paint handed the meters and the spectrum: the identity of the frame whose bins the scene holds, -1 when it holds
 * none, the peak and RMS of channel 0, and whether the paint restarted.
 *
 * @typedef {{ id: number, peak: number, rms: number, restart: boolean }} Heard
 */
/**
 * What the replay hands the caller after each paint.
 *
 * @typedef {object} Paint
 * @property {number} i  index into the schedule's paints
 * @property {number} t  wall, ms
 * @property {number} dt  wall, ms, since the paint before it, 0 for the first
 * @property {number | null} head  playback, ms: the playhead after the paint
 * @property {Heard | null} heard  null when the paint handed the painters nothing
 */
/**
 * The stack as a caller reads it.
 *
 * @typedef {object} World
 * @property {Frame[]} frames  delivered so far, oldest first
 * @property {import("./picture.js").PixelCanvas} canvas  the spectrogram's pixels
 * @property {() => import("./picture.js").PixelCanvas} fresh  the pixels one whole fresh paint of the stores' state draws
 * @property {number} span  playback, ms: the spectrogram window
 */

//: The bins a frame carries: two hold its identity, the rest a level pattern of its own.
const BINS = 10;
const ID_BINS = 2;
const BYTE = 256;
const COUNTS_PER_DB = 2;
const MS_PER_S = 1000;
//: The window the replay runs at, s: the finest the page offers.
const WINDOW = "30";
const STRIP_WIDTH = 600;

//: The animation frame the loop asked for, run when the replay hands it out.
const frames = {
  /** @type {((now: number) => void) | null} */
  next: null,
  now: 0,
};
/** @type {import("../../../hqptuner/static/lib/clock.js").Clock} */
const clock = {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
  setInterval: () => 0,
  clearInterval: () => undefined,
  requestAnimationFrame: (fn) => {
    frames.next = fn;
    return 0;
  },
  queueMicrotask: (fn) => fn(),
  now: () => frames.now,
};

/**
 * The wire's bins for frame `id`: its id in the first two bins, one 0.5 dB count each, then a level pattern that differs
 * from one frame to the next.
 *
 * @param {number} id
 * @returns {string}  base64
 */
function wireBins(id) {
  const counts = [id % BYTE, Math.floor(id / BYTE) % BYTE];
  for (let k = 0; k < BINS - ID_BINS; k++) counts.push(((id * 5 + k * 13) % 90) * COUNTS_PER_DB);
  return Buffer.from(counts.flatMap((c) => [c, 0])).toString("base64");
}

/**
 * The frame identity a scene's bins hold; -1 when they hold none.
 *
 * @param {Float32Array} bins  dBFS
 * @returns {number}
 */
function idOf(bins) {
  const [lo, hi] = [-bins[0] * COUNTS_PER_DB, -bins[1] * COUNTS_PER_DB];
  return Number.isInteger(lo) && Number.isInteger(hi) ? lo + hi * BYTE : -1;
}

/**
 * The peak and RMS frame `id` carries, dBFS: a table by id.
 *
 * @param {number} id
 */
const levelsOf = (id) => ({ peak: -6 - ((id * 7) % 24), rms: -30 - ((id * 11) % 20) });

/** Put the stores where a fresh playing track with a feed open finds them, on the replay's clock. */
function open(/** @type {Schedule} */ { rate, delay, geometry }, span = "full") {
  engineStatus.value = { metering: false };
  frames.next = null;
  useEventSource();
  useStorage();
  setApodWindow(WINDOW);
  setSpectrumOffset(String(delay));
  setMeterChannel("sum");
  setMeterRange(METER_RANGES[0] ?? "");
  setSpectrogramSpan(span);
  openStage.value = "source";
  initApodHistory();
  initSpectrogram();
  newTrack();
  poll();
  initMeterFeed(clock);
  initMeterLoop(clock);
  if (!geometry) sendGeometry(rate);
}

/** Send the geometry event for `rate` down the stream the page holds. @param {number} rate */
function sendGeometry(rate) {
  lastStream()?.emit("geometry", { rate, nyquist: rate / 2, channels: 1, bins: BINS });
}

//: What a schedule delivers at one wall time, in order: the geometry, then the Status sample, then the frame.
const ORDER = { geometry: 0, status: 1, frame: 2 };

/**
 * @typedef {{ kind: "geometry", t: number, rate: number } | { kind: "status", t: number, fields: Record<string, string> }
 *   | { kind: "frame", t: number, n: number, at?: number }} Arrival
 */

/**
 * Everything the schedule delivers, in the order it reaches the page.
 *
 * @param {Schedule} schedule
 * @returns {Arrival[]}
 */
function arrivals({ feed, geometry = [], status = [] }) {
  /** @type {Arrival[]} */
  const all = [
    ...geometry.map((g) => /** @type {const} */ ({ ...g, kind: "geometry" })),
    ...status.map((s) => /** @type {const} */ ({ ...s, kind: "status" })),
    ...feed.map((f) => /** @type {const} */ ({ ...f, kind: "frame" })),
  ];
  return all.sort((x, y) => x.t - y.t || ORDER[x.kind] - ORDER[y.kind]);
}

/**
 * What hands the page one arrival at its own wall time (D-13): the clock reads that time while the page's handler runs.
 * A frame the schedule gives no `at` follows the one before it.
 *
 * @param {number} first  Hz, the rate before any geometry event
 * @param {Frame[]} delivered  gets each frame as it is handed over
 * @returns {(event: Arrival) => void}
 */
function handler(first, delivered) {
  let rate = first;
  let samples = 0;
  return (event) => {
    frames.now = event.t;
    if (event.kind === "geometry") {
      rate = event.rate;
      sendGeometry(rate);
    } else if (event.kind === "status") {
      poll(event.fields);
    } else {
      const id = delivered.length;
      const { n } = event;
      const at = event.at ?? samples;
      const levels = levelsOf(id);
      lastStream()?.emit("frame", { channels: [{ ...levels, bins: wireBins(id) }], at, n });
      delivered.push({ id, at: (at * MS_PER_S) / rate, ms: (n * MS_PER_S) / rate, ...levels });
      samples = at + n;
    }
  };
}

/**
 * Replay `schedule`, calling `observe` after each paint.
 *
 * @param {Schedule} schedule
 * @param {(paint: Paint, world: World) => void} observe
 * @param {string} [span]  the spectrogram's frequency span: full, half or quarter
 */
export function replay(schedule, observe, span = "full") {
  open(schedule, span);
  const { paints } = schedule;
  const events = arrivals(schedule);
  /** @type {Frame[]} */
  const delivered = [];
  const hand = handler(schedule.rate, delivered);
  const canvas = pixelCanvas(SPEC_SIZE.width, SPEC_SIZE.height);
  const tokens = /** @type {CSSStyleDeclaration} */ (/** @type {unknown} */ (TOKENS));
  const asElement = (/** @type {import("./picture.js").PixelCanvas} */ c) =>
    /** @type {HTMLCanvasElement} */ (/** @type {unknown} */ (c));
  const dispose = meterPainter(asElement(canvas), asElement(pixelCanvas(STRIP_WIDTH, 1)), tokens);
  /** @type {Heard | null} */
  let heard = null;
  const unsubscribe = onMeterPaint((scene) => {
    const ch = scene.channels[0];
    heard = ch ? { id: idOf(ch.bins), peak: ch.peak, rms: ch.rms, restart: scene.restart } : null;
  });
  /** @type {World} */
  const world = {
    frames: delivered,
    canvas,
    span: Number(WINDOW) * MS_PER_S,
    fresh: () => {
      const again = pixelCanvas(SPEC_SIZE.width, SPEC_SIZE.height);
      meterPainter(asElement(again), asElement(pixelCanvas(STRIP_WIDTH, 1)), tokens)();
      return again;
    },
  };
  let next = 0;
  let before = 0;
  paints.forEach((t, i) => {
    for (; next < events.length && events[next].t <= t; next++) {
      hand(events[next]);
    }
    heard = null;
    frames.now = t;
    const run = frames.next;
    frames.next = null;
    if (run) run(t);
    observe({ i, t, dt: i ? t - before : 0, head: playhead.value, heard }, world);
    before = t;
  });
  unsubscribe();
  dispose();
  engineStatus.value = { metering: false };
  dropStorage();
}

/** The history the painter draws from and the edge it draws against, as the stores hold them now. */
export function drawn() {
  const { slices, edge } = spectrogramRange.value;
  return { slices, edge };
}
