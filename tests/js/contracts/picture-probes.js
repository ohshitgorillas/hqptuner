// What the spectrogram contract suites measure of a replay, one probe per reading. A probe is handed every paint and the
// world, and answers with plain numbers when the replay is over. No test() and no assert lives here.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { GLASS_SIGNATURE, H, W, columnSlices, scrolledBy, signatures } from "./picture.js";
import { drawn } from "./world.js";

/** @typedef {import("./world.js").Paint} Paint */
/** @typedef {import("./world.js").World} World */
/** @typedef {{ see: (paint: Paint, world: World) => void }} Probe */
/**
 * A finding: how many paints it happened at, and the first of them with what it saw. Empty when it never happened.
 *
 * @typedef {{ count: number, first: string }} Finding
 */

//: How far apart the paints are that are compared with a fresh whole paint of the same state.
const FRESH_EVERY = 5;
//: The fewest columns the region a paint is judged over must hold.
const LEAST_REGION = 8;
//: The columns at either end of the region left out of the judging: a slice's boundary there may fall outside it.
const MARGIN = 3;
//: The columns left of the region's first that hold no music, and the glass the right edge may show beyond a frame.
const LEFT_ROOM = 3;
const FRAME_ROOM_COLUMNS = 1;

/**
 * A finding that starts out unseen.
 *
 * @returns {Finding}
 */
const finding = () => ({ count: 0, first: "" });

/**
 * Note that `found` happened at `paint`, seeing `what`.
 *
 * @param {Finding} found
 * @param {number} paint
 * @param {string} what
 */
function note(found, paint, what) {
  if (!found.count++) found.first = `paint ${paint}: ${what}`;
}

/**
 * The picture's movement against the playhead's: over the paints, counted back from the last, whose movement can all be
 * read off the pixels, the columns the picture moved left and the columns the playhead's advance is worth.
 *
 * @returns {Probe & { done: (span: number) => { measured: number, moved: number, owed: number, right: Finding } }}
 */
export function scrollProbe() {
  let before = new Int32Array(W);
  let after = new Int32Array(W);
  /** @type {Array<number | null>} */
  const moves = [];
  /** @type {Array<number | null>} */
  const heads = [];
  return {
    see: (paint, world) => {
      signatures(world.canvas, after);
      moves.push(scrolledBy(before, after));
      heads.push(paint.head);
      [before, after] = [after, before];
    },
    done: (span) => {
      const readable = (/** @type {number} */ j) => moves[j] !== null && heads[j] != null && heads[j - 1] != null;
      let from = moves.length;
      while (from > 1 && readable(from - 1)) from--;
      let moved = 0;
      let owed = 0;
      const right = finding();
      for (let j = from; j < moves.length; j++) {
        moved += moves[j] ?? NaN;
        owed += (((heads[j] ?? NaN) - (heads[j - 1] ?? NaN)) * W) / span;
        if ((moves[j] ?? 0) < 0) note(right, j, `moved ${moves[j]} columns`);
      }
      return { measured: moves.length - from, moved, owed, right };
    },
  };
}

/**
 * Whether the picture equals one fresh whole paint of the same state, every FRESH_EVERY paints and at the last.
 *
 * @param {number} last  index of the schedule's last paint
 * @returns {Probe & { done: () => { checked: number, differs: Finding } }}
 */
export function freshProbe(last) {
  let checked = 0;
  const differs = finding();
  return {
    see: ({ i }, world) => {
      if (i % FRESH_EVERY && i !== last) return;
      checked++;
      const fresh = Buffer.from(world.fresh().data.buffer);
      const held = Buffer.from(world.canvas.data.buffer);
      if (Buffer.compare(fresh, held) !== 0) note(differs, i, "the picture differs from a fresh paint");
    },
    done: () => ({ checked, differs }),
  };
}

/**
 * The columns in `[from + 1, to]` that differ from the column before them.
 *
 * @param {ArrayLike<number>} column  one number per pixel column
 * @param {number} from
 * @param {number} to
 * @returns {number[]}
 */
function boundaries(column, from, to) {
  /** @type {number[]} */
  const out = [];
  for (let x = from + 1; x <= to; x++) if (column[x] !== column[x - 1]) out.push(x);
  return out;
}

/**
 * The longest of the history's newest slices, playback ms: the room the playback no slice has closed over yet can take.
 *
 * @param {ArrayLike<{ ms: number }>} slices
 * @returns {number}
 */
function longest(slices) {
  let most = 0;
  for (let j = Math.max(0, slices.length - 3); j < slices.length; j++) most = Math.max(most, slices[j].ms);
  return most;
}

/**
 * The boundaries in `inner` with none of `others` within a column of them.
 *
 * @param {number[]} inner
 * @param {number[]} others
 * @returns {number[]}
 */
const unmatched = (inner, others) => inner.filter((x) => !others.some((o) => Math.abs(o - x) <= 1));

/**
 * Where the slices stand in the picture. For each paint, the columns the slices the playhead has passed cover in whole
 * are the region, and the picture there is read against the history: no glass column in it bar the last, which the
 * scroll's whole-column step may not have uncovered yet; each boundary between two slices of the history within a column
 * of a boundary in the picture, and the other way round; glass left of the region where no slice reaches; and the glass
 * at the right edge, over the playback no slice has closed over yet, no more than a slice and a frame.
 *
 * @returns {Probe & { done: () => { judged: number, glassInside: Finding, missing: Finding, extra: Finding,
 *   leftNotGlass: Finding, edgeGlass: Finding } }}
 */
