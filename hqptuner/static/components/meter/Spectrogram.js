// The METER page's spectrogram: time across, newest at the right, on the
// apodizing strip's time axis; frequency up, log from 20 Hz or linear from 0,
// to the source Nyquist; level as color on the --spec-* ramp, from the chosen
// range's floor to full scale.
//
// Drawn on a canvas, outside preact's render: a signals effect repaints it
// whenever the columns, the channel, the range, the scale or the time axis
// change. The canvas takes its colors from the ramp tokens, read with
// getComputedStyle, and blends between them in oklab as the strip's color-mix
// does, so the two charts read on one scale. A pixel blends the two nearest band
// centres in frequency and the two nearest slices in time, so the field reads
// as continuous rather than as a grid of bands and polls. An interval with no
// feed frame is left unpainted.
//
// The frequency axis is HTML beside the canvas: labels in a gutter on the left,
// each with a tick out to the plot's edge.
import { useRef, useEffect } from "preact/hooks";
import { effect } from "@preact/signals";
import { html } from "../../lib/dom.js";
import { apodVisibleBins } from "../../store/apodhistory.js";
import { meterGeometry } from "../../store/meter/feed.js";
import { spectrogramCells } from "../../store/meter/spectrogram.js";
import { apodWindow, meterRange, meterScale } from "../../store/ui/prefs.js";
import { STOPS, windowSpan } from "../ApodStrip.js";
import { fmtHz } from "../plots.js";

/** @typedef {import("../../store/meter/spectrogram.js").Cell} Cell */
/** @typedef {[number, number, number]} Triple */

// Canvas pixels; CSS stretches them over the plot box.
const W = 1200;
const H = 480;
const LOW_HZ = 20;
const DEFAULT_NYQUIST = 22050;
const LOG_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
const STEPS = 256;

/**
 * Where a frequency sits on the axis, from 0 at the bottom to 1 at the top.
 *
 * @param {number} f
 * @param {number} top
 * @param {string} scale
 */
const axisFrac = (f, top, scale) =>
  scale === "linear" ? f / top : Math.log(Math.max(f, LOW_HZ) / LOW_HZ) / Math.log(top / LOW_HZ);

/**
 * The labelled frequencies: the 1-2-5 ladder on a log axis, even steps on a
 * linear one, at most five or six whichever the Nyquist.
 *
 * @param {number} top
 * @param {string} scale
 * @returns {number[]}
 */
function freqTicks(top, scale) {
  if (scale !== "linear") return LOG_TICKS.filter((f) => f < top);
  const step = top <= 30000 ? 5000 : top <= 60000 ? 10000 : 20000;
  return Array.from({ length: Math.ceil(top / step) }, (_, i) => i * step);
}

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
 * The ramp as a lookup table, floor first: STEPS colors blended between the
 * tokens' control points.
 *
 * @param {Element} el
 * @returns {Triple[]}
 */
function readRamp(el) {
  const css = getComputedStyle(el);
  const stops = STOPS.map((name) => toOklab(parseHex(css.getPropertyValue(name))));
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
 * @param {string} scale
 * @returns {number[]}
 */
const rowFreqs = (top, scale) =>
  Array.from({ length: H }, (_, y) => {
    const u = (H - 0.5 - y) / H;
    return scale === "linear" ? top * u : LOW_HZ * (top / LOW_HZ) ** u;
  });

/**
 * Each row's position among one column's bands, fractional so a row between two
 * centres blends them, or -1 above the column's Nyquist. Band centres sit 1/12
 * octave apart from the first.
 *
 * @param {Cell} cell
 * @param {number[]} freqs
 * @returns {Float32Array}
 */
function rowBands(cell, freqs) {
  const first = cell.centres[0] || 1;
  const last = cell.centres.length - 1;
  return Float32Array.from(freqs, (f) =>
    f > cell.nyquist ? -1 : Math.min(last, Math.max(0, 12 * Math.log2(Math.max(f, 1) / first))),
  );
}

/**
 * @typedef {{ start: number, end: number, levels: Float32Array | null, rows: Float32Array | null }} Span
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
  // One row table per band layout, so slices of one layout share it and blend
  // across the columns' seams.
  /** @type {Map<number[], Float32Array>} */
  const tables = new Map();
  let at = span - cells.reduce((sum, c) => sum + c.ms, 0);
  for (const cell of cells) {
    if (!cell.slices.length) {
      out.push({ start: at, end: at + cell.ms, levels: null, rows: null });
    } else {
      const rows = tables.get(cell.centres) || rowBands(cell, freqs);
      tables.set(cell.centres, rows);
      const w = cell.ms / cell.slices.length;
      cell.slices.forEach((levels, j) => out.push({ start: at + j * w, end: at + (j + 1) * w, levels, rows }));
    }
    at += cell.ms;
  }
  return out;
}

/**
 * A slice's level at a fractional band position, blended between the two
 * nearest centres.
 *
 * @param {Float32Array} levels
 * @param {number} pos
 */
function levelAt(levels, pos) {
  const k = Math.floor(pos);
  const next = Math.min(levels.length - 1, k + 1);
  return levels[k] + (levels[next] - levels[k]) * (pos - k);
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
 * @param {HTMLCanvasElement} canvas
 * @param {Triple[]} ramp
 * @param {{ cells: Cell[], span: number, range: number, top: number, scale: string }} view
 */
function paint(canvas, ramp, { cells, span, range, top, scale }) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(W, H);
  const slices = layoutSlices(cells, span, rowFreqs(top, scale));
  let i = 0;
  for (let x = 0; x < W; x++) {
    const t = ((x + 0.5) / W) * span;
    while (i < slices.length - 1 && t >= slices[i].end) i++;
    const s = slices[i];
    if (s && t >= s.start)
      paintColumn(img.data, x, { s, ...neighbour(slices, i, t) }, (db) => ramp[rampIndex(db, range)]);
  }
  ctx.putImageData(img, 0, 0);
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

/** The top of the frequency axis: the source Nyquist, or a CD source's before the first geometry. */
const axisTop = () => (meterGeometry.value || { nyquist: DEFAULT_NYQUIST }).nyquist;

/** The strip's window width over its visible bins, in milliseconds. */
const currentSpan = () => windowSpan(apodVisibleBins.value, apodWindow.value);

/** @param {number} frac 0..1 */
const pct = (frac) => `${(frac * 100).toFixed(2)}%`;

/**
 * The spectrogram as two cells of the page's recorder grid: the frequency
 * gutter, then the plot.
 */
export function Spectrogram() {
  const ref = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ramp = readRamp(canvas);
    return effect(() => {
      paint(canvas, ramp, {
        cells: spectrogramCells.value,
        span: currentSpan(),
        range: Number(meterRange.value),
        top: axisTop(),
        scale: meterScale.value,
      });
    });
  }, []);
  const top = axisTop();
  const scale = meterScale.value;
  const ticks = freqTicks(top, scale).map((f) => ({ f, at: pct(axisFrac(f, top, scale)) }));
  return html`
    <div class="mt-spec-axis">
      ${ticks.map((t) => html`<span class="mt-spec-tick t-micro" style="bottom: ${t.at}">${fmtHz(t.f)}</span>`)}
    </div>
    <div class="mt-spec-trough">
      <canvas ref=${ref} width=${W} height=${H} role="img" aria-label="Spectrogram"></canvas>
    </div>
  `;
}
