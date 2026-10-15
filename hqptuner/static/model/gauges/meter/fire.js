// The Flames spectrum style, free of the DOM and of any random source of its own: a fine grid of heat under the
// spectrum, whose bottom row is lit afresh each pass with random heat up to its band's height and whose every other cell
// takes the average of the three cells in the row below it and the cell two rows below, cooled a little. Heat spreads up
// and sideways as it climbs and fades as it goes, so the flames flicker in place, blend from band to band, and a louder
// band's flames burn hotter and reach higher. Every step returns a new grid and leaves its inputs alone; the random
// draws come from the caller, so a painter draws what it gets back and a test drives it from a table. A color table
// turns each heat into the RGBA a cell is drawn in, from the color suite in force.

import { clamp } from "../../../lib/coerce.js";
import { CHANNEL_MAX, bandsOf, rampAt, rampOf } from "./spectrumfx.js";

const CELL_PX = 2; // a cell's side on a canvas small enough for it, canvas pixels
const CELLS = 90000; // cells a grid holds at most when cells grow past CELL_PX to keep within it
const HEAT_CEILING = 65535; // the most heat a grid cell can hold
const COOL = 4; // what a cell's four-cell sum loses before it is averaged: one heat a row
const HEAT_PER_ROW = 2.1; // a full-scale band's top heat per grid row, so its flames reach about the grid's top
const DRIFT = 1.25; // rows heat climbs a pass on average: three cells one row below, one two rows below
const RISE_STEPS = 45; // steps heat takes to climb the whole grid, whatever its rows
const FADE_IN = 4; // a cell is fully opaque from this share of the grid's top heat upward, as its inverse

/**
 * A heat grid's shape: its columns and rows of cells, the heat a band at full scale lights its source cells up to, and
 * the passes of the rule one step makes.
 *
 * @typedef {object} FireSize
 * @property {number} cols    cells across
 * @property {number} rows    cells up
 * @property {number} max     heat of a full-scale band's source, the grid's top heat
 * @property {number} passes  passes a step makes
 */

/**
 * The heat grid for a canvas `width` by `height` pixels: cells CELL_PX on a side, or larger and square where a canvas
 * that big would hold more than CELLS of them. Heat cools by about a heat a row, and a source cell's heat is on average
 * half its band's, so a full-scale band's flames reach about the top. A step makes as many passes as heat needs to
 * climb the grid in RISE_STEPS steps.
 *
 * @param {number} width   canvas pixels
 * @param {number} height  canvas pixels
 * @returns {FireSize}
 */
export function fireSize(width, height) {
  const cell = Math.max(CELL_PX, Math.sqrt((width * height) / CELLS));
  const cols = Math.max(1, Math.round(width / cell));
  const rows = Math.max(1, Math.round(height / cell));
  return {
    cols,
    rows,
    max: clamp(Math.round(rows * HEAT_PER_ROW), 1, HEAT_CEILING),
    passes: Math.max(1, Math.ceil(rows / (DRIFT * RISE_STEPS))),
  };
}

/**
 * `values` stretched over `n` columns, `n` above their count: each column the value at its middle, read along the
 * straight line between the two values either side of it.
 *
 * @param {ArrayLike<number>} values
 * @param {number} n
 * @returns {Float32Array}
 */
function stretch(values, n) {
  const out = new Float32Array(n);
  const last = values.length - 1;
  if (last < 0) return out;
  for (let x = 0; x < n; x++) {
    const at = clamp(((x + 0.5) * values.length) / n - 0.5, 0, last);
    const i = Math.floor(at);
    const j = Math.min(i + 1, last);
    out[x] = values[i] + (values[j] - values[i]) * (at - i);
  }
  return out;
}

/**
 * The bottom row's top heat per column: the plot fractions grouped into the grid's columns as bandsOf groups them,
 * each column the largest in its span, or stretched over the columns where the grid has more columns than there are
 * fractions, and each column's height held as a share of the grid's top heat, rounded. A silent column holds none.
 *
 * @param {ArrayLike<number>} fracs  plot fractions
 * @param {FireSize} size
 * @returns {Uint16Array}
 */
export function fireSource(fracs, size) {
  const levels = size.cols <= fracs.length ? bandsOf(fracs, size.cols) : stretch(fracs, size.cols);
  return Uint16Array.from(levels, (v) => Math.round(clamp(v, 0, 1) * size.max));
}

/**
 * Light the bottom row of `heat`: each cell a random heat from 0 up to its column's `source`, one draw from `rand` per
 * cell.
 *
 * @param {Uint16Array} heat
 * @param {ArrayLike<number>} source
 * @param {{ cols: number, rows: number }} size
 * @param {() => number} rand
 */
function light(heat, source, { cols, rows }, rand) {
  const base = (rows - 1) * cols;
  for (let x = 0; x < cols; x++) heat[base + x] = Math.floor(rand() * ((source[x] ?? 0) + 1));
}

/**
 * Row `y` of `heat` burnt from the rows below it: each cell the sum of the three cells in the row below, the grid's
 * edge cell standing in past either edge, and of the cell two rows below, the bottom row standing in past it, less
 * COOL, quartered and rounded down, never below 0.
 *
 * @param {Uint16Array} heat
 * @param {number} y
 * @param {{ cols: number, rows: number }} size
 */
function burnRow(heat, y, { cols, rows }) {
  const at = y * cols;
  const below = at + cols;
  const under = Math.min(y + 2, rows - 1) * cols;
  const edge = cols - 1;
  for (let x = 0; x < cols; x++) {
    const left = below + (x > 0 ? x - 1 : 0);
    const right = below + (x < edge ? x + 1 : edge);
    const sum = heat[left] + heat[below + x] + heat[right] + heat[under + x];
    heat[at + x] = sum > COOL ? (sum - COOL) >> 2 : 0;
  }
}

/**
 * The heat grid after a step handing in `source`, row by row from the top, `size.cols` cells a row. Each of the step's
 * `size.passes` passes lights the bottom row with random heat up to `source`, then burns every row above it from the
 * top down, so each row reads the rows below as the last pass left them: the average of the three cells in the row
 * below and the cell two rows below, cooled by COOL. Without a `prev` of the grid's size the step starts from a cold
 * grid, so flames rise from the floor. `rand` hands back a number from 0 up to, not including, 1, as `Math.random`
 * does.
 *
 * @param {ArrayLike<number> | null} prev
 * @param {ArrayLike<number>} source  top heat per column, as fireSource gives it
 * @param {FireSize} size
 * @param {() => number} rand
 * @returns {Uint16Array}
 */
export function stepFire(prev, source, size, rand) {
  const n = size.cols * size.rows;
  const heat = prev && prev.length === n ? Uint16Array.from(prev) : new Uint16Array(n);
  for (let p = 0; p < size.passes; p++) {
    light(heat, source, size, rand);
    for (let y = 0; y < size.rows - 1; y++) burnRow(heat, y, size);
  }
  return heat;
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
