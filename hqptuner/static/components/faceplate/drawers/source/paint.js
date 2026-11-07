// The Source meter's two canvases, painted outside preact's render by one painter per mount, each canvas by a signals
// effect of its own. The spectrogram scrolls by the playhead's movement: its right edge is the playhead
// (store/meter/spectrogram.js spectrogramRange), and a move of it shifts the painted pixels left by the columns that
// playback covers and paints only those columns and the seam before them (lib/spectroraster.js scrollPlan); a change of
// channel, range, window, frequency span or the source's geometry repaints it whole. The apodizing strip's right edge is
// the same playhead (stripEnd), so the two scroll together; it repaints whole when its events, the window or that edge
// change. Neither is painted while the Source drawer is closed, nor subscribed to what it paints, and reopening the
// drawer repaints the spectrogram whole. Colors come from the tokens the painter is handed, read once when it is
// created: the spectrogram's --spec-* ramp, the glass where no slice lies, and the strip's events from the glass toward
// --bad. Each canvas's pixels are one image the painter holds and paints into, never made anew for a paint: a scroll
// paints the columns it repaints into the image's left part and puts only that part.

import { useEffect } from "preact/hooks";
import { effect } from "@preact/signals";
import { styleOf } from "../../../../lib/dom.js";
import { H, W, rasterTarget, rasterize, rgb, scrollPlan } from "../../../../lib/spectroraster.js";
import { apodRamp } from "../../../../model/gauges/meter/meter-plot.js";
import { apodBins } from "../../../../store/apodhistory.js";
import { sourceMeter, stripEvents } from "../../../../store/faceplate/drawers/source.js";
import { openStage } from "../../../../store/faceplate/view.js";
import { spectrogramRange, stripEnd } from "../../../../store/meter/spectrogram.js";
import { specRamp } from "../../tokencolors.js";

/** @typedef {[number, number, number]} Triple */
/** @typedef {import("../../../../lib/spectroraster.js").RasterView} RasterView */
/** @typedef {import("../../../../lib/spectroraster.js").RasterTarget} RasterTarget */
/** @typedef {import("../../../../lib/spectroraster.js").ScrollPlan} ScrollPlan */
/** @typedef {{ ramp: Triple[], glass: number[], strip: number[][] }} Colors */
/** @typedef {{ current: HTMLCanvasElement | null }} CanvasRef */

/** The spectrogram canvas's pixel size; CSS stretches it over the plot. */
export const SPEC_SIZE = { width: W, height: H };

const OPAQUE = 255;

/** The rail stage whose drawer holds both canvases. */
const STAGE = "source";

/**
 * The colors both canvases paint with, read from `tokens`.
 *
 * @param {CSSStyleDeclaration} tokens  the tokens in force on the canvases, as `getComputedStyle` reads them
 * @returns {Colors}
 */
function readColors(tokens) {
  const lut = specRamp(tokens);
  const glass = rgb(tokens.getPropertyValue("--glass"), [8, 9, 11]);
  const bad = rgb(tokens.getPropertyValue("--bad"), [224, 88, 75]);
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
 * @typedef {object} Spectrogram
 *   One painter's spectrogram canvas and what it keeps from paint to paint: the canvas-sized pixels every paint
 *   writes into, the raster target written through, the view handed to it, and the edge, the plan and whether the
 *   canvas shows the view's span, range, top and channel.
 * @property {HTMLCanvasElement} canvas
 * @property {CanvasRenderingContext2D} ctx
 * @property {Colors} colors
 * @property {ImageData} img
 * @property {RasterTarget} target
 * @property {RasterView} view
 * @property {{ edge: number, carry: number }} painted  edge, playback, ms
 * @property {{ edge: number, span: number }} next  edge and span, playback, ms
 * @property {ScrollPlan} plan
 * @property {boolean} shown
 */

/**
 * Paint the spectrogram from pixel column `from` to the right edge: the visible slices on the linear axis to the
 * view's top, glass where none lies. The held pixels' first `W - from` columns take those canvas columns, and only
 * they are put.
 *
 * @param {Spectrogram} sg
 * @param {number} from
 */
function paintSpectrogram(sg, from) {
  const { img } = sg;
  const width = W - from;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < width; x++) put(img.data, y * img.width + x, sg.colors.glass);
  }
  rasterize(sg.colors.ramp, sg.view, from, sg.target);
  sg.ctx.putImageData(img, from, 0, 0, 0, width, H);
}

