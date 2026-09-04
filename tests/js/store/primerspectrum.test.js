// Behavioral suite for the primer's spectrum: the grid the graph is drawn on,
// the fold that downsampling performs, and the pass-through when nothing
// resamples. Written blind from a spec block; no store or dsp source was read.
//
// Every assertion is on a number the code hands out — a dB reading, a frequency
// step, the last point of the axis — never on a word (docs/testing.md rule 9).
//
// Every test sets every input it depends on and leaves the store as it found it:
// `showMe("intro")` after each.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/primerspectrum.test.js

import test from "node:test";
import assert from "node:assert/strict";

const STORE = "../../../hqptuner/static/store/primergraph.js";
const DSP = "../../../hqptuner/static/lib/dsp/spectrum.js";

test.afterEach(async () => {
  const { showMe } = await import(STORE);
  showMe("intro");
});

/**
 * The inputs the spec fixes for every line unless the line says otherwise.
 *
 * @param {{
 *   phase: { value: string },
 *   rolloff: { value: number },
 *   transientUs: { value: number },
 *   content: { value: { spurs: boolean, fakeHires: boolean, risingNoise: boolean } },
 *   rate: { value: number },
 *   lengthMs: { value: number },
 *   outputRate: { value: number | null },
 * }} store
 * @param {{ rate: number, outputRate: number | null, lengthMs: number }} c
 */
function configure(store, c) {
  store.phase.value = "linear";
  store.rolloff.value = 0.5;
  store.transientUs.value = 100;
  store.content.value = { spurs: false, fakeHires: false, risingNoise: false };
  store.rate.value = c.rate;
  store.lengthMs.value = c.lengthMs;
  store.outputRate.value = c.outputRate;
}

// 1. no oversampling means the result is the source, untouched, everywhere on
// the grid: 44.1 kHz in, nothing out, source and result within 0.01 dB.
test("test_result_equals_source_everywhere_when_nothing_oversamples", async () => {
  const store = await import(STORE);
  configure(store, { rate: 44100, lengthMs: 8, outputRate: null });
  const { sourceDb, resultDb } = store.spectrum.value;
  let worst = 0;
  let worstIndex = -1;
  for (let i = 0; i < sourceDb.length; i++) {
    const gap = Math.abs(resultDb[i] - sourceDb[i]);
    if (gap > worst) {
      worst = gap;
      worstIndex = i;
    }
  }
  assert.ok(
    worst <= 0.01,
    `expected result to track source within 0.01 dB, worst gap ${worst} dB at index ${worstIndex}`,
  );
});

// 2. the fold counts each image once: a flat -100 dB stream at 192 kHz taken to
// 96 kHz reads 3.01 dB hotter at DC, where the reflection lands on a distinct
// bin, than at 48 kHz, where the reflection is the bin itself.
test("test_fold_of_a_flat_stream_reads_three_db_hotter_at_dc_than_at_half_the_output_rate", async () => {
  const { foldSpectrumDb } = await import(DSP);
  const freqsHz = Array.from({ length: 1025 }, (_, i) => i * 375);
  const levelsDb = new Float64Array(freqsHz.length).fill(-100);
  const folded = foldSpectrumDb(levelsDb, freqsHz, 192000, 96000);
  const step = folded[0] - folded[128];
  assert.ok(
    Math.abs(step - 3.01) <= 0.05,
    `expected 0 Hz (${folded[0]}) to sit 3.01 dB above 48 kHz (${folded[128]}), got ${step}`,
  );
});

// 3. the grid resolves the sidelobe comb at every length: four times the Length
// is four times the resolution, so the frequency step at 32 ms is a quarter of
// the step at 8 ms.
test("test_grid_step_at_thirty_two_milliseconds_is_a_quarter_of_the_step_at_eight", async () => {
  const store = await import(STORE);
  configure(store, { rate: 44100, lengthMs: 8, outputRate: 176400 });
  const short = store.spectrum.value.freqsHz;
  const shortStep = short[1] - short[0];
  configure(store, { rate: 44100, lengthMs: 32, outputRate: 176400 });
  const long = store.spectrum.value.freqsHz;
  const longStep = long[1] - long[0];
  const ratio = longStep / shortStep;
  assert.ok(
    Math.abs(ratio - 0.25) <= 0.01,
    `expected the 32 ms step (${longStep}) to be a quarter of the 8 ms step (${shortStep}), ratio ${ratio}`,
  );
});

// 4. the axis stops at the Nyquist of the faster stream, nothing beyond it:
// 96 kHz for 192 kHz down to 96 kHz, 88.2 kHz for 44.1 kHz with no oversampling.
test("test_axis_ends_at_the_faster_streams_nyquist_in_both_directions", async () => {
  const store = await import(STORE);
  const ends = [
    { rate: 192000, outputRate: 96000 },
    { rate: 44100, outputRate: null },
  ].map((c) => {
    configure(store, { rate: c.rate, lengthMs: 8, outputRate: c.outputRate });
    const grid = store.spectrum.value.freqsHz;
    return Math.round(grid[grid.length - 1]);
  });
  assert.deepEqual(ends, [96000, 88200]);
});
