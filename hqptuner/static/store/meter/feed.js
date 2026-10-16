// The meters' connection to /api/meter/feed (api/routes/meter.py), held open
// on every page while metering is available (initMeterFeed), so the
// spectrogram's history runs unbroken whichever page is up. A `geometry` event
// describes the frames that follow it, its `rate` the metering rate in Hz; each
// `frame` event is decoded once, stamped with that geometry and queued for the
// meter loop (loop.js), which paces the frames out to the meters and the
// spectrogram's history. A frame the loop never takes still reaches the
// history: the oldest frames past MAX_PENDING_MS of playback (a hidden page runs
// no animation frames), and every frame queued when playback stops.
//
// Each `frame` event carries its playback stamp in whole samples at the
// geometry's rate: `at`, the sample it starts at counted from the feed's reset,
// and `n`, the samples it covers. The store tests each event against the one
// before it in samples, before any conversion: an event whose `at` is not the
// previous `at + n` begins a break, and so does the first event of a newly
// opened feed. So does the first event after any
// `geometry` event, even when its `at` follows on: the sample count runs on
// across a geometry change, so a count at one rate is not a time at another.
// It then converts both to ms at the rate, once, so every queued frame carries
// `at` and `ms` in playback ms. The end of the last frame queued since the feed
// opened is the feed's edge (feedEdge), the playback stamp data arriving on
// another time base takes at the moment it arrives.
//
// The feed is silent when the engine plays and no frame has come for QUIET_MS
// since the feed opened, playback started, or the last frame, whichever is
// latest. The clock is the Clock openMeterFeed() is handed (lib/clock.js), read
// through its monotonic `now`, since it measures an interval and nothing else.
import { signal, effect } from "@preact/signals";
import { PLATFORM } from "../../lib/clock.js";
import { decodeBins } from "../../model/gauges/meter/meter.js";
import { engineStatus, PLAYING } from "../signals.js";
import { metering } from "../actions.js";
import { addSpectrumFrame } from "./spectrogram.js";

const FEED = "/api/meter/feed";
// Wall time, ms, the open feed may send nothing while the engine plays before it counts as silent.
const QUIET_MS = 2000;
// Playback the queue holds for a loop that has not drained it, ms: the longest
// delay the loop paces at, and a second past it.
const MAX_PENDING_MS = 6000;
const MS_PER_S = 1000;

/** @typedef {import("../../lib/clock.js").Clock} Clock */
/**
 * A `geometry` event: the metering rate, the Nyquist frequency, and the channel and bin counts of the frames after it.
 *
 * @typedef {object} Geometry
 * @property {number} rate  metering rate, whole Hz: the samples per second `at` and `n` count
 * @property {number} nyquist  Hz
 * @property {number} channels
 * @property {number} bins
 */
/** @typedef {import("../../model/gauges/meter/meter.js").MeterFrame} MeterFrame */
/**
 * A `frame` event as the wire sends it.
 *
 * @typedef {object} WireFrame
 * @property {Array<{ peak: number, rms: number, bins: string }>} channels
 * @property {number} at  playback, whole samples at the geometry's rate: where the event starts, from the feed's reset
 * @property {number} n  playback, whole samples at the geometry's rate: how long the event lasts
 */

export const meterGeometry = signal(/** @type {Geometry | null} */ (null));
/** Whether a feed is open, from openMeterFeed() until closeMeterFeed(). */
export const meterFeedOpen = signal(false);

/** @type {EventSource | null} */
let source = null;
/** @type {(() => void) | null} */
let unwatch = null;
/** @type {Clock} */
let clock = PLATFORM;
/** Wall time, ms on `clock`: when the feed opened, playback started or the last frame came, whichever is latest. */
let since = 0;
/** @type {MeterFrame[]} */
let pending = [];
/**
 * The stamp of the last event the open feed sent, in whole samples at its geometry's rate; null until one arrives.
 *
 * @type {{ at: number, n: number } | null}
 */
let prev = null;
/** Whether a `geometry` event has arrived since the last frame: the next frame begins a break. */
let regeometried = false;
/**
 * Playback, ms: where the last frame the open feed queued ends, kept after the loop takes it; null until one is queued.
 *
 * @type {number | null}
 */
let edge = null;

const playing = () => Number(((engineStatus.value || {}).status || {}).state) === PLAYING;

