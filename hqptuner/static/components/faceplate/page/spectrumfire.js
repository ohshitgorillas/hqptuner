// The flames style of the page spectrum's effects canvas: the heat grid of model/gauges/meter/fire.js, stepped on by the
// time a paint is given, its bottom row lit by the shown columns, drawn a pixel a cell on a small sheet and scaled over
// the whole canvas, heat 0 clear.

import { blaze, fireColors, fireSize, fireSource, freshFlames, stepFlames } from "../../../model/gauges/meter/fire.js";

/** @typedef {import("../../../model/gauges/meter/fire.js").FlamesState} FlamesState */
/** @typedef {import("./spectrumfx.js").CanvasMaker} CanvasMaker */
/** @typedef {import("./spectrumfx.js").Frame} Frame */

/**
 * The small canvas the flames' heat grid is put on, one pixel a cell, and the image put on it.
 *
 * @typedef {object} FireSheet
 * @property {CanvasRenderingContext2D} ctx
 * @property {ImageData} img
 * @property {Uint32Array} cells  the image's pixels, one word a cell
 */

/**
 * The flames between paints: their heat grid, the source row the last paint lit, the canvas size they were made for.
 *
 * @typedef {object} Flames
 * @property {FlamesState} state
 * @property {Uint16Array} source
 * @property {number} w
 * @property {number} h
 */

/**
 * A view of `bytes` four to a word, so a store moves one RGBA pixel whole.
 *
 * @param {Uint8ClampedArray} bytes
 * @returns {Uint32Array}
 */
function words(bytes) {
  return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
}

/**
 * A sheet `cols` by `rows` pixels made by `make`: `held`, unless it is another size. Null where no sheet context can
 * be had.
 *
 * @param {FireSheet | null | undefined} held
 * @param {CanvasMaker} make
 * @param {number} cols
 * @param {number} rows
 * @returns {FireSheet | null}
 */
function fireSheet(held, make, cols, rows) {
  if (held?.img.width === cols && held.img.height === rows) return held;
  const ctx = /** @type {CanvasRenderingContext2D | null} */ (make(cols, rows).getContext("2d"));
  if (!ctx) return null;
  const img = ctx.createImageData(cols, rows);
  return { ctx, img, cells: words(img.data) };
}

/**
 * The flames for a canvas `w` by `h`: the ones held, unless they are another size, then fresh ones on a cold grid.
 *
 * @param {Frame} f
 * @param {number} w
 * @param {number} h
 * @returns {Flames}
 */
function flamesFor(f, w, h) {
  const held = f.state.flames;
  if (held?.w === w && held.h === h) return held;
  const size = fireSize(w, h);
  f.state.flames = { state: freshFlames(size), source: new Uint16Array(size.cols), w, h };
  return f.state.flames;
}

/**
 * Flames: the heat grid stepped on by the time since the last paint, its bottom row lit by the columns, each cell in
 * the color fireColors gives its heat, put on a sheet a pixel a cell and scaled over the whole canvas.
 *
 * @param {Frame} f
 */
export function fire(f) {
  const { ctx, held } = f;
  const pal = held.palette;
  const { width: w, height: h } = ctx.canvas;
  const flames = flamesFor(f, w, h);
  const { size } = flames.state;
  fireSource(f.fracs, size, flames.source);
  stepFlames(flames.state, flames.source, f.dt, held.random);
  if (!pal.ink || pal.inkMax !== size.max) {
    pal.ink = words(fireColors(pal.suite, pal.accent, size.max));
    pal.inkMax = size.max;
  }
  const sheet = (held.fire = fireSheet(held.fire, held.makeCanvas, size.cols, size.rows));
  ctx.clearRect(0, 0, w, h);
  if (!sheet) return;
  blaze(flames.state, pal.ink, sheet.cells);
  sheet.ctx.putImageData(sheet.img, 0, 0);
  ctx.drawImage(sheet.ctx.canvas, 0, 0, w, h);
}
