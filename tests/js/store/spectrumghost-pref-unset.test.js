// The spectrum ghost preference when localStorage is PRESENT but holds no hqptuner.spectrumGhost key: a browser that
// has never seen the control loads the fall ghost, and setSpectrumGhost() writes a chosen ghost to storage.
//
// Own process on purpose (tests/js/store/spectrumstyle-pref-unset.test.js is the pattern): the module reads storage
// once at import, so each storage shape needs a file of its own. The working fake is installed BEFORE prefs.js is
// imported and nothing seeds it. The setter case shares the process because it reads nothing at load and writes
// through the public setter only; it runs after the load case, since the setter changes the loaded value.
// What a stored ghost loads as is the -pref-junk and -pref-stored files'.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/spectrumghost-pref-unset.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const storage = useStorage();

const prefs = await import("../../../hqptuner/static/store/ui/prefs.js");

const KEY = "hqptuner.spectrumGhost";
const FALL = "fall";
const AVERAGE = "average";

test("test_storage_present_but_the_key_unset_loads_the_fall_ghost", () => {
  assert.equal(prefs.spectrumGhost.value, FALL);
});

test("test_choosing_a_ghost_persists_it", () => {
  prefs.setSpectrumGhost(AVERAGE);
  assert.equal(storage.getItem(KEY), AVERAGE);
});
