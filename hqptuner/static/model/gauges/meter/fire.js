// The Flames spectrum style, free of the DOM and of any random source of its own: a coarse grid of heat under the
// spectrum, whose bottom row each band sets alight by its height and whose every other cell takes its heat from a cell
// in the row below, a random step to one side, cooled by a random 0 or 1. Heat rises one row a step and fades as it
// climbs, so a louder band's flames burn hotter and reach higher. Every step returns a new grid and leaves its inputs
// alone; the random draws come from the caller, so a painter draws what it gets back and a test drives it from a table.
// A color table turns each heat into the RGBA a cell is drawn in, from the color suite in force.

import { clamp } from "../../../lib/coerce.js";
import { CHANNEL_MAX, bandsOf, rampAt, rampOf } from "./spectrumfx.js";

const CELL_PX = 4; // a cell's side on a canvas small enough for it, canvas pixels
const CELLS = 8000; // cells a grid holds at most when cells grow past CELL_PX to keep within it
const HEAT_CEILING = 255; // the most heat a grid cell can hold
const SHIFTS = 3; // sideways steps a cell can draw its heat from: one left, straight below, one right
const COOLINGS = 2; // what a cell's heat can cool by as it rises a row: 0 or 1
const FADE_IN = 4; // a cell is fully opaque from this share of the grid's top heat upward, as its inverse

/**
 * A heat grid's shape: its columns and rows of cells, and the heat a band at full scale sets its source alight with.
 *
 * @typedef {object} FireSize
 * @property {number} cols  cells across
 * @property {number} rows  cells up
 * @property {number} max   heat of a full-scale band's source, the grid's top heat
 */

/**
 * The heat grid for a canvas `width` by `height` pixels: cells CELL_PX on a side, or larger and square where a canvas
 * that big would hold more than CELLS of them. Heat cools by half a step a row on average, so a source climbs about
 * twice its heat in rows; a full-scale band's source holds half the rows in heat and its flames reach about the top.
 *
 * @param {number} width   canvas pixels
 * @param {number} height  canvas pixels
 * @returns {FireSize}
 */
export function fireSize(width, height) {
  const cell = Math.max(CELL_PX, Math.sqrt((width * height) / CELLS));
  const cols = Math.max(1, Math.round(width / cell));
  const rows = Math.max(1, Math.round(height / cell));
  return { cols, rows, max: clamp(Math.ceil(rows / 2), 1, HEAT_CEILING) };
}

/**
 * The bottom row's heat per column: the plot fractions grouped into the grid's columns as bandsOf groups them, each
 * column the largest in its span, and each column's height held as a share of the grid's top heat, rounded. A silent
 * column holds none.
 *
 * @param {ArrayLike<number>} fracs  plot fractions
 * @param {FireSize} size
 * @returns {Uint8Array}
 */
export function fireSource(fracs, size) {
  return Uint8Array.from(bandsOf(fracs, size.cols), (v) => Math.round(clamp(v, 0, 1) * size.max));
}

/**
 * Row `y` of `next` risen from the row below it in `prev`: each cell takes the heat of the cell below and up to one
 * column to either side, held on the grid, less 0 or 1, never below 0. One draw from `rand` per cell picks both.
 *
 * @param {Uint8Array} prev
 * @param {Uint8Array} next
 * @param {number} y
 * @param {{ cols: number, rand: () => number }} grid
 */
function riseRow(prev, next, y, { cols, rand }) {
  const below = (y + 1) * cols;
  for (let x = 0; x < cols; x++) {
    const pick = Math.floor(rand() * SHIFTS * COOLINGS);
    const from = clamp(x + Math.floor(pick / COOLINGS) - 1, 0, cols - 1);
    next[y * cols + x] = Math.max(0, prev[below + from] - (pick % COOLINGS));
  }
}

/**
 * The grid one step on from `prev`: the bottom row holds `source`, and every row above rises from the one below.
 *
 * @param {Uint8Array} prev
 * @param {ArrayLike<number>} source
 * @param {FireSize} size
 * @param {() => number} rand
 * @returns {Uint8Array}
 */
function rise(prev, source, { cols, rows }, rand) {
  const next = new Uint8Array(cols * rows);
  const base = (rows - 1) * cols;
  for (let x = 0; x < cols; x++) next[base + x] = source[x] ?? 0;
  for (let y = 0; y < rows - 1; y++) riseRow(prev, next, y, { cols, rand });
  return next;
}

/**
 * The heat grid after a step handing in `source`, row by row from the top, `size.cols` cells a row: the bottom row
 * holds `source`, and every other cell takes the heat of a cell in the row below, a random step to one side or none,
 * cooled by a random 0 or 1. Without a `prev` of the grid's size the step starts from a cold grid, so flames rise from
 * the floor. `rand` hands back a number from 0 up to, not including, 1, as `Math.random` does.
 *
 * @param {Uint8Array | null} prev
 * @param {ArrayLike<number>} source  heat per column, as fireSource gives it
 * @param {FireSize} size
 * @param {() => number} rand
 * @returns {Uint8Array}
 */
export function stepFire(prev, source, size, rand) {
  const from = prev && prev.length === size.cols * size.rows ? prev : new Uint8Array(size.cols * size.rows);
  return rise(from, source, size, rand);
}

/**
 * The color each heat from 0 to `max` is drawn in under `suite`, four bytes each, RGBA, heat `h` at `4·h`: the suite's
 * ramp from its floor to its full scale, Accent's in the accent in force. Heat 0 is fully clear, so the plot shows
 * through where nothing burns, and each heat above it is more opaque up to a FADE_IN-th of `max`, opaque from there to
 * `max`.
 *
 * @param {string} suite
 * @param {string} accent  the accent in force, `#rrggbb`
 * @param {number} max  the grid's top heat, as fireSize gives it
 * @returns {Uint8ClampedArray}
 */
export function fireColors(suite, accent, max) {
  const ramp = rampOf(suite, accent);
  const out = new Uint8ClampedArray((max + 1) * 4);
  for (let h = 0; h <= max; h++) {
    out.set(rampAt(ramp, h / max), h * 4);
    out[h * 4 + 3] = Math.ceil(Math.min(1, (h / max) * FADE_IN) * CHANNEL_MAX);
  }
  return out;
}
