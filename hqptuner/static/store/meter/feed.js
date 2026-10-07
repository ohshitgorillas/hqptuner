// The meters' connection to /api/meter/feed (api/routes/meter.py), held open
// on every page while metering is available (initMeterFeed), so the
// spectrogram's history runs unbroken whichever page is up. A `geometry` event
// describes the frames that follow it; each `frame` event is decoded once,
// stamped with that geometry and queued for the meter loop (loop.js), which
// paces the frames out to the meters and the spectrogram's history. A frame the
// loop never takes still reaches the history: the oldest frames past
// MAX_PENDING_MS of frame time (a hidden page runs no animation frames), and
// every frame queued when playback stops.
//
// The feed is silent when the engine plays and no frame has come for QUIET_MS
// since the feed opened, playback started, or the last frame, whichever is
// latest. The clock is the one openMeterFeed() is handed: a monotonic one, since
// it measures an interval and nothing else.
import { signal, effect } from "@preact/signals";
import { decodeBins } from "../../model/gauges/meter.js";
import { engineStatus } from "../signals.js";
import { metering } from "../actions.js";
import { addSpectrumFrame } from "./spectrogram.js";

const FEED = "/api/meter/feed";
const PLAYING = 2;
const QUIET_MS = 2000;
// Frame time the queue holds for a loop that has not drained it, ms: the longest
// delay the loop paces at, and a second past it.
const MAX_PENDING_MS = 6000;

/** @typedef {{ nyquist: number, channels: number, bins: number }} Geometry */
/** @typedef {import("../../model/gauges/meter.js").MeterFrame} MeterFrame */
/** @typedef {{ channels: Array<{ peak: number, rms: number, bins: string }>, ms: number }} WireFrame */

export const meterGeometry = signal(/** @type {Geometry | null} */ (null));
/** Whether a feed is open, from openMeterFeed() until closeMeterFeed(). */
export const meterFeedOpen = signal(false);

/** @type {EventSource | null} */
let source = null;
/** @type {(() => void) | null} */
let unwatch = null;
let clock = () => performance.now();
let since = 0;
/** @type {MeterFrame[]} */
let pending = [];

const playing = () => Number(((engineStatus.value || {}).status || {}).state) === PLAYING;

/**
 * A wire frame with its bins decoded to dBFS.
 *
 * @param {WireFrame} wire
 * @returns {MeterFrame}
 */
const decode = (wire) => ({
  channels: wire.channels.map((ch) => ({ peak: ch.peak, rms: ch.rms, bins: decodeBins(ch.bins) })),
  ms: wire.ms,
  geo: meterGeometry.peek(),
});

/**
 * Hand each of `frames` to the spectrogram's history, oldest first, under the geometry it arrived with.
 *
 * @param {MeterFrame[]} frames
 */
export function toSpectrogram(frames) {
  frames.forEach((f) => addSpectrumFrame(f.geo ?? null, f.channels, f.ms));
}

/** Move the oldest frames past MAX_PENDING_MS of frame time to the spectrogram. */
function trim() {
  let total = pending.reduce((sum, f) => sum + f.ms, 0);
  let n = 0;
  while (total > MAX_PENDING_MS) total -= pending[n++].ms;
  if (n) toSpectrogram(pending.splice(0, n));
}

/**
 * Open the feed, dropping any feed and frames already held.
 *
 * @param {() => number} [now]
 */
export function openMeterFeed(now = () => performance.now()) {
  closeMeterFeed();
  clock = now;
  since = now();
  meterGeometry.value = null;
  pending = [];
  const es = new EventSource(FEED);
  es.addEventListener("geometry", (e) => {
    meterGeometry.value = JSON.parse(e.data);
  });
  es.addEventListener("frame", (e) => {
    since = clock();
    pending.push(decode(JSON.parse(e.data)));
    trim();
  });
  source = es;
  let was = Number(((engineStatus.peek() || {}).status || {}).state) === PLAYING;
  unwatch = effect(() => {
    const on = playing();
    if (on && !was) since = clock();
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
  meterFeedOpen.value = false;
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
 * @param {() => number} [now]
 * @returns {() => void}
 */
export function initMeterFeed(now = () => performance.now()) {
  if (dispose) return dispose;
  const registered = effect(() => (metering.value ? openMeterFeed(now) : closeMeterFeed()));
  dispose = registered;
  return registered;
}

/** Whether the engine plays and the open feed has sent nothing for too long. @returns {boolean} */
export function meterSilent() {
  return source !== null && playing() && clock() - since >= QUIET_MS;
}
