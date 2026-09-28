// Behavioral case for closeExcept (components/narrowbar/popover.js): a pointerdown
// inside one facet's `.multi` wrapper keeps that facet's popover open and closes
// every other open one.
//
// The target is a plain object carrying the surface closeExcept reads, `closest`
// and the wrapper's `dataset.multi`; nothing of HQPTuner's is stubbed.

import test from "node:test";
import assert from "node:assert/strict";

import { closeExcept, genreOpen, rateOpen } from "../../../../hqptuner/static/components/narrowbar/popover.js";

test("closeExcept keeps the clicked facet's popover open and closes the other", () => {
  genreOpen.value = true;
  rateOpen.value = true;
  const wrapper = { dataset: { multi: "genre" } };
  const target = /** @type {Element} */ (/** @type {unknown} */ ({ closest: () => wrapper }));
  closeExcept(target);
  assert.deepEqual([genreOpen.value, rateOpen.value], [true, false]);
});
