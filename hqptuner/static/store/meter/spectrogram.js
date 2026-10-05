// The spectrogram's histories: runs of slices, each the power average of the
// feed frames that cover its slice time of playback, laid along the time axis by the
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

// The fine history: a slice per FINE_MS of playback, as fine as the 30 s window's
// pixel columns, kept for FINE_SPAN_MS, the widest window but All.
const FINE_MS = 25;
const FINE_SPAN_MS = 300000;
// The coarse history: a slice per SLICE_MS, about two hours of slices, the reach
// of the apodizing history's own cap; All draws it once it outgrows the fine one.
const SLICE_MS = 200;
const MAX_SLICES = 36000;
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
/**
 * @typedef {object} History
 *   One history and the slice it is accumulating. Its slices are kept in a
 *   plain array, mutated in place; `version` says when it changed.
 * @property {number} sliceMs  frame time a slice covers before it closes
 * @property {(h: History) => void} trim  drop what the history no longer keeps
 * @property {Slice[]} list  oldest first
 * @property {number} held  frame time of the slices in `list`
 * @property {number} end  frame time of every slice closed since the last clear
 * @property {Float64Array[] | null} power  the slice in hand, power per bin per channel
 * @property {number} count  frames in the slice in hand
 * @property {number} frameMs  frame time of the slice in hand
 */

/**
 * @param {number} sliceMs
 * @param {(h: History) => void} trim
 * @returns {History}
 */
const history = (sliceMs, trim) => ({ sliceMs, trim, list: [], held: 0, end: 0, power: null, count: 0, frameMs: 0 });

/** @param {History} h */
const dropFront = (h) => {
  const gone = /** @type {Slice} */ (h.list.shift());
  h.held -= gone.ms;
};

const fine = history(FINE_MS, (h) => {
  while (h.held > FINE_SPAN_MS) dropFront(h);
});
const coarse = history(SLICE_MS, (h) => {
  while (h.list.length > MAX_SLICES) dropFront(h);
});
const HISTORIES = [fine, coarse];

// Bumps on every close and clear, so what reads the histories reads them again.
const version = signal(0);
/** @type {Geometry | null} */
let geoHeld = null;

const toPower = (/** @type {number} */ db) => 10 ** (db / 10);
const toDb = (/** @type {number} */ p) => 10 * Math.log10(p);

/**
 * Drop a history's slice in hand.
 *
 * @param {History} h
 */
function dropPartial(h) {
  h.power = null;
  h.count = 0;
  h.frameMs = 0;
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

/**
 * Close a history's slice in hand onto it.
 *
 * @param {History} h
 * @param {Geometry} geo
 */
function closeSlice(h, geo) {
  if (!h.power || !h.count) return;
  const n = h.count;
  /** @type {MeterFrame} */
  const mean = {
    channels: h.power.map((ch) => ({ peak: 0, rms: 0, bins: Float32Array.from(ch, (p) => toDb(p / n)) })),
    ms: h.frameMs,
  };
  h.list.push({
    ms: h.frameMs,
    nyquist: geo.nyquist,
    channels: mean.channels.map((ch) => rowsOf(ch.bins)),
    sum: rowsOf(pickBins(mean, "sum")),
  });
  h.held += h.frameMs;
  h.end += h.frameMs;
  h.trim(h);
  dropPartial(h);
}

/**
 * Fold one frame into a history's slice in hand, closing it once it covers the history's slice time.
 *
 * @param {History} h
 * @param {Geometry} geo
 * @param {MeterFrame["channels"]} channels
 * @param {number} ms
 * @returns {boolean} whether a slice closed
 */
function addTo(h, geo, channels, ms) {
  const width = channels[0].bins.length;
  if (!h.power || h.power.length !== channels.length || h.power[0].length !== width) {
    h.power = channels.map(() => new Float64Array(width));
    h.count = 0;
    h.frameMs = 0;
  }
  const acc = h.power;
  channels.forEach((ch, c) => ch.bins.forEach((db, k) => (acc[c][k] += toPower(db))));
  h.count++;
  h.frameMs += ms;
  if (h.frameMs < h.sliceMs) return false;
  closeSlice(h, geo);
  return true;
}

/**
 * Fold one decoded feed frame into both histories. A frame whose layout differs
 * from the slices' in hand starts them again.
 *
 * @param {Geometry | null} geo
 * @param {MeterFrame["channels"]} channels
 * @param {number} ms the frame time the feed frame covers
 */
export function addSpectrumFrame(geo, channels, ms) {
  if (!geo || !channels.length) return;
  if (geo !== geoHeld) {
    geoHeld = geo;
    HISTORIES.forEach(dropPartial);
  }
  const closed = HISTORIES.map((h) => addTo(h, geo, channels, ms));
  if (closed.some(Boolean)) version.value = version.peek() + 1;
}

/** Empty both histories and their slices in hand. */
function clearHistories() {
  for (const h of HISTORIES) {
    h.list = [];
    h.held = 0;
    h.end = 0;
    dropPartial(h);
  }
  version.value = version.peek() + 1;
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
    clearHistories();
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

const span = computed(() => windowSpan(apodVisibleBins.value, apodWindow.value));

/** Which history the window draws: the fine one while it reaches across the window's span. */
export const spectrogramTier = computed(() => (span.value <= FINE_SPAN_MS ? "fine" : "coarse"));

const drawn = () => (spectrogramTier.value === "fine" ? fine : coarse);

/** The cells the spectrogram draws across the strip's window. */
export const spectrogramCells = computed(() => {
  version.value;
  return visibleCells(drawn().list, span.value, meterChannel.value);
});

/** Frame time, ms, of every slice closed into the drawn history since it last cleared. */
export const spectrogramEnd = computed(() => {
  version.value;
  return drawn().end;
});
