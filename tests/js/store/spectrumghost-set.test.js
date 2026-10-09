// The spectrum ghost setter: what setSpectrumGhost() writes to storage.
//
// Storage-shape-independent (tests/js/store/spectrumstyle-set.test.js is the pattern): nothing here reads the key at
// load, so a working fake localStorage is installed at file scope and the case writes through the public setter only.
// What a stored ghost loads as is the -pref-unset, -pref-junk and -pref-stored files'.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/spectrumghost-set.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const storage = useStorage();

const prefs = await import("../../../hqptuner/static/store/ui/prefs.js");

const KEY = "hqptuner.spectrumGhost";
const AVERAGE = "average";

test("test_choosing_a_ghost_persists_it", () => {
  prefs.setSpectrumGhost(AVERAGE);
  assert.equal(storage.getItem(KEY), AVERAGE);
});
