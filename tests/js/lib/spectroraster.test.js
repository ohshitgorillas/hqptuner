// Behavioral suite for lib/spectroraster.js, the spectrogram's colour ramp and
// pixel raster.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/spectroraster.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { W, rampFrom, rasterize, scrollPlan } from "../../../hqptuner/static/lib/spectroraster.js";

// Floor a dark blue, top a warm yellow: apart from each other and from black,
// with a steep last segment so a neighbouring step reads as a different colour.
const RAMP = rampFrom(["#1a2a6c", "#1a2a6c", "#1a2a6c", "#1a2a6c", "#1a2a6c", "#f5d142"]);

// A ramp whose red channel is its own step, so a pixel names the step it took.
/** @type {[number, number, number][]} */
const STEPS = Array.from({ length: 256 }, (_, i) => [i, 255 - i, 128]);

// At this range a byte b (dBFS -1.2 b) takes step 255 - b: one step per byte.
const BYTE_RANGE = 306;

const ROWS = 480;
const NYQUIST = 22050;
const SPAN = 4000;

/**
 * A slice whose row r carries `byteAt(r)`.
 *
 * @param {(r: number) => number} byteAt
 */
const slice = (byteAt) => Uint8Array.from({ length: ROWS }, (_, r) => byteAt(r));

/** @param {number} byte */
const flat = (byte) => slice(() => byte);

/**
 * The view over `cells` at the step ramp's range, topped at the CD Nyquist.
 *
 * @param {{ ms: number, nyquist: number, slices: Uint8Array[] }[]} cells
 * @param {number} [top]
 */
const view = (cells, top = NYQUIST) => ({ cells, span: SPAN, range: BYTE_RANGE, top });

/**
 * The ramp step one pixel took, or null where it stayed transparent.
 *
 * @param {{ width: number, data: Uint8ClampedArray }} raster
 * @param {number} x
 * @param {number} y
 */
function step({ width, data }, x, y) {
  const at = (y * width + x) * 4;
  return data[at + 3] === 255 ? data[at] : null;
}

/**
 * The steps along one pixel row at each of `xs`.
 *
 * @param {{ width: number, data: Uint8ClampedArray }} raster
 * @param {number[]} xs
 * @param {number} y
 */
const stepsAcross = (raster, xs, y) => xs.map((x) => step(raster, x, y));

/**
 * The steps down one pixel column at each of `ys`.
 *
 * @param {{ width: number, data: Uint8ClampedArray }} raster
 * @param {number} x
 * @param {number[]} ys
 */
const stepsDown = (raster, x, ys) => ys.map((y) => step(raster, x, y));

/**
 * The RGB channels of the raster's centre pixel.
 *
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} raster
 * @returns {number[]}
 */
function centreRgb({ width, height, data }) {
  const at = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
  return Array.from(data.subarray(at, at + 3));
}

test("test_a_band_at_full_scale_paints_the_ramps_top_colour", () => {
  const raster = rasterize(RAMP, {
    cells: [{ ms: SPAN, nyquist: NYQUIST, slices: [flat(0)] }],
    span: SPAN,
    range: 120,
    top: NYQUIST,
  });
  assert.deepEqual(centreRgb(raster), RAMP[RAMP.length - 1]);
});

// Bytes 25, 100 and 105 are -30, -120 and -126 dBFS: three quarters up a
// 120 dB range, its floor, and below it.
test("test_a_level_takes_its_step_from_the_ranges_floor_to_full_scale", () => {
  const levels = slice((r) => ({ 479: 25, 478: 100, 477: 105 })[r] ?? 0);
  const raster = rasterize(STEPS, {
    cells: [{ ms: SPAN, nyquist: NYQUIST, slices: [levels] }],
    span: SPAN,
    range: 120,
    top: NYQUIST,
  });
  assert.deepEqual(stepsDown(raster, 600, [0, 1, 2]), [191, 0, 0]);
});

// Topped at the cell's own Nyquist, pixel row y sits on slice row 479 - y.
test("test_a_view_topped_at_the_nyquist_reads_one_slice_row_per_pixel_row", () => {
  const raster = rasterize(STEPS, view([{ ms: SPAN, nyquist: NYQUIST, slices: [slice((r) => 2 * (r % 120))] }]));
  assert.deepEqual(stepsDown(raster, 600, [0, 1, 239, 240, 478, 479]), [17, 19, 255, 17, 253, 255]);
});

// Topped at half a 44.1 kHz cell's Nyquist, pixel row 0 sits a quarter of the
// way from slice row 239 to 240, and row 1 three quarters of the way from 238.
test("test_a_pixel_row_between_two_slice_rows_blends_them", () => {
  const levels = slice((r) => ({ 239: 100, 240: 200 })[r] ?? 0);
  const raster = rasterize(STEPS, view([{ ms: SPAN, nyquist: 44100, slices: [levels] }]));
  assert.deepEqual(stepsDown(raster, 600, [0, 1]), [130, 180]);
});

