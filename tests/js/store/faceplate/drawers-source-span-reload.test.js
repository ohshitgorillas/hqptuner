// The spectrogram's frequency span in hqptuner/static/store/faceplate/drawers/source.js across a reload: the Source
// drawer's spectrogram opens at the whole band on every page load, whatever span was picked before it.
//
// A fake storage goes in before the store is first loaded, so a store that saved the pick has somewhere to put it and
// read it back. The quarter span is picked on that first load; a second copy of the store, loaded under a
// `.fresh-<tag>.js` specifier (tests/js/support/vendor-resolve.js) over the same storage, is the page after the reload.
// The span is read through the module namespace, so a store without one reads as no span at all.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/drawers-source-span-reload.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../../support/storage.js";

const STORE = "../../../../hqptuner/static/store/faceplate/drawers/source.js";

// The whole band and its lower quarter, as the store holds them.
const WHOLE_BAND = "full";
const LOWER_QUARTER = "quarter";

useStorage();

/** @type {Record<string, any>} */
const firstLoad = await import(STORE);
firstLoad.setSpectrogramSpan?.(LOWER_QUARTER);

/** @type {Record<string, any>} */
const afterReload = await import(STORE.replace(/\.js$/, ".fresh-spectrogram-span.js"));

test("test_after_a_reload_the_spectrogram_opens_at_the_whole_band_though_a_quarter_was_picked", () => {
  assert.equal(afterReload.spectrogramSpan?.value, WHOLE_BAND);
});
