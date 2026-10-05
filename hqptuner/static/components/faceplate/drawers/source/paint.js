// The Source meter's two canvases, painted outside preact's render: a signals effect repaints the spectrogram and the
// apodizing strip whenever the history, the channel, the range, the window or the source's geometry change. Colours
// come from the stylesheet's tokens, read once on mount: the spectrogram's --spec-* ramp, the glass where no slice
// lies, and the strip's events from the glass toward --bad.

import { useEffect } from "preact/hooks";
import { effect } from "@preact/signals";
import { H, W, rasterize } from "../../../../lib/spectroraster.js";
import { apodRamp, rampLut } from "../../../../model/gauges/meter-plot.js";
import { apodVisibleBins } from "../../../../store/apodhistory.js";
import { sourceMeter, stripEvents } from "../../../../store/faceplate/drawers/source.js";
import { spectrogramCells } from "../../../../store/meter/spectrogram.js";

/** @typedef {[number, number, number]} Triple */
/** @typedef {{ ramp: Triple[], glass: number[], strip: number[][] }} Colours */
/** @typedef {{ current: HTMLCanvasElement | null }} CanvasRef */

/** The spectrogram canvas's pixel size; CSS stretches it over the plot. */
export const SPEC_SIZE = { width: W, height: H };

const RAMP = ["--spec-0", "--spec-1", "--spec-2", "--spec-3", "--spec-4", "--spec-5"];
const OPAQUE = 255;

/**
 * A colour token's value as [r, g, b], or `fallback` when it is not a hex colour.
 *
 * @param {string} value
 * @param {number[]} fallback
 * @returns {number[]}
 */
function rgb(value, fallback) {
  const m = value.trim().replace("#", "");
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(m)) return fallback;
  const full = m.length === 3 ? [...m].map((c) => c + c).join("") : m;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/**
 * The colours both canvases paint with, read from the tokens in force on `el`.
 *
 * @param {Element} el
 * @returns {Colours}
 */
function readColours(el) {
  const cs = getComputedStyle(el);
  const lut = rampLut(RAMP.map((n, i) => rgb(cs.getPropertyValue(n), [i * 50, i * 40, i * 20])));
  const glass = rgb(cs.getPropertyValue("--glass"), [8, 9, 11]);
  const bad = rgb(cs.getPropertyValue("--bad"), [224, 88, 75]);
  const ramp = Array.from(
    { length: lut.length / 3 },
    (_, i) => /** @type {Triple} */ ([lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]]),
  );
  return { ramp, glass, strip: apodRamp(glass, bad) };
}

/**
 * Write one RGB colour, opaque, at pixel `p`.
 *
 * @param {Uint8ClampedArray} data
 * @param {number} p
 * @param {ArrayLike<number>} c
 */
function put(data, p, c) {
  data[p * 4] = c[0];
  data[p * 4 + 1] = c[1];
  data[p * 4 + 2] = c[2];
  data[p * 4 + 3] = OPAQUE;
}

/**
 * Paint the spectrogram: the visible slices on the linear axis to the source Nyquist, glass where none lies.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Colours} colours
 * @param {{ span: number, range: number, nyquist: number }} view
 */
function paintSpectrogram(canvas, colours, view) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { span, range, nyquist } = view;
  const raster = { cells: spectrogramCells.value, span, range, top: nyquist };
  const { width, height, data } = rasterize(colours.ramp, raster);
  for (let p = 0; p < width * height; p++) if (data[p * 4 + 3] === 0) put(data, p, colours.glass);
  const img = ctx.createImageData(width, height);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
}

/**
 * Paint the apodizing strip: one colour per pixel column, by the events under it.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Colours} colours
 * @param {number} span  ms
 */
function paintStrip(canvas, colours, span) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const events = stripEvents(apodVisibleBins.value, span, canvas.width);
  const img = ctx.createImageData(canvas.width, 1);
  events.forEach((n, x) => put(img.data, x, colours.strip[n]));
  ctx.putImageData(img, 0, 0);
}

/**
 * Keep both canvases painted while they are mounted.
 *
 * @param {CanvasRef} spec
 * @param {CanvasRef} strip
 */
export function useMeterPaint(spec, strip) {
  useEffect(() => {
    const s = spec.current;
    const a = strip.current;
    if (!s || !a) return undefined;
    const colours = readColours(s);
    return effect(() => {
      const view = sourceMeter();
      paintSpectrogram(s, colours, view);
      paintStrip(a, colours, view.span);
    });
  }, []);
}
