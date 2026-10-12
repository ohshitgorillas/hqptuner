// The frequency span in store/faceplate/view.js across a reload: the span of the band the page's Source spectrum shows
// opens at Full on every page load, whatever was picked before, and is not remembered.
//
// A module that kept the span would read it once, when it is first imported, so a working fake storage is installed at
// file scope before it is pulled in, a narrower span is picked through the public setter, and a second instance loads
// under a `.fresh-<tag>.js` specifier (tests/js/support/vendor-resolve.js) over the same storage, standing in for the
// reload.
// The first instance is imported after the storage is installed rather than statically, which would hoist it ahead of
// the install and leave a pick nowhere to be remembered. The values set and read are the span's own identifiers.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/freqspan.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const MODULE = "../../../hqptuner/static/store/faceplate/view.js";

// The whole band, and its lower quarter, as the store holds them.
const FULL = "full";
const QUARTER = "quarter";

useStorage();

const { setFreqSpan } = await import("../../../hqptuner/static/store/faceplate/view.js");
setFreqSpan(QUARTER);

/** @type {typeof import("../../../hqptuner/static/store/faceplate/view.js")} */
const reloaded = await import(`${MODULE.replace(/\.js$/, ".fresh-span-reload.js")}`);

test("test_a_reload_opens_the_frequency_span_at_full_after_a_narrower_pick", () => {
  assert.equal(reloaded.freqSpan.value, FULL);
});
