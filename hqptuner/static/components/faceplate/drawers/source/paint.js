// The Source meter's two canvases, painted outside preact's render, each by a signals effect of its own. The
// spectrogram scrolls: a slice closing moves the painted pixels left by the columns its playback covers and paints only
// those columns and the seam before them (lib/spectroraster.js scrollPlan); a change of channel, range, window or the
// source's geometry repaints it whole. The apodizing strip repaints when its events or the window change. Colours
// come from the stylesheet's tokens, read once on mount: the spectrogram's --spec-* ramp, the glass where no slice
// lies, and the strip's events from the glass toward --bad.

import { useEffect } from "preact/hooks";
import { effect } from "@preact/signals";
import { H, W, rasterize, scrollPlan } from "../../../../lib/spectroraster.js";
import { apodRamp, rampLut } from "../../../../model/gauges/meter-plot.js";
import { apodVisibleBins } from "../../../../store/apodhistory.js";
import { sourceMeter, stripEvents } from "../../../../store/faceplate/drawers/source.js";
import { spectrogramCells, spectrogramEnd } from "../../../../store/meter/spectrogram.js";

/** @typedef {[number, number, number]} Triple */
/** @typedef {import("../../../../lib/spectroraster.js").Cell} Cell */
/** @typedef {{ ramp: Triple[], glass: number[], strip: number[][] }} Colours */
/** @typedef {{ current: HTMLCanvasElement | null }} CanvasRef */

/** The spectrogram canvas's pixel size; CSS stretches it over the plot. */
export const SPEC_SIZE = { width: W, height: H };

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
  const stops = [
    cs.getPropertyValue("--spec-0"),
    cs.getPropertyValue("--spec-1"),
    cs.getPropertyValue("--spec-2"),
    cs.getPropertyValue("--spec-3"),
    cs.getPropertyValue("--spec-4"),
    cs.getPropertyValue("--spec-5"),
  ];
  const lut = rampLut(stops.map((v, i) => rgb(v, [i * 50, i * 40, i * 20])));
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
 * Paint the spectrogram from pixel column `from` to the right edge: the visible slices on the linear axis to the
 * source Nyquist, glass where none lies.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Colours} colours
 * @param {{ span: number, range: number, nyquist: number, cells: Cell[] }} view
 * @param {number} from
 */
function paintSpectrogram(canvas, colours, view, from) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { span, range, nyquist, cells } = view;
  const { width, height, data } = rasterize(colours.ramp, { cells, span, range, top: nyquist }, from);
  for (let p = 0; p < width * height; p++) if (data[p * 4 + 3] === 0) put(data, p, colours.glass);
  const img = ctx.createImageData(width, height);
  img.data.set(data);
  ctx.putImageData(img, from, 0);
}

/**
 * Move the spectrogram's painted pixels `shift` columns left.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} shift
 */
function scrollLeft(canvas, shift) {
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.drawImage(canvas, shift, 0, W - shift, H, 0, 0, W - shift, H);
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
    /** @type {{ key: string, end: number, carry: number } | null} */
    let painted = null;
    const spectrogram = effect(() => {
      const view = sourceMeter();
      const cells = spectrogramCells.value;
      const end = spectrogramEnd.value;
      const key = [view.span, view.range, view.nyquist, view.channel].join(" ");
      const plan = scrollPlan(painted, { key, end, span: view.span });
      painted = { key, end, carry: plan.carry };
      if (plan.full) {
        paintSpectrogram(s, colours, { ...view, cells }, 0);
      } else if (plan.shift) {
        scrollLeft(s, plan.shift);
        paintSpectrogram(s, colours, { ...view, cells }, plan.from);
      }
    });
    const stripe = effect(() => paintStrip(a, colours, sourceMeter().span));
    return () => {
      spectrogram();
      stripe();
    };
  }, []);
}
