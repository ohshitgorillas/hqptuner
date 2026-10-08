// The spectrum style setter: what setSpectrumStyle() writes to storage.
//
// Storage-shape-independent (tests/js/store/presets/apodwindow-set.test.js is the
// pattern): nothing here reads the key at load, so a working fake localStorage
// is installed at file scope and the case writes through the public setter
// only. What a stored style loads as is the -pref-unset and -pref-junk files'.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/spectrumstyle-set.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const storage = useStorage();

const prefs = await import("../../../hqptuner/static/store/ui/prefs.js");

const KEY = "hqptuner.spectrumStyle";
const RIDGES = "ridges";

test("test_choosing_a_spectrum_style_persists_it", () => {
  prefs.setSpectrumStyle(RIDGES);
  assert.equal(storage.getItem(KEY), RIDGES);
});
