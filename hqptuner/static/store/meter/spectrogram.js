// The spectrogram's history: a run of slices, each the power average of the
// feed frames that cover SLICE_MS of playback, laid along the time axis by the
// frame time the feed says those frames cover. Playback time is what both the
// spectrogram and the apodizing strip above it are drawn on, so neither the
// page's poll cadence nor its clock has any say in where a slice lands. A track
// change clears the apodizing history (store/apodhistory.js), and the slices
// with it; nothing else does.
//
// A slice keeps every channel's levels and their power-average sum, so the
// channel picker redraws the whole history, each as ROWS rows from 0 Hz to the
// Nyquist it was measured at, one byte a row at the feed's 0.5 dB step: a
// change of source rate mid-history leaves the older slices drawn at their own
// frequencies.
import { signal, computed, effect } from "@preact/signals";
import { windowSpan } from "../../lib/apodscale.js";
import { pickBins, traceColumns } from "../../model/gauges/meter.js";
import { apodBins, apodVisibleBins } from "../apodhistory.js";
import { apodWindow, meterChannel } from "../ui/prefs.js";

// About two hours of slices, the reach of the apodizing history's own cap.
const MAX_SLICES = 36000;
// Playback a slice covers before it closes, ms.
const SLICE_MS = 200;
// Rows a slice keeps from 0 Hz to its Nyquist.
const ROWS = 480;
const ROW_STEP_DB = 0.5;
const ROW_MAX = 255;

/** @typedef {import("./feed.js").Geometry} Geometry */
/** @typedef {import("../../lib/spectroraster.js").Cell} Cell */
/** @typedef {import("../../model/gauges/meter.js").MeterFrame} MeterFrame */
/**
 * @typedef {{ ms: number, nyquist: number, channels: Uint8Array[], sum: Uint8Array }} Slice
 *   One slice: the frame time it covers, the Nyquist it was measured at, and
 *   its rows per channel and summed across channels.
 */

const slices = signal(/** @type {Slice[]} */ ([]));

/** @type {Float64Array[] | null} */
let power = null;
let count = 0;
let frameMs = 0;
/** @type {Geometry | null} */
let held = null;

const toPower = (/** @type {number} */ db) => 10 ** (db / 10);
const toDb = (/** @type {number} */ p) => 10 * Math.log10(p);

/** Drop the slice being accumulated. */
function dropPartial() {
  power = null;
  count = 0;
  frameMs = 0;
}

/**
 * Bins as a slice's rows: the loudest bin under each row, one byte a 0.5 dB step below full scale.
 *
 * @param {Float32Array} bins  dBFS
 * @returns {Uint8Array}
 */
function rowsOf(bins) {
  const cols = traceColumns(bins, ROWS);
  return Uint8Array.from(cols, (db) => Math.min(ROW_MAX, Math.max(0, Math.round(-db / ROW_STEP_DB))));
}

/** Close the slice being accumulated onto the history. */
function closeSlice() {
  if (!power || !count || !held) return;
  const n = count;
  /** @type {MeterFrame} */
  const mean = {
    channels: power.map((ch) => ({ peak: 0, rms: 0, bins: Float32Array.from(ch, (p) => toDb(p / n)) })),
    ms: frameMs,
  };
  /** @type {Slice} */
  const done = {
    ms: frameMs,
    nyquist: held.nyquist,
    channels: mean.channels.map((ch) => rowsOf(ch.bins)),
    sum: rowsOf(pickBins(mean, "sum")),
  };
  const next = slices.peek().concat([done]);
  slices.value = next.length > MAX_SLICES ? next.slice(next.length - MAX_SLICES) : next;
  dropPartial();
}

/**
 * Fold one decoded feed frame into the slice being accumulated. A frame whose
 * layout differs from the slice's starts the slice again.
 *
 * @param {Geometry | null} geo
 * @param {MeterFrame["channels"]} channels
 * @param {number} ms the frame time the feed frame covers
 */
export function addSpectrumFrame(geo, channels, ms) {
  if (!geo || !channels.length) return;
  if (geo !== held) {
    held = geo;
    dropPartial();
  }
  const width = channels[0].bins.length;
  if (!power || power.length !== channels.length || power[0].length !== width) {
    power = channels.map(() => new Float64Array(width));
    count = 0;
    frameMs = 0;
  }
  const acc = power;
  channels.forEach((ch, c) => ch.bins.forEach((db, k) => (acc[c][k] += toPower(db))));
  count++;
  frameMs += ms;
  if (frameMs >= SLICE_MS) closeSlice();
}

/** @type {(() => void) | null} */
let dispose = null;

/**
 * Register the clearing rule once, and hand back its disposer: an empty
 * apodizing history is a new track, and the slices go with it.
 *
 * @returns {() => void}
 */
export function initSpectrogram() {
  if (dispose) return dispose;
  const registered = effect(() => {
    if (apodBins.value.length) return;
    if (slices.peek().length) slices.value = [];
    dropPartial();
  });
  dispose = registered;
  return registered;
}

/**
 * One slice's rows in the picked channel: the sum, or that channel's rows,
 * falling back to the sum where the slice has no such channel.
 *
 * @param {Slice} slice
 * @param {string} pick
 */
function levelsOf(slice, pick) {
  return pick === "sum" ? slice.sum : slice.channels[Number(pick)] || slice.sum;
}

/**
 * The cells the spectrogram draws, oldest first: the newest slices whose frame
 * times fit `span`, walked back from the right edge, in the picked channel.
 *
 * @param {Slice[]} all
 * @param {number} span window width in milliseconds
 * @param {string} pick
 * @returns {Cell[]}
 */
export function visibleCells(all, span, pick) {
  let used = 0;
  let i = all.length;
  while (i > 0 && used + all[i - 1].ms <= span) {
    used += all[i - 1].ms;
    i--;
  }
  return all.slice(i).map((s) => ({ ms: s.ms, nyquist: s.nyquist, slices: [levelsOf(s, pick)] }));
}

/** The cells the spectrogram draws across the strip's window. */
export const spectrogramCells = computed(() =>
  visibleCells(slices.value, windowSpan(apodVisibleBins.value, apodWindow.value), meterChannel.value),
);
