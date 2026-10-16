// The Source meter's two canvases, painted outside preact's render, each by a signals effect of its own. The
// spectrogram scrolls by the playhead's movement: its right edge is the playhead (store/meter/spectrogram.js
// spectrogramRange), and a move of it shifts the painted pixels left by the columns that playback covers and paints only
// those columns and the seam before them (lib/spectroraster.js scrollPlan); a change of channel, range, window,
// frequency span or the source's geometry repaints it whole. The apodizing strip's right edge is the same playhead (stripEnd), so the two scroll
// together; it repaints whole when its events, the window or that edge change. Neither is painted while the Source
// drawer is closed, nor subscribed to what it paints, and reopening the drawer repaints the spectrogram whole. Colors
// come from the stylesheet's tokens, read once on mount: the spectrogram's --spec-* ramp, the glass where no slice
// lies, and the strip's events from the glass toward --bad.

import { useEffect } from "preact/hooks";
import { effect } from "@preact/signals";
import { H, W, rasterize, rgb, scrollPlan } from "../../../../lib/spectroraster.js";
import { apodRamp } from "../../../../model/gauges/meter/meter-plot.js";
import { apodBins } from "../../../../store/apodhistory.js";
import { sourceMeter, stripEvents } from "../../../../store/faceplate/drawers/source.js";
import { openStage } from "../../../../store/faceplate/view.js";
import { spectrogramRange, stripEnd } from "../../../../store/meter/spectrogram.js";
import { specRamp } from "../../tokencolors.js";

/** @typedef {[number, number, number]} Triple */
/** @typedef {import("../../../../lib/spectroraster.js").RasterView} RasterView */
/** @typedef {{ ramp: Triple[], glass: number[], strip: number[][] }} Colors */
/** @typedef {{ current: HTMLCanvasElement | null }} CanvasRef */

/** The spectrogram canvas's pixel size; CSS stretches it over the plot. */
export const SPEC_SIZE = { width: W, height: H };

const OPAQUE = 255;

/** The rail stage whose drawer holds both canvases. */
const STAGE = "source";

/**
 * The colors both canvases paint with, read from the tokens in force on `el`.
 *
 * @param {Element} el
 * @returns {Colors}
 */
function readColors(el) {
  const cs = getComputedStyle(el);
  const lut = specRamp(cs);
  const glass = rgb(cs.getPropertyValue("--glass"), [8, 9, 11]);
  const bad = rgb(cs.getPropertyValue("--bad"), [224, 88, 75]);
  const ramp = Array.from(
    { length: lut.length / 3 },
    (_, i) => /** @type {Triple} */ ([lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]]),
  );
  return { ramp, glass, strip: apodRamp(glass, bad) };
}

/**
 * Write one RGB color, opaque, at pixel `p`.
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
 * view's top, glass where none lies.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Colors} colors
 * @param {RasterView} view
 * @param {number} from
 */
function paintSpectrogram(canvas, colors, view, from) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height, data } = rasterize(colors.ramp, view, from);
  for (let p = 0; p < width * height; p++) if (data[p * 4 + 3] === 0) put(data, p, colors.glass);
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
 * Paint the apodizing strip: one color per pixel column, by the events under it.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Colors} colors
 * @param {{ span: number, end: number }} at  ms, the window and the track position its right edge shows
 */
function paintStrip(canvas, colors, at) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const events = stripEvents(apodBins.value, at.span, canvas.width, at.end);
  const img = ctx.createImageData(canvas.width, 1);
  events.forEach((n, x) => put(img.data, x, colors.strip[n]));
  ctx.putImageData(img, 0, 0);
}

/**
 * Keep both canvases painted while they are mounted and the Source drawer is open.
 *
 * @param {CanvasRef} spec
 * @param {CanvasRef} strip
 */
export function useMeterPaint(spec, strip) {
  useEffect(() => {
    const s = spec.current;
    const a = strip.current;
    if (!s || !a) return undefined;
    const colors = readColors(s);
    /** @type {{ key: string, edge: number, carry: number } | null} */
    let painted = null;
    const spectrogram = effect(() => {
      if (openStage.value !== STAGE) {
        painted = null;
        return;
      }
      const { span, range, top, channel } = sourceMeter();
      const { slices, lo, hi, edge: at } = spectrogramRange.value;
      const edge = at ?? 0;
      const key = [span, range, top, channel].join(" ");
      const plan = scrollPlan(painted, { key, edge, span });
      painted = { key, edge, carry: plan.carry };
      const view = { slices, lo, hi, pick: channel, edge, span, range, top };
      if (plan.full) {
        paintSpectrogram(s, colors, view, 0);
      } else if (plan.shift) {
        scrollLeft(s, plan.shift);
        paintSpectrogram(s, colors, view, plan.from);
      }
    });
    const stripe = effect(() => {
      if (openStage.value === STAGE) paintStrip(a, colors, { span: sourceMeter().span, end: stripEnd.value ?? 0 });
    });
    return () => {
      spectrogram();
      stripe();
    };
  }, []);
}