// The bottom pixel row sits a quarter row below slice row 0, the one above it
// a quarter of the way from row 0 to row 1.
test("test_a_pixel_row_below_the_first_slice_row_reads_the_first", () => {
  const levels = slice((r) => ({ 0: 40, 1: 140 })[r] ?? 0);
  const raster = rasterize(STEPS, view([{ ms: SPAN, nyquist: 44100, slices: [levels] }]));
  assert.deepEqual(stepsDown(raster, 600, [478, 479]), [190, 215]);
});

// Topped at twice the cell's Nyquist, the cell reaches pixel row 240.
test("test_rows_above_a_cells_nyquist_stay_transparent", () => {
  const raster = rasterize(STEPS, view([{ ms: SPAN, nyquist: NYQUIST, slices: [flat(55)] }], 2 * NYQUIST));
  assert.deepEqual(stepsDown(raster, 600, [238, 239, 240, 479]), [null, null, 200, 200]);
});

// A second of history in a four-second window fills its last quarter.
test("test_the_cells_sit_at_the_right_and_leave_the_strip_before_them_unpainted", () => {
  const raster = rasterize(STEPS, view([{ ms: 1000, nyquist: NYQUIST, slices: [flat(55)] }]));
  assert.deepEqual(stepsAcross(raster, [0, 899, 900, 1199], 240), [null, null, 200, 200]);
});

test("test_a_cells_slot_is_divided_evenly_among_its_slices", () => {
  const slices = [flat(0), flat(50), flat(100), flat(150)];
  const raster = rasterize(STEPS, view([{ ms: SPAN, nyquist: NYQUIST, slices }]));
  assert.deepEqual(stepsAcross(raster, [149, 449, 749, 1049], 240), [255, 205, 155, 105]);
});

// Two slices of two seconds each: a column blends toward the neighbour on its
// side of the slice's centre, nearly halfway at the shared edge.
test("test_a_column_blends_toward_the_neighbouring_slice", () => {
  const raster = rasterize(STEPS, view([{ ms: SPAN, nyquist: NYQUIST, slices: [flat(0), flat(240)] }]));
  assert.deepEqual(stepsAcross(raster, [299, 449, 599, 900], 240), [255, 195, 135, 15]);
});

test("test_slices_of_neighbouring_cells_with_one_nyquist_blend_across_their_seam", () => {
  const cells = [
    { ms: SPAN / 2, nyquist: NYQUIST, slices: [flat(0)] },
    { ms: SPAN / 2, nyquist: NYQUIST, slices: [flat(240)] },
  ];
  assert.equal(step(rasterize(STEPS, view(cells)), 599, 240), 135);
});

test("test_an_interval_with_no_frame_stays_unpainted_and_its_neighbours_do_not_blend_across_it", () => {
  const cells = [
    { ms: 1000, nyquist: NYQUIST, slices: [flat(0)] },
    { ms: 1000, nyquist: NYQUIST, slices: [] },
    { ms: 2000, nyquist: NYQUIST, slices: [flat(200)] },
  ];
  assert.deepEqual(stepsAcross(rasterize(STEPS, view(cells)), [299, 300, 599, 600], 240), [255, null, null, 55]);
});

/**
 * Pixel columns `from` to the right edge of a raster, as a raster of their own.
 *
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} raster
 * @param {number} from
 */
function columnsFrom({ width, height, data }, from) {
  const out = new Uint8ClampedArray((width - from) * height * 4);
  for (let y = 0; y < height; y++) {
    out.set(data.subarray((y * width + from) * 4, (y + 1) * width * 4), y * (width - from) * 4);
  }
  return { width: width - from, height, data: out };
}

/**
 * A raster's size and a digest of its bytes. A failed deepEqual renders both
 * sides element by element, which for two whole rasters exhausts memory.
 *
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} raster
 */
const fingerprint = ({ width, height, data }) => ({
  width,
  height,
  sha1: createHash("sha1").update(data).digest("hex"),
});

// An unpainted second, then five slices of 180 columns whose rows differ from
// one another and from slice to slice, so every column is its own.
const BANDED = view([
  { ms: 1000, nyquist: NYQUIST, slices: [] },
  { ms: 3000, nyquist: NYQUIST, slices: [0, 1, 2, 3, 4].map((k) => slice((r) => (r + 40 * k) % 256)) },
]);

// Column 700 lies left of its slice's centre, so it blends toward a slice that
// ends before it.
for (const from of [1, 700, W - 1]) {
  test(`test_a_raster_from_column_${from}_is_the_full_rasters_columns_from_there_to_the_right_edge`, () => {
    assert.deepEqual(
      fingerprint(rasterize(STEPS, BANDED, from)),
      fingerprint(columnsFrom(rasterize(STEPS, BANDED), from)),
    );
  });
}

// Forty cells of one slice each, a tenth of a second and 30 columns apiece, the
// newest spanning columns 1170 to 1199, as the history hands them over.
const CELL_COUNT = 40;
const CELL_MS = SPAN / CELL_COUNT;

