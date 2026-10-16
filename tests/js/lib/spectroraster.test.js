// Behavioral suite for lib/spectroraster.js, the spectrogram's color ramp and
// pixel raster.
//
// Every slice carries its own playback stamp, `at` and `ms`, written by hand
// here as the history would hand it over; the window is the playback from
// `edge - span` to `edge`.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/spectroraster.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { W, rampFrom, rasterize, scrollPlan } from "../../../hqptuner/static/lib/spectroraster.js";

// Floor a dark blue, top a warm yellow: apart from each other and from black,
// with a steep last segment so a neighboring step reads as a different color.
const RAMP = rampFrom(["#1a2a6c", "#1a2a6c", "#1a2a6c", "#1a2a6c", "#1a2a6c", "#f5d142"]);

// A ramp whose red channel is its own step, so a pixel names the step it took.
/** @type {[number, number, number][]} */
const STEPS = Array.from({ length: 256 }, (_, i) => [i, 255 - i, 128]);

// At this range a byte b (dBFS -1.2 b) takes step 255 - b: one step per byte.
const BYTE_RANGE = 306;

const ROWS = 480;
const NYQUIST = 22050;
const SPAN = 4000;

// The window's right edge, playback ms: well into a track, so a slice placed
// from zero rather than from its stamp lands outside the window.
const EDGE = 90000;

// The window's left edge, playback ms.
const LEFT = EDGE - SPAN;

/**
 * A slice's rows: row r carries `byteAt(r)`.
 *
 * @param {(r: number) => number} byteAt
 */
const rows = (byteAt) => Uint8Array.from({ length: ROWS }, (_, r) => byteAt(r));

/** @param {number} byte */
const flat = (byte) => rows(() => byte);

/**
 * A stored slice starting at `at` and lasting `ms`, both playback ms, whose
 * summed rows are `sum` and whose two channels carry `channels`.
 *
 * @param {number} at
 * @param {number} ms
 * @param {Uint8Array} sum
 * @param {{ nyquist?: number, channels?: Uint8Array[] }} [more]
 */
const cell = (at, ms, sum, { nyquist = NYQUIST, channels = [sum, sum] } = {}) => ({ at, ms, nyquist, channels, sum });

/**
 * The view over every one of `slices` at the step ramp's range, summed,
 * topped at the CD Nyquist and ending at EDGE.
 *
 * @param {ArrayLike<ReturnType<typeof cell>>} slices
 * @param {{ lo?: number, hi?: number, pick?: string, edge?: number, span?: number, top?: number }} [over]
 */
const view = (slices, { lo = 0, hi = slices.length, pick = "sum", edge = EDGE, span = SPAN, top = NYQUIST } = {}) => ({
  slices,
  lo,
  hi,
  pick,
  edge,
  span,
  range: BYTE_RANGE,
  top,
});

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
 * The RGB channels of the raster's center pixel.
 *
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} raster
 * @returns {number[]}
 */
function centerRgb({ width, height, data }) {
  const at = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
  return Array.from(data.subarray(at, at + 3));
}

/**
 * Pixel columns `from` up to, not including, `to` of a raster, as a raster of
 * their own.
 *
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} raster
 * @param {number} from
 * @param {number} [to]
 */
