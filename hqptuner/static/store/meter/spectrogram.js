// The spectrogram's history: a run of slices, each the power average of the
// feed frames it covers, placed in playback by those frames' own stamps
// (docs/spec/timing.md, rule 1): a slice starts at its first frame's `at` and
// ends where its last frame ends. A frame that begins a break empties the
// history and starts a fresh slice (rule 3). A track change clears the
// apodizing history (store/apodhistory.js), and the slices with it.
//
// The cells drawn are the slices inside the window whose right edge is the one
// playhead (store/meter/playhead.js, rule 4); nothing is drawn while it is null.
// The apodizing strip's right edge is that same playhead, and has none while it
// is null.
//
// A slice keeps every channel's levels and their power-average sum, so the
// channel picker redraws the whole history, each as ROWS rows from 0 Hz to the
// Nyquist it was measured at, one byte a row at ROW_STEP_DB below full scale,
// which reaches the feed's floor: a change of source rate mid-history leaves
// the older slices drawn at their own frequencies.
import { signal, computed, effect } from "@preact/signals";
import { windowSpan } from "../../lib/apodscale.js";
import { clamp } from "../../lib/coerce.js";
import { dbToPower, powerToDb } from "../../lib/units.js";
import { pickBins, traceColumns } from "../../model/gauges/meter/meter.js";
import { apodBins } from "../apodhistory.js";
import { apodWindow, meterChannel } from "../ui/prefs.js";
import { playhead } from "./playhead.js";

// The shortest slice, playback ms, as fine as the 30 s window's pixel columns,
// and the playback the history keeps, ms, the widest window.
const FINE_MS = 25;
const FINE_SPAN_MS = 300000;
// Rows a slice keeps from 0 Hz to its Nyquist.
const ROWS = 480;
const ROW_STEP_DB = 1.2;
const ROW_MAX = 250;

/** @typedef {import("../../model/gauges/meter/meter.js").FrameGeometry} Geometry */
/** @typedef {import("../../lib/spectroraster.js").Cell} Cell */
/** @typedef {import("../../model/gauges/meter/meter.js").MeterFrame} MeterFrame */
/**
 * One slice: where it starts and how long it lasts, the Nyquist it was measured at, and its rows per channel and
 * summed across channels.
 *
 * @typedef {object} Slice
 * @property {number} at  playback, ms: where its first frame starts
 * @property {number} ms  playback, ms: from `at` to where its last frame ends
 * @property {number} nyquist  Hz
 * @property {Uint8Array[]} channels
 * @property {Uint8Array} sum
 */
/**
 * The slice in hand: power per bin per channel, the frames folded into it, and where they start and end.
 *
 * @typedef {object} Partial
 * @property {Float64Array[]} power
 * @property {number} count
 * @property {number} at  playback, ms: where its first frame starts
 * @property {number} end  playback, ms: where its last frame ends
 */

/**
 * The closed slices, oldest first, in a plain array mutated in place; `version` says when it changed.
 *
 * @type {Slice[]}
 */
let slices = [];
/** @type {Partial | null} */
let hand = null;

// Bumps on every close and clear, so what reads the history reads it again.
const version = signal(0);

/**
 * Bins as a slice's rows: the loudest bin under each row, one byte a ROW_STEP_DB step below full scale.
 *
 * @param {Float32Array} bins  dBFS
 * @returns {Uint8Array}
 */
function rowsOf(bins) {
  const cols = traceColumns(bins, ROWS);
  return Uint8Array.from(cols, (db) => clamp(Math.round(-db / ROW_STEP_DB), 0, ROW_MAX));
}

/**
 * Close the slice in hand onto the history, and drop what the history no longer keeps: the slices that start more
 * than FINE_SPAN_MS of playback before the newest one ends.
 *
 * @param {Partial} p
 * @param {Geometry} geo
 */
function closeSlice(p, geo) {
  const n = p.count;
  const ms = p.end - p.at; // playback, ms
  /** @type {MeterFrame} */
  const mean = {
    channels: p.power.map((ch) => ({ peak: 0, rms: 0, bins: Float32Array.from(ch, (pw) => powerToDb(pw / n)) })),
    ms,
  };
  slices.push({
    at: p.at,
    ms,
    nyquist: geo.nyquist,
    channels: mean.channels.map((ch) => rowsOf(ch.bins)),
    sum: rowsOf(pickBins(mean, "sum")),
  });
  while (p.end - slices[0].at > FINE_SPAN_MS) slices.shift();
  hand = null;
}

/**
 * Fold one frame into the slice in hand, starting one where there is none or its layout differs, and close it once
 * its frames cover FINE_MS of playback by their stamps.
 *
 * @param {Geometry} geo
 * @param {MeterFrame["channels"]} channels
 * @param {number} at  playback, ms: where the frame starts
 * @param {number} end  playback, ms: where the frame ends
 * @returns {boolean} whether a slice closed
 */
function fold(geo, channels, at, end) {
  const width = channels[0].bins.length;
  if (!hand || hand.power.length !== channels.length || hand.power[0].length !== width) {
    hand = { power: channels.map(() => new Float64Array(width)), count: 0, at, end };
  }
  const p = hand;
  channels.forEach((ch, c) => ch.bins.forEach((db, k) => (p.power[c][k] += dbToPower(db))));
  p.count++;
  p.end = end;
  if (p.end - p.at < FINE_MS) return false;
  closeSlice(p, geo);
  return true;
}

/** Empty the history and its slice in hand. */
function clearHistory() {
  slices = [];
  hand = null;
  version.value = version.peek() + 1;
}

/**
 * Fold one feed frame into the history. A frame that begins a break empties the history first.
 *
 * @param {MeterFrame} frame
 */
export function addSpectrumFrame(frame) {
  const { geo, channels, at, ms } = frame;
  if (!geo || !channels.length || at === undefined) return;
  if (frame.break) clearHistory();
  if (fold(geo, channels, at, at + ms)) version.value = version.peek() + 1;
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
    if (!apodBins.value.length) clearHistory();
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
 * The cells the spectrogram draws, oldest first, in the picked channel: the slices that end by `edge` and start no
 * earlier than `span` before it.
 *
 * @param {Slice[]} all  oldest first
 * @param {number} span  playback, ms: the window's width
 * @param {string} pick
 * @param {number} edge  playback, ms: the window's right edge
 * @returns {Cell[]}
 */
export function visibleCells(all, span, pick, edge) {
  let hi = all.length;
  while (hi > 0 && all[hi - 1].at + all[hi - 1].ms > edge) hi--;
  let lo = hi;
  while (lo > 0 && all[lo - 1].at >= edge - span) lo--;
  return all.slice(lo, hi).map((s) => ({ at: s.at, ms: s.ms, nyquist: s.nyquist, slices: [levelsOf(s, pick)] }));
}

const span = computed(() => windowSpan(apodWindow.value));

/** The cells the spectrogram draws across the strip's window ending at the playhead; none while it is null. */
export const spectrogramCells = computed(() => {
  version.value;
  const edge = playhead.value;
  return edge === null ? [] : visibleCells(slices, span.value, meterChannel.value, edge);
});

/** Playback, ms: the apodizing strip's right edge, the playhead; null while the playhead is null. */
export const stripEnd = computed(() => playhead.value);
