// The meters' connection to /api/meter/feed (api/routes/meter.py), held open
// on every page while metering is available (initMeterFeed), so the
// spectrogram's history runs unbroken whichever page is up. A `geometry` event
// describes the frames that follow it; each `frame` event moves the displayed levels one step
// (levels.js) and adds its bands to the spectrogram's history. The levels park
// when playback stops, so a restart never falls from the last track's reading.
//
// The feed is silent when the engine plays and no frame has come for QUIET_MS
// since the feed opened, playback started, or the last frame, whichever is
// latest. The clock is the one openMeterFeed() is handed: a monotonic one, since
// it measures an interval and nothing else.
import { signal, effect } from "@preact/signals";
import { engineStatus } from "../signals.js";
import { metering } from "../actions.js";
import { settle } from "./levels.js";
import { addSpectrumFrame } from "./spectrogram.js";

const FEED = "/api/meter/feed";
const PLAYING = 2;
const QUIET_MS = 2000;

/** @typedef {{ nyquist: number, channels: number, centres: number[] }} Geometry */
/** @typedef {import("./levels.js").Ballistic} Ballistic */
/** @typedef {{ channels: Array<{ peak: number, rms: number, bands: number[] }>, ms: number }} Frame */

export const meterGeometry = signal(/** @type {Geometry | null} */ (null));
export const meterLevels = signal(/** @type {Ballistic[]} */ ([]));

/** @type {EventSource | null} */
let source = null;
/** @type {(() => void) | null} */
let unwatch = null;
let clock = () => performance.now();
let since = 0;

const playing = () => Number(((engineStatus.value || {}).status || {}).state) === PLAYING;

/**
 * Open the feed, dropping any feed and levels already held.
 *
 * @param {() => number} [now]
 */
export function openMeterFeed(now = () => performance.now()) {
  closeMeterFeed();
  clock = now;
  since = now();
  meterGeometry.value = null;
  meterLevels.value = [];
  const es = new EventSource(FEED);
  es.addEventListener("geometry", (e) => {
    meterGeometry.value = JSON.parse(e.data);
  });
  es.addEventListener("frame", (e) => {
    since = clock();
    /** @type {Frame} */
    const frame = JSON.parse(e.data);
    meterLevels.value = settle(meterLevels.peek(), frame.channels);
    addSpectrumFrame(meterGeometry.peek(), frame.channels, frame.ms);
  });
  source = es;
  let was = Number(((engineStatus.peek() || {}).status || {}).state) === PLAYING;
  unwatch = effect(() => {
    const on = playing();
    if (on && !was) since = clock();
    if (!on && meterLevels.peek().length) meterLevels.value = [];
    was = on;
  });
}

/** Close the feed, if one is open. */
export function closeMeterFeed() {
  if (source) source.close();
  source = null;
  if (unwatch) unwatch();
  unwatch = null;
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