function columns({ width, height, data }, from, to = width) {
  const out = new Uint8ClampedArray((to - from) * height * 4);
  for (let y = 0; y < height; y++) {
    out.set(data.subarray((y * width + from) * 4, (y * width + to) * 4), y * (to - from) * 4);
  }
  return { width: to - from, height, data: out };
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

// One slice filling the window exactly.
/** @param {Uint8Array} sum */
const whole = (sum) => [cell(LEFT, SPAN, sum)];

test("test_a_band_at_full_scale_paints_the_ramps_top_color", () => {
  const raster = rasterize(RAMP, { ...view(whole(flat(0))), range: 120 });
  assert.deepEqual(centerRgb(raster), RAMP[RAMP.length - 1]);
});

// Bytes 25, 100 and 105 are -30, -120 and -126 dBFS: three quarters up a
// 120 dB range, its floor, and below it.
test("test_a_level_takes_its_step_from_the_ranges_floor_to_full_scale", () => {
  const levels = rows((r) => ({ 479: 25, 478: 100, 477: 105 })[r] ?? 0);
  const raster = rasterize(STEPS, { ...view(whole(levels)), range: 120 });
  assert.deepEqual(stepsDown(raster, 600, [0, 1, 2]), [191, 0, 0]);
});

// Topped at the slice's own Nyquist, pixel row y sits on slice row 479 - y.
test("test_a_view_topped_at_the_nyquist_reads_one_slice_row_per_pixel_row", () => {
  const raster = rasterize(STEPS, view(whole(rows((r) => 2 * (r % 120)))));
  assert.deepEqual(stepsDown(raster, 600, [0, 1, 239, 240, 478, 479]), [17, 19, 255, 17, 253, 255]);
});

// Topped at half a 44.1 kHz slice's Nyquist, pixel row 0 sits a quarter of the
// way from slice row 239 to 240, and row 1 three quarters of the way from 238.
test("test_a_pixel_row_between_two_slice_rows_blends_them", () => {
  const levels = rows((r) => ({ 239: 100, 240: 200 })[r] ?? 0);
  const raster = rasterize(STEPS, view([cell(LEFT, SPAN, levels, { nyquist: 44100 })]));
  assert.deepEqual(stepsDown(raster, 600, [0, 1]), [130, 180]);
});

// The bottom pixel row sits a quarter row below slice row 0, the one above it
// a quarter of the way from row 0 to row 1.
test("test_a_pixel_row_below_the_first_slice_row_reads_the_first", () => {
  const levels = rows((r) => ({ 0: 40, 1: 140 })[r] ?? 0);
  const raster = rasterize(STEPS, view([cell(LEFT, SPAN, levels, { nyquist: 44100 })]));
  assert.deepEqual(stepsDown(raster, 600, [478, 479]), [190, 215]);
});

// Topped at twice the slice's Nyquist, the slice reaches pixel row 240.
test("test_rows_above_a_slices_nyquist_stay_transparent", () => {
  const raster = rasterize(STEPS, view(whole(flat(55)), { top: 2 * NYQUIST }));
  assert.deepEqual(stepsDown(raster, 600, [238, 239, 240, 479]), [null, null, 200, 200]);
});

// A second of history in a four-second window, stamped to end at the edge,
// fills its last quarter.
test("test_a_slice_stands_where_its_stamp_says_and_leaves_the_strip_before_it_unpainted", () => {
  const raster = rasterize(STEPS, view([cell(EDGE - 1000, 1000, flat(55))]));
  assert.deepEqual(stepsAcross(raster, [0, 899, 900, 1199], 240), [null, null, 200, 200]);
});

// The newest slice is stamped to end half a second before the edge: columns
// 900 to 1049 are its own, and the playback after it has nothing to show.
test("test_the_strip_between_the_newest_slices_end_and_the_edge_stays_unpainted", () => {
  const raster = rasterize(STEPS, view([cell(EDGE - 1000, 500, flat(55))]));
  assert.deepEqual(stepsAcross(raster, [1000, 1199], 240), [200, null]);
});

// The first slice ends at column 149 in one history and at 239 in the other;
// the second is stamped at column 300 in both, so from column 270 on the two
// rasters agree.
test("test_an_earlier_slices_length_does_not_move_a_later_slice_off_its_stamp", () => {
  const later = cell(EDGE - 3000, 1000, flat(120));
  const short = rasterize(STEPS, view([cell(LEFT, 500, flat(30)), later]));
  const long = rasterize(STEPS, view([cell(LEFT, 800, flat(30)), later]));
  assert.deepEqual(fingerprint(columns(long, 270)), fingerprint(columns(short, 270)));
});

// A slice stamped at the edge is playback the window does not reach yet.
test("test_a_slice_stamped_at_the_edge_paints_nothing", () => {
  const drawn = [cell(EDGE - 1000, 1000, flat(55))];
  const raster = rasterize(STEPS, view(drawn));
  const ahead = rasterize(STEPS, view([...drawn, cell(EDGE, 1000, flat(200))]));
  assert.deepEqual(fingerprint(ahead), fingerprint(raster));
});

// Two slices of two seconds each: a column blends toward the neighbor on its
// side of the slice's center, nearly halfway at the shared edge.
test("test_a_column_blends_toward_the_neighboring_slice", () => {
  const raster = rasterize(STEPS, view([cell(LEFT, 2000, flat(0)), cell(LEFT + 2000, 2000, flat(240))]));
  assert.deepEqual(stepsAcross(raster, [299, 449, 599, 900], 240), [255, 195, 135, 15]);
});

// A second of playback with no slice between two that are stamped either side
// of it.
test("test_an_interval_no_stamp_covers_stays_unpainted_and_its_neighbors_do_not_blend_across_it", () => {
  const slices = [cell(LEFT, 1000, flat(0)), cell(LEFT + 2000, 2000, flat(200))];
  assert.deepEqual(stepsAcross(rasterize(STEPS, view(slices)), [299, 300, 599, 600], 240), [255, null, null, 55]);
});

// A slice whose two channels and sum all differ row by row.
const PICKED = cell(
  LEFT,
  SPAN,
  rows((r) => (r * 7) % 256),
  {
    channels: [rows((r) => r % 200), rows((r) => (r * 3) % 256)],
  },
);

test("test_a_picked_channel_paints_that_channels_rows", () => {
  const channel = rasterize(STEPS, view([PICKED], { pick: "1" }));
  const asSum = rasterize(STEPS, view([cell(LEFT, SPAN, PICKED.channels[1], { channels: PICKED.channels })]));
  assert.deepEqual(fingerprint(channel), fingerprint(asSum));
});

test("test_a_picked_channel_the_slice_lacks_paints_the_sum", () => {
  const missing = rasterize(STEPS, view([PICKED], { pick: "2" }));
  assert.deepEqual(fingerprint(missing), fingerprint(rasterize(STEPS, view([PICKED]))));
});

// The slice outside [lo, hi) is stamped inside the window, a gap away from
// the drawn ones so no column blends toward it.
const OUTSIDE = cell(LEFT, 500, flat(10));
const DRAWN = [cell(LEFT + 1000, 1500, flat(90)), cell(LEFT + 2500, 1500, flat(170))];

test("test_slices_before_lo_are_not_drawn", () => {
  const raster = rasterize(STEPS, view([OUTSIDE, ...DRAWN], { lo: 1 }));
  assert.deepEqual(fingerprint(raster), fingerprint(rasterize(STEPS, view(DRAWN))));
});

test("test_slices_from_hi_on_are_not_drawn", () => {
  const early = [cell(LEFT, 1500, flat(90))];
  const late = cell(LEFT + 2500, 1500, flat(170));
  const raster = rasterize(STEPS, view([...early, late], { hi: 1 }));
  assert.deepEqual(fingerprint(raster), fingerprint(rasterize(STEPS, view(early))));
});

/**
 * A history of `count` slices of a tenth of a second each, the newest ending
 * at EDGE, which notes in `read` every index a reader takes from it.
 *
 * @param {number} count
 * @param {Set<number>} read
 */
function watchedHistory(count, read) {
  const slices = Array.from({ length: count }, (_, k) => cell(EDGE - 100 * (count - k), 100, flat(k % 256)));
  return new Proxy(slices, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) read.add(Number(key));
      return Reflect.get(target, key, receiver);
    },
  });
}

