// The spectrogram's pixels, apart from any canvas: hex colors read as RGB, a
// color ramp blended in oklab between hex stops, and the raster a view paints
// with it. Time across, newest at the right; frequency up, linear from 0 Hz to
// the view's top; level as a step on the ramp, from the range's floor to full
// scale.
//
// A slice is a column of rows from 0 Hz to its own Nyquist, one byte a row at ROW_STEP_DB below full
// scale, the step defined here that store/meter/spectrogram.js encodes its rows at. Each stands where its own stamp
// says, against the window's right edge, the playhead. A pixel blends the two nearest rows in frequency and the two
// nearest slices in time, so the field reads as continuous rather than as a grid of rows and slices. Playback no slice
// covers is left unpainted, and no column blends across it.
//
// A paint reads the history by index and allocates nothing whose size grows
// with it: the slices it draws are found by binary search, and walked
// once from left to right. Handed a target, it writes into the target's
// pixels and keeps its row tables on the target's reader, so a painter that
// holds one target allocates nothing per paint.

import { clamp } from "./coerce.js";

/**
 * @typedef {{ at: number, ms: number, nyquist: number, channels: Uint8Array[], sum: Uint8Array }} Cell
 *   One slice of the history: it starts at `at` and lasts `ms`, both playback,
 *   ms, measured at `nyquist` Hz, with its rows per channel and summed across
 *   channels.
 */
/**
 * @typedef {object} RasterView
 * @property {ArrayLike<Cell>} slices  oldest first; `slices[lo..hi)` are drawn
 * @property {number} lo
 * @property {number} hi
 * @property {string} pick  "sum", or a channel's index; a slice without that channel draws its sum
 * @property {number} edge  playback, ms: the window's right edge
 * @property {number} span  playback, ms: the window's width
 * @property {number} range  dB from the floor to full scale
 * @property {number} top  Hz: the frequency at the top of the view
 */
/** @typedef {[number, number, number]} Triple */

// Raster pixels; CSS stretches them over the plot box.
export const W = 1200;
export const H = 480;
const STEPS = 256;
// dB a slice row's byte counts down from full scale: the history encodes its rows at this step, the raster reads them.
export const ROW_STEP_DB = 1.2;

/**
 * An sRGB channel's linear light.
 *
 * @param {number} c 0..1
 * @returns {number}
 */
