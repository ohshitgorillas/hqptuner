// What the contract suites read of the spectrogram's picture, from its pixels alone. No test() and no assert lives here.
//
// `pixelCanvas` is a canvas that keeps the pixels a painter puts on it; `signatures` reads one number per pixel column
// from a spread of rows, so two columns that show the same slice read the same and two that show different slices read
// differently (the feeds the suites send give every slice its own levels); `scrolledBy` finds how many columns the
// picture moved left between two paints by matching those numbers, so it reads the movement off the pixels and not off the
// painter's calls; `columnSlices` says, from the history the painter was handed, which slice covers each column.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { SPEC_SIZE } from "../../../hqptuner/static/components/faceplate/drawers/source/paint.js";

/** The glass the painter is handed, red, green, blue; the token reader answers it for `--glass` and nothing else. */
const GLASS = [10, 11, 12];
export const TOKENS = { getPropertyValue: (/** @type {string} */ name) => (name === "--glass" ? "#0a0b0c" : "") };

export const { width: W, height: H } = SPEC_SIZE;
//: The pixel rows a column's signature reads, spread over the whole height.
const READ_ROWS = Array.from({ length: 24 }, (_, j) => 8 + j * 20);
//: Columns at the right edge a scroll leaves to the repaint of the newest slice, not matched.
const SEAM = 6;
//: The most columns a paint is searched to have scrolled, and the most it is searched to have moved right.
const MOST_LEFT = 160;
const MOST_RIGHT = 6;
//: The fewest picture columns a match must stand on, and the margin the best match must beat the next by.
const LEAST_MATCHES = 30;
const CLEAR_BY = 4;
const FNV_BASIS = 2166136261;
const FNV_PRIME = 16777619;
const BYTES_PER_PIXEL = 4;
const EPS = 1e-9;

/**
 * @typedef {object} PixelCanvas
 * @property {number} width
 * @property {number} height
 * @property {Uint8ClampedArray} data  RGBA, row by row
 * @property {() => unknown} getContext
 */

/**
 * A canvas of `width` by `height` pixels, every byte 0, whose 2D context keeps what a painter puts on it: the image
 * data it puts, and the canvas drawn onto itself, a copy of one rectangle of the picture onto another.
 *
 * @param {number} width
 * @param {number} height
 * @returns {PixelCanvas}
 */
export function pixelCanvas(width, height) {
  const data = new Uint8ClampedArray(width * height * BYTES_PER_PIXEL);
  /** @type {PixelCanvas} */
  const canvas = { width, height, data, getContext: () => context };
  const context = {
    /** @param {number} w @param {number} h */
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * BYTES_PER_PIXEL) }),
    /**
     * @param {{ width: number, height: number, data: Uint8ClampedArray }} img
     * @param {number} x
     * @param {number} y
     * @param {number[]} dirty  the dirty rectangle's x, y, width and height, each optional
     */
    putImageData: (img, x, y, ...dirty) => {
      const [sx = 0, sy = 0, sw = img.width, sh = img.height] = dirty;
      for (let r = sy; r < sy + sh; r++) {
        const from = (r * img.width + sx) * BYTES_PER_PIXEL;
        data.set(img.data.subarray(from, from + sw * BYTES_PER_PIXEL), ((y + r) * width + x + sx) * BYTES_PER_PIXEL);
      }
    },
    /**
     * @param {unknown} _src
     * @param {number[]} rects  the source's x, y, width and height, then the destination's x and y
     */
    drawImage: (_src, ...rects) => {
      const [sx, sy, sw, sh, dx, dy] = rects;
      const before = data.slice();
      for (let r = 0; r < sh; r++) {
        const from = ((sy + r) * width + sx) * BYTES_PER_PIXEL;
        data.set(before.subarray(from, from + sw * BYTES_PER_PIXEL), ((dy + r) * width + dx) * BYTES_PER_PIXEL);
      }
    },
  };
  return canvas;
}

/**
 * One number for the colors a column holds in the rows read.
 *
 * @param {(row: number) => ArrayLike<number>} colorAt  red, green, blue of the column's pixel in a row
 * @returns {number}
 */
function hashColors(colorAt) {
  let h = FNV_BASIS;
  for (const row of READ_ROWS) {
    const c = colorAt(row);
    for (let k = 0; k < 3; k++) h = Math.imul(h ^ c[k], FNV_PRIME);
  }
  return h;
}

/** The signature of a column that shows glass in every row read. */
export const GLASS_SIGNATURE = hashColors(() => GLASS);

/**
 * One number per pixel column of the spectrogram: the same colors in the rows read, the same number.
 *
 * @param {PixelCanvas} canvas
 * @param {Int32Array} out  W numbers, overwritten
 * @returns {Int32Array} `out`
 */
export function signatures(canvas, out) {
  const { data } = canvas;
  for (let x = 0; x < W; x++)
    out[x] = hashColors((row) => data.subarray((row * W + x) * BYTES_PER_PIXEL, (row * W + x) * BYTES_PER_PIXEL + 3));
  return out;
}

/**
 * How many columns the picture moved left between two paints, found by matching the columns of `before` against those
 * of `after` shifted by each move from MOST_RIGHT columns right to MOST_LEFT left, glass and the seam at the right edge
 * left out; a move to the right reads negative. Null when the pictures hold too few columns to say, or two moves match
 * about as well.
 *
 * @param {Int32Array} before
 * @param {Int32Array} after
 * @returns {number | null}
 */
export function scrolledBy(before, after) {
  let best = -1;
  let bestAt = 0;
  let second = -1;
  for (let k = -MOST_RIGHT; k <= MOST_LEFT; k++) {
    let hits = 0;
    for (let x = Math.max(0, -k); x < W - Math.max(k, 0) - SEAM; x++) {
      if (after[x] === before[x + k] && after[x] !== GLASS_SIGNATURE) hits++;
    }
    if (hits > best) [second, best, bestAt] = [best, hits, k];
    else if (hits > second) second = hits;
  }
  return best >= LEAST_MATCHES && best - second >= CLEAR_BY ? bestAt : null;
}

/**
 * @typedef {{ at: number, ms: number }} Span  playback, ms: where a slice starts and how long it lasts
 */

/**
 * Which slice the one covering most of each column is, for the columns the slices that have been passed cover in whole:
 * the slice among those ending by `edge` that overlaps the column the most, the earlier of two that overlap it equally.
 * A column some of whose playback no passed slice covers is -1: nothing is said of it.
 *
 * @param {ArrayLike<Span>} slices  oldest first, laid end to end
 * @param {number} edge  playback, ms: the window's right edge, the playhead
 * @param {number} span  playback, ms: the window's width
 * @param {Int32Array} out  W numbers, overwritten
 * @returns {Int32Array} `out`
 */
export function columnSlices(slices, edge, span, out) {
  const width = span / W;
  const left = edge - span;
  let first = 0;
  for (let x = 0; x < W; x++) {
    const from = left + x * width;
    const to = from + width;
    while (first < slices.length && slices[first].at + slices[first].ms <= from) first++;
    let covered = 0;
    let best = -1;
    let most = 0;
    for (let j = first; j < slices.length && slices[j].at < to && slices[j].at + slices[j].ms <= edge; j++) {
      const overlap = Math.min(slices[j].at + slices[j].ms, to) - Math.max(slices[j].at, from);
      if (overlap <= 0) continue;
      covered += overlap;
      if (overlap > most + EPS) [best, most] = [j, overlap];
    }
    out[x] = covered >= width - EPS ? best : -1;
  }
  return out;
}
