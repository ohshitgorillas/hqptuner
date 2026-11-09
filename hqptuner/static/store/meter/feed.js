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
// opened feed. So does the first event after any `geometry` event, even when
// its `at` follows on: the sample count runs on across a geometry change, so a
// count at one rate is not a time at another.
// It then converts both to ms at the rate, once, so every queued frame carries
// `at` and `ms` in playback ms. The end of the last frame queued since the feed
// opened is the feed's edge (feedEdge), the playback stamp data arriving on
// another time base takes at the moment it arrives.
//
// The feed is silent when the engine plays and no frame has come for QUIET_MS
// since the feed opened, playback started, or the last frame, whichever is
// latest. The quiet window runs on the Clock openMeterFeed() is handed
// (lib/clock.js), and its end is a signal, so whatever shows the silence redraws
// when the feed goes quiet or a frame comes again.
import { signal, effect, untracked } from "@preact/signals";
import { PLATFORM, quietWindow } from "../../lib/clock.js";
import { decodeBins } from "../../model/gauges/meter/meter.js";
import { playback } from "../core/readings.js";
import { metering } from "../actions.js";
import { addSpectrumFrame } from "./spectrogram.js";

const FEED = "/api/meter/feed";
// Wall time, ms, the open feed may send nothing while the engine plays before it counts as silent.
const QUIET_MS = 2000;
// Playback the queue holds for a loop that has not drained it, ms: a pacing
// delay of up to 5 s, and a second past it.
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
/** Whether QUIET_MS has passed on the open feed's clock since it opened, playback started or the last frame came. */
const quiet = signal(false);
/** The open feed's quiet window, restarted whenever `quiet` is cleared. */
let quietFor = quietWindow(QUIET_MS, () => (quiet.value = true), PLATFORM);

/** Clear the feed's silence and restart its quiet window. */
function hush() {
  quiet.value = false;
  quietFor.arm();
}
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
  quietFor = quietWindow(QUIET_MS, () => (quiet.value = true), next);
  hush();
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
    hush();
    const frame = decode(JSON.parse(e.data));
    edge = (frame.at ?? NaN) + frame.ms;
    pending.push(frame);
    trim();
  });
  source = es;
  let was = untracked(() => playback.value.playing);
  unwatch = effect(() => {
    const on = playback.value.playing;
    if (on && !was) hush();
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
  quietFor.cancel();
  quiet.value = false;
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
 * The frames still queued, oldest first; the queue is left empty.
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
  return quiet.value && source !== null && playback.value.playing;
}
