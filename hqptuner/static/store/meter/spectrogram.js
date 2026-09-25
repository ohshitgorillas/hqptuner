// The METER spectrogram's history: one column per apodizing-history bin
// (store/apodhistory.js), so the spectrogram and the apodizing strip above it
// share one time axis. A column holds the slices the feed delivered while its
// bin was open, each slice the power average of SLICE_FRAMES feed frames, so
// the spectrogram resolves time far finer than the poll that closes a column.
// A track change clears the bins, and the columns with them; nothing else does.
//
// A slice keeps every channel's bands and their power-average sum, so the
// channel picker redraws the whole history. A column keeps the band centres and
// Nyquist it was measured at, so a change of source rate mid-history leaves the
// older columns drawn at their own frequencies.
import { signal, computed, effect } from "@preact/signals";
import { apodBins, apodBinSeq, apodVisibleBins } from "../apodhistory.js";
import { meterChannel } from "../ui/prefs.js";

// The apodizing history's own cap (MAX_BINS in store/apodhistory.js): past it
// the oldest bins slide off, and the columns go with them.
const MAX_COLUMNS = 3600;
// Feed frames per slice: five 40 ms strides (STRIDE_MS in engine/meterfeed.py).
const SLICE_FRAMES = 5;

/** @typedef {import("./feed.js").Geometry} Geometry */
/**
 * @typedef {{ channels: Float32Array[], sum: Float32Array }} Slice
 *   One slice's band levels in dB, per channel and summed across channels.
 * @typedef {{ centres: number[], nyquist: number, slices: Slice[] }} Column
 *   One closed bin's worth of slices, oldest first.
 * @typedef {{ ms: number, slices: Float32Array[], centres: number[], nyquist: number }} Cell
 *   One visible column, in the picked channel; `slices` is empty where the
 *   interval carried no frame.
 */

const columns = signal(/** @type {Array<Column | null>} */ ([]));

/** @type {Float64Array[] | null} */
let power = null;
let count = 0;
/** @type {Slice[]} */
let open = [];
/** @type {Geometry | null} */
let held = null;
let seen = 0;

const toPower = (/** @type {number} */ db) => 10 ** (db / 10);
const toDb = (/** @type {number} */ p) => 10 * Math.log10(p);

/** Close the slice being accumulated, where any frame reached it. */
function closeSlice() {
  if (!power || !count) return;
  const n = count;
  const sum = new Float64Array(power[0].length);
  power.forEach((ch) => ch.forEach((p, k) => (sum[k] += p)));
  const m = power.length;
  open.push({
    channels: power.map((ch) => Float32Array.from(ch, (p) => toDb(p / n))),
    sum: Float32Array.from(sum, (p) => toDb(p / (n * m))),
  });
  power = null;
  count = 0;
}

/** Drop everything not yet in a closed column. */
function dropOpen() {
  power = null;
  count = 0;
  open = [];
}

/**
 * Fold one feed frame into the open slice. A frame whose layout differs from
 * the open column's starts the column again.
 *
 * @param {Geometry | null} geo
 * @param {Array<{ bands: number[] }>} channels
 */
export function addSpectrumFrame(geo, channels) {
  if (!geo || !channels.length) return;
  if (geo !== held) {
    held = geo;
    dropOpen();
  }
  const width = channels[0].bands.length;
  if (!power || power.length !== channels.length || power[0].length !== width) {
    power = channels.map(() => new Float64Array(width));
    count = 0;
  }
  const acc = power;
  channels.forEach((ch, c) => ch.bands.forEach((db, k) => (acc[c][k] += toPower(db))));
  count++;
  if (count >= SLICE_FRAMES) closeSlice();
}

/** The open column, closed: null where no frame reached it. @returns {Column | null} */
function closeColumn() {
  closeSlice();
  const col = held && open.length ? { centres: held.centres, nyquist: held.nyquist, slices: open } : null;
  open = [];
  return col;
}

/** @type {(() => void) | null} */
let dispose = null;

/**
 * Register the column clock once, and hand back its disposer. One column
 * closes per apodizing bin appended; an interval the feed sent nothing in is
 * an empty column, so the history either side of it stays on the strip's time
 * axis.
 *
 * @returns {() => void}
 */
export function initSpectrogram() {
  if (dispose) return dispose;
  seen = apodBinSeq.peek();
  const registered = effect(() => {
    const seq = apodBinSeq.value;
    if (!apodBins.value.length) {
      if (columns.peek().length) columns.value = [];
      dropOpen();
      seen = seq;
      return;
    }
    if (seq === seen) return;
    /** @type {Array<Column | null>} */
    const added = [closeColumn()];
    for (let i = seen + 1; i < seq; i++) added.push(null);
    seen = seq;
    const next = columns.peek().concat(added);
    columns.value = next.length > MAX_COLUMNS ? next.slice(next.length - MAX_COLUMNS) : next;
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
 * The columns the spectrogram draws, oldest first, each paired with the
 * apodizing bin it shares a slot with: the newest columns that the strip's
 * visible bins cover, right-aligned to them, in the picked channel.
 */
export const spectrogramCells = computed(() => {
  /** @type {Array<{ ms: number }>} */
  const bins = apodVisibleBins.value;
  /** @type {Array<Column | null>} */
  const cols = columns.value;
  /** @type {string} */
  const pick = meterChannel.value;
  const k = Math.min(bins.length, cols.length);
  return cols.slice(cols.length - k).map((col, i) => {
    const ms = bins[bins.length - k + i].ms;
    /** @type {Cell} */
    const cell = col
      ? { ms, centres: col.centres, nyquist: col.nyquist, slices: col.slices.map((s) => levelsOf(s, pick)) }
      : { ms, slices: [], centres: [], nyquist: 0 };
    return cell;
  });
});