export const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** @param {number} c */
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** @param {Triple} rgb 0..1 sRGB @returns {Triple} */
function toOklab([r0, g0, b0]) {
  const [r, g, b] = [toLinear(r0), toLinear(g0), toLinear(b0)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** @param {Triple} lab @returns {Triple} 0..255 sRGB */
function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return /** @type {Triple} */ (linear.map((c) => Math.round(255 * clamp(toSrgb(c), 0, 1))));
}

/**
 * A color's value as [r, g, b], 0 to 255 each, or `fallback` when it is not a `#rgb` or `#rrggbb` hex color.
 *
 * @param {string} value
 * @param {number[]} fallback
 * @returns {number[]}
 */
export function rgb(value, fallback) {
  const m = value.trim().replace("#", "");
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(m)) return fallback;
  const full = m.length === 3 ? [...m].map((c) => c + c).join("") : m;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/** @param {string} hex `#rrggbb` @returns {Triple} 0..1 sRGB, black where `hex` is no hex color */
const unitRgb = (hex) => /** @type {Triple} */ (rgb(hex, [0, 0, 0]).map((c) => c / 255));

/**
 * The ramp as a lookup table, floor first: STEPS colors blended in oklab
 * between the stops' control points.
 *
 * @param {string[]} hexStops `#rrggbb` each, floor first
 * @returns {Triple[]} 0..255 sRGB
 */
export function rampFrom(hexStops) {
  const stops = hexStops.map((hex) => toOklab(unitRgb(hex)));
  return Array.from({ length: STEPS }, (_, i) => {
    const pos = (i / (STEPS - 1)) * (stops.length - 1);
    const seg = Math.min(stops.length - 2, Math.floor(pos));
    const t = pos - seg;
    const [a, b] = [stops[seg], stops[seg + 1]];
    return fromOklab([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  });
}

/**
 * Where a frequency stands among a slice's rows, `freq` and `nyquist` in one unit: row r of `rows` is the band from
 * r / rows to (r + 1) / rows of the Nyquist and stands at its center, r, with the band's lower edge at r - 0.5.
 *
 * @param {number} freq @param {number} nyquist @param {number} rows @returns {number}
 */
export const rowAt = (freq, nyquist, rows) => (freq * rows) / nyquist - 0.5;

/**
 * Each pixel row's position among a slice's rows, by rowAt held to the first and last, or -1 above its Nyquist.
 *
 * @param {number} nyquist @param {number} rows @param {Float64Array} freqs @returns {Float32Array}
 */
function rowTable(nyquist, rows, freqs) {
  return Float32Array.from(freqs, (f) => (f > nyquist ? -1 : clamp(rowAt(f, nyquist, rows), 0, rows - 1)));
}

/**
 * @typedef {object} Reader
 *   What raster calls read the drawn slices with, shared across calls: the
 *   pixel rows' frequencies for one top, the row tables for that top, one per
 *   Nyquist and row count, so slices of the same Nyquist and row count share
 *   one and blend across their seams, and the blend of each pixel column.
 * @property {number} top  Hz: the top `freqs` and `tables` belong to, NaN while they belong to none
 * @property {Float64Array} freqs  Hz: the frequency at the center of each pixel row, top row first
 * @property {{ nyquist: number, rows: number, table: Float32Array }[]} tables
 * @property {Blend} blend
 */

/** @typedef {{ width: number, height: number, data: Uint8ClampedArray }} Pixels */

/**
 * @typedef {object} RasterTarget
 *   The image a raster call writes into and the reader raster calls share:
 *   `img` is at least `W - from` columns wide and `H` rows high for a call from
 *   column `from`, its column x being column `from + x` of the view.
 * @property {Pixels} img
 * @property {Reader} reader
 */

/**
 * A target writing into `img`, with a reader that has built nothing yet.
 *
 * @param {Pixels} img
 * @returns {RasterTarget}
 */
export function rasterTarget(img) {
  /** @type {Reader} */
  const reader = {
    top: NaN,
    freqs: new Float64Array(H),
    tables: [],
    blend: { levels: new Uint8Array(0), rows: new Float32Array(0), toward: null, w: 0 },
  };
  return { img, reader };
}

/**
 * Points the reader at `top`: its row frequencies are those of `top`, and it
 * holds no row table of another top. A reader already at `top` keeps its tables.
 *
 * @param {Reader} reader
 * @param {number} top  Hz
 */
function readTop(reader, top) {
  if (reader.top === top) return;
  reader.top = top;
  for (let y = 0; y < H; y++) reader.freqs[y] = (top * (H - 0.5 - y)) / H;
  reader.tables.length = 0;
}

/**
 * One slice's rows in the picked channel: the sum, or that channel's rows,
 * falling back to the sum where the slice has no such channel.
 *
 * @param {Cell} slice
 * @param {string} pick
 * @returns {Uint8Array}
 */
const levelsOf = (slice, pick) => (pick === "sum" ? slice.sum : slice.channels[Number(pick)] || slice.sum);

/**
 * The row table for a slice measured at `nyquist` with `rows` rows, built the
 * first time a raster call meets that layout.
 *
 * @param {Reader} reader
 * @param {number} nyquist
 * @param {number} rows
 * @returns {Float32Array}
 */
function tableFor({ freqs, tables }, nyquist, rows) {
  for (const t of tables) if (t.nyquist === nyquist && t.rows === rows) return t.table;
  const table = rowTable(nyquist, rows, freqs);
  tables.push({ nyquist, rows, table });
  return table;
}

/** Where a slice ends, playback, ms. @param {Cell} s */
const endOf = (s) => s.at + s.ms;

/**
 * The first index in `[lo, hi)` whose slice ends after `t`, or `hi` when none
 * does. Slices lie in stamp order without overlap, so their ends rise with index.
 *
 * @param {RasterView} view
 * @param {number} t  playback, ms
 */
function firstEndingAfter({ slices, lo, hi }, t) {
  let a = lo;
  let b = hi;
  while (a < b) {
    const mid = (a + b) >>> 1;
    if (endOf(/** @type {Cell} */ (slices[mid])) > t) b = mid;
    else a = mid + 1;
  }
  return a;
}

// How far apart two stamps may lie and still meet, playback, ms: the rounding
// of a stamp converted from samples, far below a pixel column.
const SEAM_MS = 1e-3;

/**
 * A slice's level in dBFS at a fractional row, blended between the two nearest
 * rows.
 *
 * @param {Uint8Array} levels
 * @param {number} pos
 */
function levelAt(levels, pos) {
  const k = Math.floor(pos);
  const next = Math.min(levels.length - 1, k + 1);
  return -(levels[k] + (levels[next] - levels[k]) * (pos - k)) * ROW_STEP_DB;
}

/**
 * @typedef {object} Blend
 *   One pixel column's slice: its rows in the picked channel and its row table,
 *   and the neighbor's rows it blends toward, `w` of the way, or null.
 * @property {Uint8Array} levels
 * @property {Float32Array} rows
 * @property {Uint8Array | null} toward
 * @property {number} w
 */

/**
 * Set `blend` to slice `i` at playback `t` and the slice it blends toward: the
 * neighbor on the side of the slice's center `t` falls, and how far toward it,
 * from 0 at the center to 0.5 at the shared edge. No blend toward a slice not
 * drawn or not yet reached by the edge, across playback no slice covers, or
 * across a change of band layout.
 *
 * @param {Reader} reader  its blend is the one set
 * @param {RasterView} view
 * @param {number} i
 * @param {number} t  playback, ms
 */
function blendAt(reader, view, i, t) {
  const { slices, lo, hi, pick, edge } = view;
  const blend = reader.blend;
  const s = /** @type {Cell} */ (slices[i]);
  blend.levels = levelsOf(s, pick);
  blend.rows = tableFor(reader, s.nyquist, blend.levels.length);
  blend.toward = null;
  const mid = s.at + s.ms / 2;
  const j = t < mid ? i - 1 : i + 1;
  const o = j >= lo && j < hi ? /** @type {Cell} */ (slices[j]) : null;
  if (!o || o.at >= edge || Math.abs(j < i ? s.at - endOf(o) : o.at - endOf(s)) > SEAM_MS) return;
  const toward = levelsOf(o, pick);
  if (tableFor(reader, o.nyquist, toward.length) !== blend.rows) return;
  blend.toward = toward;
  blend.w = (t - mid) / (o.at + o.ms / 2 - mid);
}

/**
 * Playback at the center of pixel column `x` of a view.
 *
 * @param {RasterView} view
 * @param {number} x
 * @returns {number} playback, ms
 */
const timeAt = ({ edge, span }, x) => edge - span + ((x + 0.5) * span) / W;

/**
 * The spectrogram's pixels for one view from pixel column `from` to the right
 * edge, RGBA row by row from the top, written into `into`'s pixels. A pixel a
 * slice covers is written opaque; any other keeps what it held, so a target
 * made by this call leaves it transparent black. Column x of the pixels is
 * column `from + x` of the whole view, whose left edge is playback
 * `edge - span`.
 *
 * @param {Triple[]} ramp floor first, as `rampFrom` returns it
 * @param {RasterView} view
 * @param {number} [from]
 * @param {RasterTarget} [into]  its pixels at least `W - from` columns wide; a new target when none is handed
 * @returns {Pixels} `into`'s pixels
 */
export function rasterize(ramp, view, from = 0, into = rasterTarget(blankPixels(W - from))) {
  const { slices, hi, top } = view;
  readTop(into.reader, top);
  let i = firstEndingAfter(view, timeAt(view, from));
  for (let x = from; x < W && i < hi; x++) {
    const t = timeAt(view, x);
    i = nextEndingAfter(view, i, t);
    if (i < hi && t >= /** @type {Cell} */ (slices[i]).at) {
      blendAt(into.reader, view, i, t);
      paintColumn(into, x - from, ramp, view.range);
    }
  }
  return into.img;
}

/**
 * Transparent black pixels `width` columns wide and `H` rows high.
 *
 * @param {number} width
 * @returns {Pixels}
 */
const blankPixels = (width) => ({ width, height: H, data: new Uint8ClampedArray(width * H * 4) });

/**
 * The first index from `i` on, below `hi`, whose slice ends after `t`, or `hi`
 * when none does.
 *
 * @param {RasterView} view
 * @param {number} i
 * @param {number} t  playback, ms
 */
function nextEndingAfter({ slices, hi }, i, t) {
  let k = i;
  while (k < hi && endOf(/** @type {Cell} */ (slices[k])) <= t) k++;
  return k;
}

/**
 * @typedef {{ full: boolean, shift: number, from: number, carry: number }} ScrollPlan
 *   How to bring a painted view up to date: repaint it whole, or move its
 *   pixels `shift` columns left and repaint from column `from`; `carry` is the
 *   fraction of a column the move still owes.
 */

/**
 * `plan`, written in place to `full`, `shift` and `carry`, its `from` the column the repaint starts at.
 *
 * @param {ScrollPlan} plan
 * @param {boolean} full
 * @param {number} shift
 * @param {number} carry
 * @returns {ScrollPlan}
 */
function setPlan(plan, full, shift, carry) {
  plan.full = full;
  plan.shift = shift;
  plan.from = full ? 0 : Math.max(0, W - shift - 1);
  plan.carry = carry;
  return plan;
}

/**
 * What a view painted with its right edge at `prev` needs to show `next`: the
 * whole raster again when there is no `prev` to scroll from, when the edge
 * went backwards, or when it moved a whole width; else the columns the edge's
 * movement pushes in from the right, and the seam column before them. The
 * plan is written into `into`.
 *
 * @param {{ edge: number, carry: number } | null} prev  edge, playback, ms
 * @param {{ edge: number, span: number }} next  edge and span, playback, ms
 * @param {ScrollPlan} [into]  a new plan when none is handed
 * @returns {ScrollPlan} `into`
 */
export function scrollPlan(prev, next, into = { full: true, shift: 0, from: 0, carry: 0 }) {
  if (!prev || next.edge < prev.edge) return setPlan(into, true, 0, 0);
  const px = ((next.edge - prev.edge) * W) / next.span + prev.carry;
  const shift = Math.floor(px);
  if (shift >= W) return setPlan(into, true, 0, 0);
  return setPlan(into, false, shift, px - shift);
}

/** A level's step on the ramp, from the range's floor to full scale. @param {number} db @param {number} range */
const rampIndex = (db, range) => Math.round(clamp((db + range) / range, 0, 1) * (STEPS - 1));

/**
 * Paint pixel column x of a target's pixels from the slice its reader's blend
 * is set to, blended toward its neighbor, on the ramp from the range's floor.
 *
 * @param {RasterTarget} target
 * @param {number} x
 * @param {Triple[]} ramp
 * @param {number} range  dB from the floor to full scale
 */
function paintColumn({ img, reader }, x, ramp, range) {
  const { data, width } = img;
  const { levels, rows, toward, w } = reader.blend;
  for (let y = 0; y < H; y++) {
    const pos = rows[y];
    if (pos < 0) continue;
    const here = levelAt(levels, pos);
    const c = ramp[rampIndex(toward ? here + (levelAt(toward, pos) - here) * w : here, range)];
    const p = (y * width + x) * 4;
    data[p] = c[0];
    data[p + 1] = c[1];
    data[p + 2] = c[2];
    data[p + 3] = 255;
  }
}
