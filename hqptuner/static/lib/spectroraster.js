// The spectrogram's pixels, apart from any canvas: a colour ramp blended in
// oklab between hex stops, and the raster a view paints with it. Time across,
// newest at the right; frequency up, linear from 0 Hz to the view's top; level
// as a step on the ramp, from the range's floor to full scale.
//
// A slice is a column of rows from 0 Hz to the Nyquist it was measured at, one
// byte a row at ROW_STEP_DB below full scale (store/meter/spectrogram.js). A
// pixel blends the two nearest rows in frequency and the two nearest slices in
// time, so the field reads as continuous rather than as a grid of rows and
// slices. An interval with no feed frame is left unpainted.

/**
 * @typedef {{ ms: number, slices: Uint8Array[], nyquist: number }} Cell
 *   One visible column in one channel; `slices` is empty where the interval
 *   carried no frame.
 */
/** @typedef {[number, number, number]} Triple */

// Raster pixels; CSS stretches them over the plot box.
export const W = 1200;
export const H = 480;
const STEPS = 256;
const ROW_STEP_DB = 0.5;

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
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return /** @type {Triple} */ (rgb.map((c) => Math.round(255 * Math.min(1, Math.max(0, toSrgb(c))))));
}

/** @param {string} hex `#rrggbb` @returns {Triple} 0..1 sRGB */
function parseHex(hex) {
  const n = parseInt(hex.trim().slice(1), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * The ramp as a lookup table, floor first: STEPS colors blended in oklab
 * between the stops' control points.
 *
 * @param {string[]} hexStops `#rrggbb` each, floor first
 * @returns {Triple[]} 0..255 sRGB
 */
export function rampFrom(hexStops) {
  const stops = hexStops.map((hex) => toOklab(parseHex(hex)));
  return Array.from({ length: STEPS }, (_, i) => {
    const pos = (i / (STEPS - 1)) * (stops.length - 1);
    const seg = Math.min(stops.length - 2, Math.floor(pos));
    const t = pos - seg;
    const [a, b] = [stops[seg], stops[seg + 1]];
    return fromOklab([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  });
}

/**
 * The frequency at the centre of each pixel row, top row first.
 *
 * @param {number} top
 * @returns {number[]}
 */
const rowFreqs = (top) => Array.from({ length: H }, (_, y) => (top * (H - 0.5 - y)) / H);

/**
 * Each pixel row's position among a slice's rows, fractional so a pixel between
 * two rows blends them, or -1 above the slice's Nyquist. Row r of `rows` spans
 * [r, r + 1) of `rows` parts of the Nyquist, so its centre sits at r + 0.5.
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
 * @typedef {{ start: number, end: number, levels: Uint8Array | null, rows: Float32Array | null }} Span
 *   One slice laid on the time axis, in milliseconds from the window's left
 *   edge; `levels` is null across an interval that carried no frame.
 */

/**
 * The visible slices laid out along the window, oldest first: each column
 * right-aligned to its bin's slot, its slot divided evenly among its slices.
 *
 * @param {Cell[]} cells
 * @param {number} span
 * @param {number[]} freqs
 * @returns {Span[]}
 */
function layoutSlices(cells, span, freqs) {
  /** @type {Span[]} */
  const out = [];
  // One row table per Nyquist and row count, so slices measured alike share it
  // and blend across the columns' seams.
  /** @type {Map<string, Float32Array>} */
  const tables = new Map();
  let at = span - cells.reduce((sum, c) => sum + c.ms, 0);
  for (const cell of cells) {
    if (!cell.slices.length) {
      out.push({ start: at, end: at + cell.ms, levels: null, rows: null });
    } else {
      const n = cell.slices[0].length;
      const key = `${cell.nyquist}:${n}`;
      const rows = tables.get(key) || rowTable(cell.nyquist, n, freqs);
      tables.set(key, rows);
      const w = cell.ms / cell.slices.length;
      cell.slices.forEach((levels, j) => out.push({ start: at + j * w, end: at + (j + 1) * w, levels, rows }));
    }
    at += cell.ms;
  }
  return out;
}

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
 * The slice a pixel column blends toward: the neighbour on the side of the
 * slice's centre the pixel falls, and how far toward it, from 0 at the centre
 * to 0.5 at the shared edge. No blend across an empty interval or a change of
 * band layout.
 *
 * @param {Span[]} slices
 * @param {number} i
 * @param {number} t
 * @returns {{ other: Span | null, w: number }}
 */
function neighbour(slices, i, t) {
  const s = slices[i];
  const mid = (s.start + s.end) / 2;
  const other = t < mid ? slices[i - 1] : slices[i + 1];
  if (!other || !other.levels || other.rows !== s.rows) return { other: null, w: 0 };
  const omid = (other.start + other.end) / 2;
  return { other, w: (t - mid) / (omid - mid) };
}

/**
 * The spectrogram's pixels for one view, RGBA row by row from the top; a pixel
 * no slice covers stays transparent black.
 *
 * @param {Triple[]} ramp floor first, as `rampFrom` returns it
 * @param {{ cells: Cell[], span: number, range: number, top: number }} view
 * @returns {{ width: number, height: number, data: Uint8ClampedArray }}
 */
export function rasterize(ramp, { cells, span, range, top }) {
  const data = new Uint8ClampedArray(W * H * 4);
  const slices = layoutSlices(cells, span, rowFreqs(top));
  let i = 0;
  for (let x = 0; x < W; x++) {
    const t = ((x + 0.5) / W) * span;
    while (i < slices.length - 1 && t >= slices[i].end) i++;
    const s = slices[i];
    if (s && t >= s.start) paintColumn(data, x, { s, ...neighbour(slices, i, t) }, (db) => ramp[rampIndex(db, range)]);
  }
  return { width: W, height: H, data };
}

/** A level's step on the ramp, from the range's floor to full scale. @param {number} db @param {number} range */
const rampIndex = (db, range) => Math.round(Math.min(1, Math.max(0, (db + range) / range)) * (STEPS - 1));

/**
 * Paint one pixel column from a slice, blended toward its neighbour.
 *
 * @param {Uint8ClampedArray} data
 * @param {number} x
 * @param {{ s: Span, other: Span | null, w: number }} blend
 * @param {(db: number) => Triple} color
 */
function paintColumn(data, x, { s, other, w }, color) {
  const { levels, rows } = s;
  if (!levels || !rows) return;
  const toward = other ? other.levels : null;
  for (let y = 0; y < H; y++) {
    const pos = rows[y];
    if (pos < 0) continue;
    const here = levelAt(levels, pos);
    const [r, g, b] = color(toward ? here + (levelAt(toward, pos) - here) * w : here);
    const p = (y * W + x) * 4;
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
    data[p + 3] = 255;
  }
}