/**
 * How many of a history's slices one paint of its newest forty reads.
 *
 * @param {number} count
 */
function slicesReadPainting(count) {
  const read = new Set();
  rasterize(STEPS, view(watchedHistory(count, read), { lo: count - 40, hi: count }));
  return read.size;
}

test("test_a_paint_reads_no_more_of_a_long_history_than_of_a_short_one", () => {
  assert.equal(slicesReadPainting(4000), slicesReadPainting(40));
});

// A span of W ms makes one column a millisecond, so edges in whole ms move
// the picture by whole columns.
const MS_PER_COLUMN_SPAN = W;

// Slices of mixed lengths with one gap, rows differing from slice to slice,
// running from playback 0 to 1500 ms.
const FEED = [
  cell(
    0,
    200,
    rows((r) => r % 256),
  ),
  cell(
    200,
    250,
    rows((r) => (r + 40) % 256),
  ),
  cell(
    450,
    175.5,
    rows((r) => (r + 80) % 256),
  ),
  cell(
    625.5,
    300,
    rows((r) => (r + 120) % 256),
  ),
  cell(
    1000,
    225.25,
    rows((r) => (r + 160) % 256),
  ),
  cell(
    1225.25,
    274.75,
    rows((r) => (r + 200) % 256),
  ),
];

