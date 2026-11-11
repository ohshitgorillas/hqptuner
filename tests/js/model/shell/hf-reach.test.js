// Behavioral suite: the content rate an HF filter is judged against (a DSD bitstream counts at its rate / 64) and which
// filters act on which content rate.
//
// Rates and filter names are tables the test writes; no shipped data supplies an input or an expected value.

import test from "node:test";
import assert from "node:assert/strict";

import { actsOn, contentRate } from "../../../../hqptuner/static/model/shell/hf-reach.js";

const NAMES = ["20k", "30k", "40k", "50k", "2x", "4x", "8x"];

/**
 * The names of the filters that act at a rate.
 *
 * @param {number | null} rate
 */
const acting = (rate) => NAMES.filter((n) => actsOn(n, rate));

test("contentRate: a PCM source counts at its own rate, however the engine spells it", () => {
  assert.deepEqual([contentRate("88200", false), contentRate(176400, false)], [88200, 176400]);
});

test("contentRate: a DSD source counts at its rate / 64", () => {
  assert.deepEqual([contentRate("2822400", true), contentRate("5644800", true)], [44100, 88200]);
});

test("contentRate: a missing, zero or non-numeric rate is no rate", () => {
  const rates = [undefined, "", "0", 0, "x", NaN];
  assert.deepEqual(
    rates.map((r) => contentRate(r, false)),
    rates.map(() => null),
  );
});

test("contentRate: a DSD source with no rate is no rate", () => {
  assert.equal(contentRate(undefined, true), null);
});

test("actsOn: nothing acts below 50 kHz, whatever the corner", () => {
  assert.deepEqual([acting(44100), acting(48000)], [[], []]);
});

test("actsOn: at 88.2 kHz the fixed corners below the Nyquist act and the 50k corner and the Nx filters do not", () => {
  assert.deepEqual(acting(88200), ["20k", "30k", "40k"]);
});

test("actsOn: at 176.4 kHz every fixed corner acts, and 2x with them", () => {
  assert.deepEqual(acting(176400), ["20k", "30k", "40k", "50k", "2x"]);
});

test("actsOn: the 48 kHz family is judged against its own base", () => {
  assert.deepEqual(
    [acting(96000), acting(192000)],
    [
      ["20k", "30k", "40k"],
      ["20k", "30k", "40k", "50k", "2x"],
    ],
  );
});

test("actsOn: 4x and 8x first act at their own multiples above the base", () => {
  assert.deepEqual([actsOn("4x", 352800), actsOn("8x", 352800), actsOn("8x", 705600)], [true, false, true]);
});

test("actsOn: none and an unknown name never read as non-acting", () => {
  assert.deepEqual([actsOn("none", 44100), actsOn("sinc-9000", 44100)], [true, true]);
});

test("actsOn: with no rate known every filter acts", () => {
  assert.deepEqual(acting(null), NAMES);
});