/**
 * Point the held view at what the spectrogram shows now, and say whether the canvas still shows its span, range, top
 * and channel.
 *
 * @param {Spectrogram} sg
 * @returns {boolean}
 */
function readView(sg) {
  const { span, range, top, channel } = sourceMeter();
  const { slices, lo, hi, edge } = spectrogramRange.value;
  const view = sg.view;
  const same = sg.shown && view.span === span && view.range === range && view.top === top && view.pick === channel;
  view.slices = slices;
  view.lo = lo;
  view.hi = hi;
  view.pick = channel;
  view.edge = edge ?? 0;
  view.span = span;
  view.range = range;
  view.top = top;
  return same;
}

/**
 * Bring the spectrogram up to date with the view: whole when it changed, else by scrolling the playhead's movement.
 *
 * @param {Spectrogram} sg
 */
function paintView(sg) {
  const same = readView(sg);
  sg.next.edge = sg.view.edge;
  sg.next.span = sg.view.span;
  const plan = scrollPlan(same ? sg.painted : null, sg.next, sg.plan);
  sg.painted.edge = sg.view.edge;
  sg.painted.carry = plan.carry;
  sg.shown = true;
  if (plan.full) {
    paintSpectrogram(sg, 0);
  } else if (plan.shift) {
    sg.ctx.drawImage(sg.canvas, plan.shift, 0, W - plan.shift, H, 0, 0, W - plan.shift, H);
    paintSpectrogram(sg, plan.from);
  }
}

/**
 * The spectrogram's effect: kept painted while the Source drawer is open, left alone while it is closed.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasRenderingContext2D} ctx
 * @param {Colors} colors
 * @returns {() => void}
 */
function spectrogramPaint(canvas, ctx, colors) {
  const img = ctx.createImageData(W, H);
  /** @type {Spectrogram} */
  const sg = {
    canvas,
    ctx,
    colors,
    img,
    target: rasterTarget(img),
    view: { slices: [], lo: 0, hi: 0, pick: "sum", edge: 0, span: 0, range: 0, top: 0 },
    painted: { edge: 0, carry: 0 },
    next: { edge: 0, span: 0 },
    plan: { full: true, shift: 0, from: 0, carry: 0 },
    shown: false,
  };
  return () => {
    if (openStage.value !== STAGE) {
      sg.shown = false;
      return;
    }
    paintView(sg);
  };
}

/**
 * The apodizing strip's effect: one color per pixel column, by the events under it, while the Source drawer is open.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasRenderingContext2D} ctx
 * @param {Colors} colors
 * @returns {() => void}
 */
function stripPaint(canvas, ctx, colors) {
  const img = ctx.createImageData(canvas.width, 1);
  const events = new Uint8Array(img.width);
  return () => {
    if (openStage.value !== STAGE) return;
    stripEvents(apodBins.value, sourceMeter().span, stripEnd.value ?? 0, events);
    for (let x = 0; x < events.length; x++) put(img.data, x, colors.strip[events[x]]);
    ctx.putImageData(img, 0, 0);
  };
}

/**
 * Paint both canvases now, unless the Source drawer is closed, and keep them painted while it is open; hand back the
 * disposer that stops it.
 *
 * @param {HTMLCanvasElement} spec
 * @param {HTMLCanvasElement} strip
 * @param {CSSStyleDeclaration} tokens  the tokens in force on the canvases, as `getComputedStyle` reads them
 * @returns {() => void}
 */
export function meterPainter(spec, strip, tokens) {
  const colors = readColors(tokens);
  const specCtx = spec.getContext("2d");
  const stripCtx = strip.getContext("2d");
  if (!specCtx || !stripCtx) return () => undefined;
  const spectrogram = effect(spectrogramPaint(spec, specCtx, colors));
  const stripe = effect(stripPaint(strip, stripCtx, colors));
  return () => {
    spectrogram();
    stripe();
  };
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
    return meterPainter(s, a, styleOf(s));
  }, []);
}