// The edge moves from 1300 to 1400: the playback at column 100 of the first
// paint stands at column 0 of the second.
test("test_moving_the_edge_moves_the_picture_left_by_the_same_playback", () => {
  const before = rasterize(STEPS, view(FEED, { edge: 1300, span: MS_PER_COLUMN_SPAN }));
  const after = rasterize(STEPS, view(FEED, { edge: 1400, span: MS_PER_COLUMN_SPAN }));
  assert.deepEqual(fingerprint(columns(after, 0, W - 100)), fingerprint(columns(before, 100)));
});

// An unpainted second, then five slices of 180 columns whose rows differ from
// one another and from slice to slice, so every column is its own.
const BANDED = view([
  cell(
    EDGE - 3000,
    600,
    rows((r) => r % 256),
  ),
  cell(
    EDGE - 2400,
    600,
    rows((r) => (r + 40) % 256),
  ),
  cell(
    EDGE - 1800,
    600,
    rows((r) => (r + 80) % 256),
  ),
  cell(
    EDGE - 1200,
    600,
    rows((r) => (r + 120) % 256),
  ),
  cell(
    EDGE - 600,
    600,
    rows((r) => (r + 160) % 256),
  ),
]);

// Column 700 lies left of its slice's center, so it blends toward a slice that
// ends before it.
for (const from of [1, 700, W - 1]) {
  test(`test_a_raster_from_column_${from}_is_the_full_rasters_columns_from_there_to_the_right_edge`, () => {
    assert.deepEqual(fingerprint(rasterize(STEPS, BANDED, from)), fingerprint(columns(rasterize(STEPS, BANDED), from)));
  });
}

// Forty slices of a tenth of a second and 30 columns apiece, the newest
// spanning columns 1170 to 1199. Column 1170 lies left of the newest slice's
// center, so it blends toward the slice before it.
test("test_a_raster_from_the_newest_slices_first_column_is_the_full_rasters_columns_from_there", () => {
  const forty = view(watchedHistory(40, new Set()));
  assert.deepEqual(fingerprint(rasterize(STEPS, forty, W - 30)), fingerprint(columns(rasterize(STEPS, forty), W - 30)));
});

const FULL = { full: true, shift: 0, from: 0, carry: 0 };

test("test_a_first_plan_repaints_in_full", () => {
  assert.deepEqual(scrollPlan(null, { key: "a", edge: 5000, span: SPAN }), FULL);
});

test("test_a_changed_key_repaints_in_full", () => {
  const plan = scrollPlan({ key: "a", edge: 4000, carry: 0 }, { key: "b", edge: 4200, span: SPAN });
  assert.deepEqual(plan, FULL);
});

