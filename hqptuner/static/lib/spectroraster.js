// The spectrogram's pixels, apart from any canvas: hex colors read as RGB, a
// color ramp blended in oklab between hex stops, and the raster a view paints
// with it. Time across, newest at the right; frequency up, linear from 0 Hz to
// the view's top; level as a step on the ramp, from the range's floor to full
// scale.
//
// A slice is a column of rows from 0 Hz to the Nyquist it was measured at, one
// byte a row at ROW_STEP_DB below full scale (store/meter/spectrogram.js). Each
// stands where its own stamp says, against the window's right edge, the
// playhead. A pixel blends the two nearest
// rows in frequency and the two nearest slices in time, so the field reads as
// continuous rather than as a grid of rows and slices. Playback no slice covers
// is left unpainted, and no column blends across it.
//
// A paint reads the history by index and allocates nothing whose size grows
// with it: the slices it draws are found by binary search, and walked
// once from left to right.

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
const ROW_STEP_DB = 1.2;

/** @param {number} c 0..1 */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
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
 * The frequency at the center of each pixel row, top row first.
 *
 * @param {number} top
 * @returns {number[]}
 */
const rowFreqs = (top) => Array.from({ length: H }, (_, y) => (top * (H - 0.5 - y)) / H);

/**
 * Each pixel row's position among a slice's rows, fractional so a pixel between
 * two rows blends them, or -1 above the slice's Nyquist. Row r of `rows` spans
 * [r, r + 1) of `rows` parts of the Nyquist, so its center sits at r + 0.5.
 *
 * @param {number} nyquist
 * @param {number} rows
 * @param {number[]} freqs
 * @returns {Float32Array}
 */
function rowTable(nyquist, rows, freqs) {
  return Float32Array.from(freqs, (f) =>
    f > nyquist ? -1 : Math.min(rows - 1, Math.max(0, (f / nyquist) * rows - 0.5)),
  );
}

/**
 * @typedef {object} Reader
 *   What one raster call reads the drawn slices with: the view, the pixel rows'
 *   frequencies, and the row tables built so far, one per Nyquist and row
 *   count, so slices measured alike share one and blend across their seams.
 * @property {RasterView} view
 * @property {number[]} freqs
 * @property {{ nyquist: number, rows: number, table: Float32Array }[]} tables
 */

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
 * does. Slices lie end to end in stamp order, so their ends rise with index.
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
 * @param {Reader} reader
 * @param {number} i
 * @param {number} t  playback, ms
 * @param {Blend} blend
 */
function blendAt(reader, i, t, blend) {
  const { slices, lo, hi, pick, edge } = reader.view;
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
 * The spectrogram's pixels for one view from pixel column `from` to the right
 * edge, RGBA row by row from the top; a pixel no slice covers stays transparent
 * black. Column x of the result is column `from + x` of the whole view, whose
 * left edge is playback `edge - span`.
 *
 * @param {Triple[]} ramp floor first, as `rampFrom` returns it
 * @param {RasterView} view
 * @param {number} [from]
 * @returns {{ width: number, height: number, data: Uint8ClampedArray }}
 */
export function rasterize(ramp, view, from = 0) {
  const { slices, hi, edge, span, range, top } = view;
  const width = W - from;
  const data = new Uint8ClampedArray(width * H * 4);
  /** @type {Reader} */
  const reader = { view, freqs: rowFreqs(top), tables: [] };
  /** @type {Blend} */
  const blend = { levels: new Uint8Array(0), rows: new Float32Array(0), toward: null, w: 0 };
  /** @param {number} db */
  const color = (db) => ramp[rampIndex(db, range)];
  /** @param {number} x @returns {number} playback, ms, at the center of pixel column x */
  const timeAt = (x) => edge - span + ((x + 0.5) * span) / W;
  let i = firstEndingAfter(view, timeAt(from));
  for (let x = from; x < W && i < hi; x++) {
    const t = timeAt(x);
    i = nextEndingAfter(view, i, t);
    if (i < hi && t >= /** @type {Cell} */ (slices[i]).at) {
      blendAt(reader, i, t, blend);
      paintColumn({ data, width }, x - from, blend, color);
    }
  }
  return { width, height: H, data };
}

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

/** @type {ScrollPlan} */
const FULL = { full: true, shift: 0, from: 0, carry: 0 };

/**
 * What a view painted with its right edge at `prev` needs to show `next`: the
 * whole raster again when anything but the edge changed (the key names it),
 * when the edge went backwards, or when it moved a whole width; else the
 * columns the edge's movement pushes in from the right, and the seam column
 * before them.
 *
 * @param {{ key: string, edge: number, carry: number } | null} prev  edge, playback, ms
 * @param {{ key: string, edge: number, span: number }} next  edge and span, playback, ms
 * @returns {ScrollPlan}
 */
export function scrollPlan(prev, next) {
  if (!prev || prev.key !== next.key || next.edge < prev.edge) return FULL;
  const px = ((next.edge - prev.edge) * W) / next.span + prev.carry;
  const shift = Math.floor(px);
  if (shift >= W) return FULL;
  return { full: false, shift, from: Math.max(0, W - shift - 1), carry: px - shift };
}

/** A level's step on the ramp, from the range's floor to full scale. @param {number} db @param {number} range */
const rampIndex = (db, range) => Math.round(clamp((db + range) / range, 0, 1) * (STEPS - 1));

/**
 * Paint one pixel column x of an image from a slice blended toward its
 * neighbor.
 *
 * @param {{ data: Uint8ClampedArray, width: number }} img
 * @param {number} x
 * @param {Blend} blend
 * @param {(db: number) => Triple} color
 */
function paintColumn({ data, width }, x, { levels, rows, toward, w }, color) {
  for (let y = 0; y < H; y++) {
    const pos = rows[y];
    if (pos < 0) continue;
    const here = levelAt(levels, pos);
    const [r, g, b] = color(toward ? here + (levelAt(toward, pos) - here) * w : here);
    const p = (y * width + x) * 4;
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
    data[p + 3] = 255;
  }
}