/**
 * A wire frame with its bins decoded to dBFS and its stamp converted to playback ms at the geometry's rate, marked as
 * beginning a break when its `at` is not where the event before it ended, compared in whole samples, or when it is the
 * first after a `geometry` event: the sample count runs on across a geometry change, so a count at one rate is not a
 * time at another.
 *
 * @param {WireFrame} wire
 * @returns {MeterFrame}
 */
function decode(wire) {
  const geo = meterGeometry.peek();
  const brk = regeometried || prev === null || wire.at !== prev.at + prev.n;
  regeometried = false;
  prev = { at: wire.at, n: wire.n };
  const msPerSample = geo ? MS_PER_S / geo.rate : NaN;
  return {
    channels: wire.channels.map((ch) => ({ peak: ch.peak, rms: ch.rms, bins: decodeBins(ch.bins) })),
    at: wire.at * msPerSample,
    ms: wire.n * msPerSample,
    break: brk,
    geo,
  };
}

/**
 * Hand each of `frames` to the spectrogram's history whole, oldest first: its stamps, its break mark and the geometry
 * it arrived with go with it.
 *
 * @param {MeterFrame[]} frames
 */
export function toSpectrogram(frames) {
  frames.forEach((f) => addSpectrumFrame(f));
}

/**
 * Move the oldest frames to the spectrogram while the queue's playback, from its first frame's start to its last
 * frame's end by their stamps, runs past MAX_PENDING_MS. The newest frame always stays.
 */
function trim() {
  const last = pending[pending.length - 1];
  const end = (last.at ?? NaN) + last.ms; // playback, ms
  let n = 0;
  while (n < pending.length - 1 && end - (pending[n].at ?? NaN) > MAX_PENDING_MS) n++;
  if (n) toSpectrogram(pending.splice(0, n));
}

/**
 * Open the feed, dropping any feed and frames already held.
 *
 * @param {Clock} [next] the clock the feed's silence is measured on
 */
export function openMeterFeed(next = PLATFORM) {
  closeMeterFeed();
  clock = next;
  since = clock.now();
  meterGeometry.value = null;
  pending = [];
  prev = null;
  regeometried = false;
  edge = null;
  const es = new EventSource(FEED);
  es.addEventListener("geometry", (e) => {
    meterGeometry.value = JSON.parse(e.data);
    regeometried = true;
  });
  es.addEventListener("frame", (e) => {
    since = clock.now();
    const frame = decode(JSON.parse(e.data));
    edge = (frame.at ?? NaN) + frame.ms;
    pending.push(frame);
    trim();
  });
  source = es;
  let was = Number(((engineStatus.peek() || {}).status || {}).state) === PLAYING;
  unwatch = effect(() => {
    const on = playing();
    if (on && !was) since = clock.now();
    if (!on && pending.length) toSpectrogram(takeMeterFrames());
    was = on;
  });
  meterFeedOpen.value = true;
}

/** Close the feed, if one is open. */
export function closeMeterFeed() {
  if (source) source.close();
  source = null;
  if (unwatch) unwatch();
  unwatch = null;
  edge = null;
  meterFeedOpen.value = false;
}

/**
 * The feed's edge: where the last frame the open feed queued since it opened ends, whether or not the loop has taken
 * it; null while no feed is open or the open one has queued no frame.
 *
 * @returns {number | null}  playback, ms
 */
export function feedEdge() {
  return edge;
}

/**
 * The frames that arrived since the last call, oldest first; the queue is left empty.
 *
 * @returns {MeterFrame[]}
 */
export function takeMeterFrames() {
  const out = pending;
  pending = [];
  return out;
}

/** @type {(() => void) | null} */
let dispose = null;

/**
 * Register once the effect that holds the feed open while metering runs and
 * closed while it is off, and hand back its disposer.
 *
 * @param {Clock} [next] the clock each feed it opens is handed
 * @returns {() => void}
 */
export function initMeterFeed(next = PLATFORM) {
  if (dispose) return dispose;
  const registered = effect(() => (metering.value ? openMeterFeed(next) : closeMeterFeed()));
  dispose = registered;
  return registered;
}

/** Whether the engine plays and the open feed has sent nothing for too long. @returns {boolean} */
export function meterSilent() {
  return source !== null && playing() && clock.now() - since >= QUIET_MS;
}