export function sliceProbe() {
  const sig = new Int32Array(W);
  const expect = new Int32Array(W);
  let judged = 0;
  const found = {
    glassInside: finding(),
    missing: finding(),
    extra: finding(),
    leftNotGlass: finding(),
    edgeGlass: finding(),
  };
  return {
    see: ({ i }, world) => {
      const { slices, edge } = drawn();
      if (edge === null) return;
      columnSlices(slices, edge, world.span, expect);
      signatures(world.canvas, sig);
      const region = regionOf(expect);
      if (!region) return;
      judged++;
      judgeGlass(found, i, sig, region);
      judgeBoundaries(found, i, { sig, expect }, region);
      const room = Math.ceil(longest(slices) / (world.span / W)) + FRAME_ROOM_COLUMNS;
      const after = sig.subarray(region.to).filter((s) => s === GLASS_SIGNATURE).length;
      if (after > room) note(found.edgeGlass, i, `${after} glass columns at the edge, room for ${room}`);
    },
    done: () => ({ judged, ...found }),
  };
}

/**
 * The columns the passed slices cover in whole, as one run from the first: null when the run is too short to judge.
 *
 * @param {Int32Array} expect  the slice covering each column, -1 where none is said to
 * @returns {{ from: number, to: number } | null}
 */
function regionOf(expect) {
  const from = expect.findIndex((e) => e >= 0);
  let to = from;
  while (to + 1 < W && expect[to + 1] >= 0) to++;
  return from < 0 || to - from < LEAST_REGION ? null : { from, to };
}

/**
 * Glass inside the region, bar its last column, and music left of it.
 *
 * @param {Record<string, Finding>} found
 * @param {number} paint
 * @param {Int32Array} sig
 * @param {{ from: number, to: number }} region
 */
function judgeGlass(found, paint, sig, { from, to }) {
  for (let x = from; x < to; x++) {
    if (sig[x] === GLASS_SIGNATURE) note(found.glassInside, paint, `column ${x} of ${from}..${to} is glass`);
  }
  for (let x = 0; x < from - LEFT_ROOM; x++) {
    if (sig[x] !== GLASS_SIGNATURE) note(found.leftNotGlass, paint, `column ${x} left of ${from} shows music`);
  }
}

/**
 * Each boundary of the history in the region within a column of one in the picture, and the other way round.
 *
 * @param {Record<string, Finding>} found
 * @param {number} paint
 * @param {{ sig: Int32Array, expect: Int32Array }} columns
 * @param {{ from: number, to: number }} region
 */
function judgeBoundaries(found, paint, { sig, expect }, { from, to }) {
  const want = boundaries(expect, from, to);
  const got = boundaries(sig, from, to);
  const judge = (/** @type {number} */ x) => x >= from + MARGIN && x <= to - MARGIN;
  for (const x of unmatched(want.filter(judge), got)) note(found.missing, paint, `no boundary within a column of ${x}`);
  for (const x of unmatched(got.filter(judge), want)) note(found.extra, paint, `boundary at ${x} that no slice has`);
}

//: Every this-many'th column is read.
const EVERY_COLUMN = 7;
const BYTES_PER_PIXEL = 4;

/**
 * The slice row nearest each pixel row: the pixel row's frequency against the center of each of the slice's `rows` rows,
 * from 0 Hz to its Nyquist.
 *
 * @param {number} nyquist  Hz
 * @param {number} rows
 * @param {number} top  Hz: the frequency at the top of the view
 * @returns {Int32Array}
 */
function nearestRows(nyquist, rows, top) {
  return Int32Array.from({ length: H }, (_, y) => {
    const freq = (top * (H - 0.5 - y)) / H;
    let best = 0;
    for (let r = 1; r < rows; r++) {
      if (Math.abs(freq - ((r + 0.5) * nyquist) / rows) < Math.abs(freq - ((best + 0.5) * nyquist) / rows)) best = r;
    }
    return best;
  });
}

/**
 * Whether the picture blends between a slice's rows. Every slice has the same rows from 0 Hz to the same Nyquist, so two
 * pixel rows whose nearest slice row is one row show the same level in every column: a pixel row that takes a color of
 * its own between two rows' is a blend.
 *
 * @param {number} nyquist  Hz
 * @param {number} rows  the rows of a slice
 * @param {number} share  the view's share of the Nyquist, the top of the view
 * @returns {Probe & { done: () => { read: number, blend: Finding } }}
 */
export function rowProbe(nyquist, rows, share) {
  const near = nearestRows(nyquist, rows, nyquist * share);
  let read = 0;
  const blend = finding();
  return {
    see: ({ i }, world) => {
      const { data } = world.canvas;
      for (let x = EVERY_COLUMN; x < W - 1; x += EVERY_COLUMN) {
        for (let y = 0; y < H - 1; y++) {
          if (near[y] !== near[y + 1]) continue;
          read++;
          const [p, q] = [(y * W + x) * BYTES_PER_PIXEL, ((y + 1) * W + x) * BYTES_PER_PIXEL];
          if (data.subarray(p, p + 3).some((c, k) => c !== data[q + k]))
            note(blend, i, `rows ${y} and ${y + 1} of column ${x}`);
        }
      }
    },
    done: () => ({ read, blend }),
  };
}