/**
 * The forty cells, each slice its own level, noting in `read` the index of
 * every cell whose slices are read.
 *
 * @param {Set<number>} read
 */
function countedCells(read) {
  return Array.from({ length: CELL_COUNT }, (_, k) => {
    const slices = [slice((r) => (r + 6 * k) % 256)];
    return {
      ms: CELL_MS,
      nyquist: NYQUIST,
      get slices() {
        read.add(k);
        return slices;
      },
    };
  });
}

// Columns 1195 to 1199 lie in the newest cell; the one before it is the seam's.
test("test_a_raster_from_column_W_minus_5_reads_only_the_newest_cell_and_the_one_before_it", () => {
  /** @type {Set<number>} */
  const read = new Set();
  rasterize(STEPS, view(countedCells(read)), W - 5);
  assert.equal(read.size, 2);
});

// Column 1170 lies left of the newest slice's centre, so it blends toward the
// slice before it.
test("test_a_raster_from_the_newest_cells_first_column_is_the_full_rasters_columns_from_there", () => {
  const cells = view(countedCells(new Set()));
  assert.deepEqual(
    fingerprint(rasterize(STEPS, cells, W - 30)),
    fingerprint(columnsFrom(rasterize(STEPS, cells), W - 30)),
  );
});

const FULL = { full: true, shift: 0, from: 0, carry: 0 };

// A span of W ms makes one column a millisecond, so frame times and carries in
// binary fractions give exact column counts.
const MS_PER_COLUMN_SPAN = W;

test("test_a_first_plan_repaints_in_full", () => {
  assert.deepEqual(scrollPlan(null, { key: "a", end: 5000, span: SPAN }), FULL);
});

test("test_a_changed_key_repaints_in_full", () => {
  const plan = scrollPlan({ key: "a", end: 4000, carry: 0 }, { key: "b", end: 4200, span: SPAN });
  assert.deepEqual(plan, FULL);
});

test("test_an_end_that_went_backwards_repaints_in_full", () => {
  const plan = scrollPlan({ key: "a", end: 4000, carry: 0 }, { key: "a", end: 3800, span: SPAN });
  assert.deepEqual(plan, FULL);
});

test("test_a_shift_of_the_whole_width_repaints_in_full", () => {
  const plan = scrollPlan({ key: "a", end: 1000, carry: 0 }, { key: "a", end: 1000 + W, span: MS_PER_COLUMN_SPAN });
  assert.deepEqual(plan, FULL);
});

test("test_a_carry_that_brings_the_shift_to_the_whole_width_repaints_in_full", () => {
  const plan = scrollPlan({ key: "a", end: 1000, carry: 0.5 }, { key: "a", end: 999.5 + W, span: MS_PER_COLUMN_SPAN });
  assert.deepEqual(plan, FULL);
});

test("test_a_shift_one_column_short_of_the_width_scrolls_and_repaints_from_the_left_edge", () => {
  const plan = scrollPlan({ key: "a", end: 1000, carry: 0 }, { key: "a", end: 999 + W, span: MS_PER_COLUMN_SPAN });
  assert.deepEqual(plan, { full: false, shift: W - 1, from: 0, carry: 0 });
});

// 200 ms is a twentieth of a four-second span and a fortieth of an eight-second
// one: 60 and 30 of 1200 columns.
for (const [span, columns] of [
  [4000, 60],
  [8000, 30],
]) {
  test(`test_200_ms_of_new_frames_in_a_${span}_ms_span_scrolls_${columns}_columns`, () => {
    assert.equal(scrollPlan({ key: "a", end: 4000, carry: 0 }, { key: "a", end: 4200, span }).shift, columns);
  });
}

// 60 new columns are 1140 to 1199; the repaint starts one before them, at the
// seam they blend across.
test("test_a_scroll_repaints_from_the_column_before_the_new_ones", () => {
  assert.equal(scrollPlan({ key: "a", end: 4000, carry: 0 }, { key: "a", end: 4200, span: SPAN }).from, 1139);
});

test("test_a_fraction_of_a_column_is_carried_without_a_shift", () => {
  const plan = scrollPlan({ key: "a", end: 1000, carry: 0 }, { key: "a", end: 1000.5, span: MS_PER_COLUMN_SPAN });
  assert.deepEqual(plan, { full: false, shift: 0, from: W - 1, carry: 0.5 });
});

// Half a column carried, then three quarters more: one whole column, a quarter
// carried on.
test("test_a_carried_fraction_shifts_once_it_makes_a_whole_column", () => {
  const first = scrollPlan({ key: "a", end: 1000, carry: 0 }, { key: "a", end: 1000.5, span: MS_PER_COLUMN_SPAN });
  const plan = scrollPlan(
    { key: "a", end: 1000.5, carry: first.carry },
    { key: "a", end: 1001.25, span: MS_PER_COLUMN_SPAN },
  );
  assert.deepEqual(plan, { full: false, shift: 1, from: W - 2, carry: 0.25 });
});
