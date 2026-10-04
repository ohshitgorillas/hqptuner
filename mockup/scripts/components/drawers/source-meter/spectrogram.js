// Source meter spectrogram: the apodizing strip over the spectrogram on one time axis, frequency up the side, coloured
// from the --spec-* ramp tokens.

import { h } from "../../../lib/shell/dom.js";
import {
  apodRamp,
  freqTicks,
  rampLut,
  spectrogramIndex,
  timeTicks,
  windowSpan,
} from "../../../../../hqptuner/static/model/gauges/meter-plot.js";
import { minusText } from "../../../../../hqptuner/static/model/shell/format.js";
import { edgeLabels, freqLabels } from "./axes.js";

const COLS = 600; // spectrogram canvas width, px
export const ROWS = 320; // spectrogram canvas rows (frequency, top = Nyquist); stretched to the plot
const RAMP = ["--spec-0", "--spec-1", "--spec-2", "--spec-3", "--spec-4", "--spec-5"];

/**
 * The spectrogram block's elements.
 *
 * @typedef {object} SpectrogramBlock
 * @property {HTMLElement} el
 * @property {HTMLCanvasElement} spec  the spectrogram
 * @property {HTMLCanvasElement} apod  the apodizing strip
 * @property {HTMLElement} gY          frequency axis
 * @property {HTMLElement} tAxis       time axis
 */

/**
 * The colours a paint writes, read from the tokens.
 *
 * @typedef {object} Colours
 * @property {Uint8ClampedArray} lut  spectrogram ramp, [r, g, b] per index
 * @property {number[]} glass         [r, g, b] behind the spectrogram
 * @property {number[][]} apodLut     [r, g, b] per strip event
 */

/**
 * The spectrogram block: head with its title and `controls`, the strip, the spectrogram and their two axes.
 *
 * @param {Node[]} controls
 * @returns {SpectrogramBlock}
 */
export function spectrogramView(controls) {
  const spec = /** @type {HTMLCanvasElement} */ (
    h("canvas.spec", { width: COLS, height: ROWS, role: "img", "aria-label": "Spectrogram" })
  );
  const apod = /** @type {HTMLCanvasElement} */ (
    h("canvas.apodstrip", {
      width: COLS,
      height: 1,
      role: "img",
      "aria-label": "Apodizing events over time",
    })
  );
  const gY = h("div.gut.gy", { "aria-hidden": "true" });
  const tAxis = h("div.xaxis", { "aria-hidden": "true" });
  const el = h(
    "div.mblk",
    {},
    h("div.mhead", {}, h("b.mt", { text: "Spectrogram" }), h("span.grow"), controls),
    h("div.sgrid2", {}, h("span.rowl", { text: "Apodizing" }), apod, gY, spec, h("span"), tAxis),
  );
  return { el, spec, apod, gY, tAxis };
}

/**
 * @param {string} hex       a colour token's value
 * @param {number[]} fallback  [r, g, b] when it is not a hex colour
 * @returns {number[]}
 */
function rgb(hex, fallback) {
  const m = hex.trim().replace("#", "");
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(m)) return fallback;
  const full =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/**
 * Colours from tokens: the spectrogram ramp, the glass behind it and the strip's event colours.
 *
 * @returns {Colours}
 */
function readRamp() {
  const cs = getComputedStyle(document.documentElement);
  const lut = rampLut(RAMP.map((n, i) => rgb(cs.getPropertyValue(n), [i * 50, i * 40, i * 20])));
  const glass = rgb(cs.getPropertyValue("--glass"), [8, 9, 11]);
  const bad = rgb(cs.getPropertyValue("--bad"), [224, 88, 75]);
  return { lut, glass, apodLut: apodRamp(glass, bad) };
}

/**
 * Write the colour indices into the spectrogram's and the strip's pixels.
 *
 * @param {Uint8ClampedArray} d  spectrogram pixels
 * @param {Uint8ClampedArray} a  strip pixels
 * @param {import('../../../../../hqptuner/static/model/gauges/meter-plot.js').SpectrogramIndex} idx
 * @param {Colours} colours
 */
function fillPixels(d, a, idx, colours) {
  const { lut, glass, apodLut } = colours;
  for (let p = 0; p < idx.colour.length; p++) {
    const ci = idx.colour[p],
      o = p * 4;
    if (ci < 0) {
      d[o] = glass[0];
      d[o + 1] = glass[1];
      d[o + 2] = glass[2];
      d[o + 3] = 255;
      continue;
    }
    const li = ci * 3;
    d[o] = lut[li];
    d[o + 1] = lut[li + 1];
    d[o + 2] = lut[li + 2];
    d[o + 3] = 255;
  }
  for (let x = 0; x < idx.events.length; x++) {
    const col = apodLut[idx.events[x]];
    a[x * 4] = col[0];
    a[x * 4 + 1] = col[1];
    a[x * 4 + 2] = col[2];
    a[x * 4 + 3] = 255;
  }
}

/**
 * The time axis under the window: absolute track position for 'all', seconds or minutes back to now otherwise.
 *
 * @param {HTMLElement} tAxis
 * @param {ReturnType<typeof timeTicks>} tt
 */
function paintTimeAxis(tAxis, tt) {
  const { inMin, ticks } = tt;
  edgeLabels(
    tAxis,
    "left",
    ticks.map((t) => ({ at: t.at, text: inMin ? `${minusText(t.value)} min` : `${minusText(t.value)} s` })),
  );
}

/**
 * The spectrogram's painter over `view` (its canvases already in the document): `ramp` reads the colour tokens, `axis`
 * paints the frequency labels, `paint` paints the window of `src`'s history and its time axis.
 *
 * @param {SpectrogramBlock} view
 * @param {import('../source-meter.js').MeterState} st  view state, read at each paint
 * @param {{ nyquist: number, colsPerSec: number }} cfg
 * @param {import('./mock.js').MockHistory} src
 */
export function spectrogramPainter(view, st, cfg, src) {
  const sctx = /** @type {CanvasRenderingContext2D} */ (view.spec.getContext("2d"));
  const actx = /** @type {CanvasRenderingContext2D} */ (view.apod.getContext("2d"));
  const img = sctx.createImageData(COLS, ROWS);
  const aimg = actx.createImageData(COLS, 1);
  /** @type {Colours} set by `ramp`, which runs before the first paint */
  let colours;
  function paint() {
    const total = src.firstIdx + src.hist.length; // columns since track start
    const span = windowSpan(st.window, total, cfg.colsPerSec);
    const off = (st.channel === "sum" ? 2 : Number(st.channel)) * ROWS;
    const idx = spectrogramIndex(src.hist, src.firstIdx, { cols: COLS, rows: ROWS, span, off, range: st.range });
    fillPixels(img.data, aimg.data, idx, colours);
    sctx.putImageData(img, 0, 0);
    actx.putImageData(aimg, 0, 0);
    paintTimeAxis(view.tAxis, timeTicks(span, total, cfg.colsPerSec, st.window === "all"));
  }
  return {
    paint,
    ramp: () => {
      colours = readRamp();
    },
    axis: () =>
      view.gY.replaceChildren(
        ...freqLabels(
          freqTicks(cfg.nyquist, (f) => 1 - f / cfg.nyquist),
          "y",
        ),
      ),
  };
}
