// Contract suite for what one column and one row of the spectrogram's picture show: no blend in time or in frequency.
// Each column shows the one slice covering most of it, the earlier of two covering it equally; each row the nearest row of
// that slice; and between two rows of a slice no row shows a level between them.
//
// Two feeds on the real stack (tests/js/contracts/world.js). The first is 40 slices of exactly 25 ms, the width of one
// column of the 30 s window, laid end to end at a metering rate of 1000 Hz so every stamp is whole. The playhead stands at
// the newest end in one replay, which puts a column on each slice exactly, and half a column short of it in the other,
// which puts every column's middle on a slice boundary, so each column covers two slices equally. The picture there is
// the aligned picture moved one column right if the earlier slice wins, and as it is if the later one does. The second is
// the steady generated schedule at the quarter frequency span, where one row of a slice lies under four pixel rows: down a
// column no pixel row changes color where the slice's nearest row does not.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/contracts/spectrogram-columns.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { GLASS_SIGNATURE, W, signatures } from "./picture.js";
import { rowProbe } from "./picture-probes.js";
import { SCHEDULES } from "./schedules.js";
import { replay } from "./world.js";

//: 40 frames of 25 samples at 1000 Hz: 25 ms each, one slice each. Both replays deliver them all before the first paint,
//: which stands the playhead `delay` s behind the newest end, 1000 ms.
const SLICE_MS = 25;
const SLICES = 40;
const feed = Array.from({ length: SLICES }, () => ({ t: 0, n: SLICE_MS }));
const paints = [10];
const stoodBehind = (/** @type {number} */ delay) => ({ name: `behind_${delay}`, rate: 1000, delay, paints, feed });

//: The columns compared: well inside the music, which fills the 40 columns left of the right edge.
const INSIDE = Array.from({ length: 28 }, (_, k) => W - 38 + k);

/**
 * The picture's column signatures after the last paint of a replay.
 *
 * @param {number} delay  s
 * @returns {Int32Array}
 */
function pictureBehind(delay) {
  const out = new Int32Array(W);
  replay(stoodBehind(delay), (paint, world) => {
    if (paint.i === paints.length - 1) signatures(world.canvas, out);
  });
  return out;
}

test("test_a_column_covering_two_slices_equally_shows_the_earlier", () => {
  const aligned = pictureBehind(0);
  const split = pictureBehind(SLICE_MS / 2 / 1000);
  assert.deepEqual(
    {
      music: INSIDE.every((x) => aligned[x - 1] !== GLASS_SIGNATURE),
      off: INSIDE.filter((x) => split[x] !== aligned[x - 1]),
    },
    { music: true, off: [] },
  );
});

//: The quarter frequency span keeps a quarter of the band in view; a slice at 44.1 kHz holds 480 rows up to 22.05 kHz.
const QUARTER = 0.25;
const NYQUIST = 22050;
const ROWS = 480;
const NONE = { count: 0, first: "" };

test("test_no_pixel_row_changes_color_where_the_nearest_row_of_its_slice_does_not", () => {
  const probe = rowProbe(NYQUIST, ROWS, QUARTER);
  const steady = SCHEDULES[0];
  replay(
    steady,
    (paint, world) => {
      if (paint.i === steady.paints.length - 1) probe.see(paint, world);
    },
    "quarter",
  );
  const { read, blend } = probe.done();
  assert.deepEqual({ read: read > 1000, blend }, { read: true, blend: NONE });
});
