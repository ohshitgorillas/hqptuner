// The METER page's spectrogram: time across, newest at the right, on the
// apodizing strip's time axis; frequency up, log from 20 Hz or linear from 0,
// to the source Nyquist; level as color on the --spec-* ramp, from the chosen
// range's floor to full scale.
//
// Drawn on a canvas, outside preact's render: a signals effect repaints it
// whenever the columns, the channel, the range, the scale or the time axis
// change. The canvas takes its colors from the ramp tokens, read with
// getComputedStyle, and its pixels blend between them, so the two charts read
// on one scale.
//
// The frequency axis is HTML beside the canvas: labels in a gutter on the left,
// each with a tick out to the plot's edge.
import { useRef, useEffect } from "preact/hooks";
import { effect } from "@preact/signals";
import { html } from "../../lib/dom.js";
import { H, LOW_HZ, W, rampFrom, rasterize } from "../../lib/spectroraster.js";
import { apodVisibleBins } from "../../store/apodhistory.js";
import { meterGeometry } from "../../store/meter/feed.js";
import { spectrogramCells } from "../../store/meter/spectrogram.js";
import { apodWindow, meterRange, meterScale } from "../../store/ui/prefs.js";
import { STOPS, windowSpan } from "../ApodStrip.js";
import { fmtHz } from "../plots.js";

/** @typedef {import("../../lib/spectroraster.js").Cell} Cell */
/** @typedef {[number, number, number]} Triple */

const DEFAULT_NYQUIST = 22050;
const LOG_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];

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

/**
 * The ramp as a lookup table, floor first, from the tokens' control points.
 *
 * @param {Element} el
 * @returns {Triple[]}
 */
function readRamp(el) {
  const css = getComputedStyle(el);
  return rampFrom(STOPS.map((name) => css.getPropertyValue(name)));
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Triple[]} ramp
 * @param {{ cells: Cell[], span: number, range: number, top: number, scale: string }} view
 */
function paint(canvas, ramp, view) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height, data } = rasterize(ramp, view);
  const img = ctx.createImageData(width, height);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
}

/**
 * The top of the frequency axis: the source Nyquist, or a CD source's while geometry is null.
 *
 * @param {{ nyquist: number } | null} geometry
 */
const topOf = (geometry) => (geometry || { nyquist: DEFAULT_NYQUIST }).nyquist;

const axisTop = () => topOf(meterGeometry.value);

/**
 * What the canvas paints: the columns across the strip's window width over its
 * visible bins, in milliseconds, from the chosen range's floor, up to the axis top.
 *
 * @param {{ cells: Cell[], bins: { ms: number, n: number }[], window: string, range: string, geometry: { nyquist: number } | null, scale: string }} input
 * @returns {{ cells: Cell[], span: number, range: number, top: number, scale: string }}
 */
export const spectroView = ({ cells, bins, window, range, geometry, scale }) => ({
  cells,
  span: windowSpan(bins, window),
  range: Number(range),
  top: topOf(geometry),
  scale,
});

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
      paint(
        canvas,
        ramp,
        spectroView({
          cells: spectrogramCells.value,
          bins: apodVisibleBins.value,
          window: apodWindow.value,
          range: meterRange.value,
          geometry: meterGeometry.value,
          scale: meterScale.value,
        }),
      );
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