test("test_an_edge_that_went_backwards_repaints_in_full", () => {
  const plan = scrollPlan({ key: "a", edge: 4000, carry: 0 }, { key: "a", edge: 3800, span: SPAN });
  assert.deepEqual(plan, FULL);
});

test("test_a_paint_with_the_same_edge_scrolls_nothing", () => {
  const plan = scrollPlan({ key: "a", edge: 4000, carry: 0 }, { key: "a", edge: 4000, span: SPAN });
  assert.deepEqual({ full: plan.full, shift: plan.shift }, { full: false, shift: 0 });
});

test("test_a_shift_of_the_whole_width_repaints_in_full", () => {
  const plan = scrollPlan({ key: "a", edge: 1000, carry: 0 }, { key: "a", edge: 1000 + W, span: MS_PER_COLUMN_SPAN });
  assert.deepEqual(plan, FULL);
});

test("test_a_carry_that_brings_the_shift_to_the_whole_width_repaints_in_full", () => {
  const plan = scrollPlan(
    { key: "a", edge: 1000, carry: 0.5 },
    { key: "a", edge: 999.5 + W, span: MS_PER_COLUMN_SPAN },
  );
  assert.deepEqual(plan, FULL);
});

test("test_a_shift_one_column_short_of_the_width_scrolls_and_repaints_from_the_left_edge", () => {
  const plan = scrollPlan({ key: "a", edge: 1000, carry: 0 }, { key: "a", edge: 999 + W, span: MS_PER_COLUMN_SPAN });
  assert.deepEqual(plan, { full: false, shift: W - 1, from: 0, carry: 0 });
});

// 200 ms is a twentieth of a four-second span and a fortieth of an eight-second
// one: 60 and 30 of 1200 columns.
for (const [span, cols] of [
  [4000, 60],
  [8000, 30],
]) {
  test(`test_an_edge_moving_200_ms_in_a_${span}_ms_span_scrolls_${cols}_columns`, () => {
    assert.equal(scrollPlan({ key: "a", edge: 4000, carry: 0 }, { key: "a", edge: 4200, span }).shift, cols);
  });
}

// The same 200.5 ms of movement, starting on a column boundary and three
// quarters of the way through a column: both scroll 200 columns.
for (const from of [4000, 7000.75]) {
  test(`test_an_edge_moving_200_5_ms_from_${from}_scrolls_200_columns`, () => {
    const plan = scrollPlan(
      { key: "a", edge: from, carry: 0 },
      { key: "a", edge: from + 200.5, span: MS_PER_COLUMN_SPAN },
    );
    assert.equal(plan.shift, 200);
  });
}

// 60 new columns are 1140 to 1199; the repaint starts one before them, at the
// seam they blend across.
test("test_a_scroll_repaints_from_the_column_before_the_new_ones", () => {
  assert.equal(scrollPlan({ key: "a", edge: 4000, carry: 0 }, { key: "a", edge: 4200, span: SPAN }).from, 1139);
});

test("test_a_fraction_of_a_column_is_carried_without_a_shift", () => {
  const plan = scrollPlan({ key: "a", edge: 1000, carry: 0 }, { key: "a", edge: 1000.5, span: MS_PER_COLUMN_SPAN });
  assert.deepEqual(plan, { full: false, shift: 0, from: W - 1, carry: 0.5 });
});

// Half a column carried, then three quarters more: one whole column, a quarter
// carried on.
test("test_a_carried_fraction_shifts_once_it_makes_a_whole_column", () => {
  const first = scrollPlan({ key: "a", edge: 1000, carry: 0 }, { key: "a", edge: 1000.5, span: MS_PER_COLUMN_SPAN });
  const plan = scrollPlan(
    { key: "a", edge: 1000.5, carry: first.carry },
    { key: "a", edge: 1001.25, span: MS_PER_COLUMN_SPAN },
  );
  assert.deepEqual(plan, { full: false, shift: 1, from: W - 2, carry: 0.25 });
});
