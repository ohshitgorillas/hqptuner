// The Flames spectrum style, free of the DOM and of any random source of its own: a fine grid of heat under the
// spectrum, whose bottom row is lit afresh each pass with random heat up to its band's height and whose every other cell
// takes the average of the three cells in the row below it and the cell two rows below, cooled a little. Heat spreads up
// and sideways as it climbs and fades as it goes, so the flames flicker in place, blend from band to band, and a louder
// band's flames burn hotter and reach higher. A step burns the grid it is handed in place and returns it, so a step
// allocates nothing once the grid is built; the random draws come from the caller, so a painter draws what it gets back
// and a test drives it from a table. A color table
// turns each heat into the RGBA a cell is drawn in, from the color suite in force.

import { clamp } from "../../../lib/coerce.js";
import { CHANNEL_MAX, bandTop, rampAt, rampOf } from "./spectrumfx.js";
import { freshPace, stepPace } from "./steps.js";

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
 * Column `x` of `values` stretched over `n` columns, `n` above their count: the value at the column's middle, read
 * along the straight line between the two values either side of it; 0 where there are no values.
 *
 * @param {ArrayLike<number>} values
 * @param {number} x
 * @param {number} n
 * @returns {number}
 */
function stretchAt(values, x, n) {
  const last = values.length - 1;
  if (last < 0) return 0;
  const at = clamp(((x + 0.5) * values.length) / n - 0.5, 0, last);
  const i = Math.floor(at);
  const j = Math.min(i + 1, last);
  return values[i] + (values[j] - values[i]) * (at - i);
}

/**
 * The bottom row's top heat per column: the plot fractions grouped into the grid's columns as bandTop groups them,
 * each column the largest in its span, or stretched over the columns where the grid has more columns than there are
 * fractions, each level held at single precision, and each column's height held as a share of the grid's top heat,
 * rounded. A silent column holds none. Written into `out` where it holds `size.cols`, into a new array otherwise.
 *
 * @param {ArrayLike<number>} fracs  plot fractions
 * @param {FireSize} size
 * @param {Uint16Array} [out]  reused where it fits
 * @returns {Uint16Array}
 */
export function fireSource(fracs, size, out) {
  const n = size.cols;
  const source = out?.length === n ? out : new Uint16Array(n);
  const group = n <= fracs.length;
  for (let x = 0; x < n; x++) {
    const level = Math.fround(group ? bandTop(fracs, x, n) : stretchAt(fracs, x, n));
    source[x] = Math.round(clamp(level, 0, 1) * size.max);
  }
  return source;
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
 * below and the cell two rows below, cooled by COOL. A `prev` of the grid's size is burnt in place and handed back,
 * so the step allocates nothing; without one the step starts from a new cold grid, so flames rise from the floor.
 * `rand` hands back a number from 0 up to, not including, 1, as `Math.random` does.
 *
 * @param {Uint16Array | null} prev  written in place where it is of the grid's size
 * @param {ArrayLike<number>} source  top heat per column, as fireSource gives it
 * @param {FireSize} size
 * @param {() => number} rand
 * @returns {Uint16Array}
 */
export function stepFire(prev, source, size, rand) {
  const n = size.cols * size.rows;
  const heat = prev && prev.length === n ? prev : new Uint16Array(n);
  for (let p = 0; p < size.passes; p++) {
    light(heat, source, size, rand);
    for (let y = 0; y < size.rows - 1; y++) burnRow(heat, y, size);
  }
  return heat;
}

/**
 * The Flames style as a paint draws it: the heat grid, the shape it was built for and the pace its steps are taken at.
 *
 * @typedef {object} FlamesState
 * @property {Uint16Array} heat  the heat grid, row by row from the top, as stepFire gives it
 * @property {FireSize} size  the grid's shape
 * @property {import("./steps.js").Pace} pace  the part step carried to the next paint
 */

/**
 * Flames after a break or a change of size: a cold grid of `size`, due a step at the first paint.
 *
 * @param {FireSize} size
 * @returns {FlamesState}
 */
export function freshFlames(size) {
  return { heat: new Uint16Array(size.cols * size.rows), size, pace: freshPace() };
}

/**
 * The flames after a paint `dt` seconds after the last: the whole steps the paint owes through stepPace, each a
 * stepFire handing in `source`. Each pass, the oldest heat any row still reads climbs one row, so a grid's rows of
 * passes leave nothing of the grid before them. However many steps a paint owes, it burns at most the steps that make
 * a grid's rows of passes, so a long gap costs no more than a full grid and shows the flames the last of its steps
 * leave.
 *
 * @param {FlamesState} state  written in place
 * @param {ArrayLike<number>} source  top heat per column, as fireSource gives it
 * @param {number} dt  wall time since the last paint, s, at least 0
 * @param {() => number} rand  as stepFire takes it
 * @returns {FlamesState}  `state`
 */
export function stepFlames(state, source, dt, rand) {
  const { size } = state;
  const steps = Math.min(stepPace(state.pace, dt), Math.ceil(size.rows / size.passes));
  for (let s = 0; s < steps; s++) state.heat = stepFire(state.heat, source, size, rand);
  return state;
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
