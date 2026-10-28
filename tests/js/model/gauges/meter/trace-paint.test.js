// Behavioral suite for what a paint hands the trace's column reduction (hqptuner/static/model/gauges/meter/meter.js):
// each paint hands `traceColumns` the column buffer the paint before it returned, and that buffer comes back refilled
// with this paint's columns.
//
// Which bin a column reads is pinned in meter-math.test.js; this suite reads its expected columns from a call handed
// nothing back, so it pins the buffer a paint gets back, not the reduction again.
//
// The reduction is read off the module namespace, typed with the buffer it is handed back, so the call type-checks
// before the surface takes it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/gauges/meter/trace-paint.test.js

import test from "node:test";
import assert from "node:assert/strict";

import * as meterModel from "../../../../../hqptuner/static/model/gauges/meter/meter.js";

/**
 * The trace's column reduction as a paint uses it.
 *
 * @type {{ traceColumns: (bins: ArrayLike<number>, columns: number, out?: Float32Array) => Float32Array }}
 */
const meter = /** @type {any} */ (meterModel);

//: Nine bins, dBFS, from 0 Hz to Nyquist: a tone low in the lower half, a quieter one high in the upper half.
const BINS = Float32Array.from([-50, -6, -50, -50, -50, -50, -50, -30, -50]);
//: Columns asked for.
const COLUMNS = 2;
//: Full scale, louder than any bin of BINS: what a louder earlier paint left in the buffer.
const FULL_SCALE = 0;

test("test_a_paint_gets_back_the_column_buffer_it_handed_in", () => {
  const out = new Float32Array(COLUMNS);
  assert.equal(meter.traceColumns(BINS, COLUMNS, out), out);
});

test("test_a_handed_column_buffer_holds_this_paints_columns_not_a_louder_earlier_paints", () => {
  const out = new Float32Array(COLUMNS).fill(FULL_SCALE);
  meter.traceColumns(BINS, COLUMNS, out);
  assert.deepEqual(Array.from(out), Array.from(meter.traceColumns(BINS, COLUMNS)));
});
