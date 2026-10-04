// The METER spectrogram's history: a run of slices, each the power average of
// SLICE_FRAMES feed frames, laid along the time axis by the frame time the feed
// says those frames cover. Playback time is what both the spectrogram and the
// apodizing strip above it are drawn on, so neither the page's poll cadence nor
// its clock has any say in where a slice lands. A track change clears the
// apodizing history (store/apodhistory.js), and the slices with it; nothing
// else does.
//
// A slice keeps every channel's bands and their power-average sum, so the
// channel picker redraws the whole history. A slice keeps the band centres and
// Nyquist it was measured at, so a change of source rate mid-history leaves the
// older slices drawn at their own frequencies.
import { signal, computed, effect } from "@preact/signals";
import { windowSpan } from "../../lib/apodscale.js";
import { apodBins, apodVisibleBins } from "../apodhistory.js";
import { apodWindow, meterChannel } from "../ui/prefs.js";

// About two hours of slices, the reach of the apodizing history's own cap.
const MAX_SLICES = 36000;
// Feed frames per slice.
const SLICE_FRAMES = 5;

/** @typedef {import("./feed.js").Geometry} Geometry */
/** @typedef {import("../../lib/spectroraster.js").Cell} Cell */
/**
 * @typedef {{ ms: number, centres: number[], nyquist: number, channels: Float32Array[], sum: Float32Array }} Slice
 *   One slice: the frame time it covers, the band layout it was measured at,
 *   and its band levels in dB, per channel and summed across channels.
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

/** Close the slice being accumulated onto the history. */
function closeSlice() {
  if (!power || !count || !held) return;
  const n = count;
  const sum = new Float64Array(power[0].length);
  power.forEach((ch) => ch.forEach((p, k) => (sum[k] += p)));
  const m = power.length;
  /** @type {Slice} */
  const done = {
    ms: frameMs,
    centres: held.centres,
    nyquist: held.nyquist,
    channels: power.map((ch) => Float32Array.from(ch, (p) => toDb(p / n))),
    sum: Float32Array.from(sum, (p) => toDb(p / (n * m))),
  };
  const next = slices.peek().concat([done]);
  slices.value = next.length > MAX_SLICES ? next.slice(next.length - MAX_SLICES) : next;
  dropPartial();
}

/**
 * Fold one feed frame into the slice being accumulated. A frame whose layout
 * differs from the slice's starts the slice again.
 *
 * @param {Geometry | null} geo
 * @param {Array<{ bands: number[] }>} channels
 * @param {number} ms the frame time the feed frame covers
 */
export function addSpectrumFrame(geo, channels, ms) {
  if (!geo || !channels.length) return;
  if (geo !== held) {
    held = geo;
    dropPartial();
  }
  const width = channels[0].bands.length;
  if (!power || power.length !== channels.length || power[0].length !== width) {
    power = channels.map(() => new Float64Array(width));
    count = 0;
    frameMs = 0;
  }
  const acc = power;
  channels.forEach((ch, c) => ch.bands.forEach((db, k) => (acc[c][k] += toPower(db))));
  count++;
  frameMs += ms;
  if (count >= SLICE_FRAMES) closeSlice();
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
 * One slice's levels in the picked channel: the sum, or that channel's bands,
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
  return all.slice(i).map((s) => ({ ms: s.ms, centres: s.centres, nyquist: s.nyquist, slices: [levelsOf(s, pick)] }));
}

/** The cells the spectrogram draws across the strip's window. */
export const spectrogramCells = computed(() =>
  visibleCells(slices.value, windowSpan(apodVisibleBins.value, apodWindow.value), meterChannel.value),
);
