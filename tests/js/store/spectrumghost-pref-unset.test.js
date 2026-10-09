// The spectrum ghost preference when localStorage is PRESENT but holds no hqptuner.spectrumGhost key: a browser that
// has never seen the control loads the fall ghost.
//
// Own process on purpose (tests/js/store/spectrumstyle-pref-unset.test.js is the pattern): the module reads storage
// once at import, so each storage shape needs a file of its own. The working fake is installed BEFORE prefs.js is
// imported and nothing seeds it.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/spectrumghost-pref-unset.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const prefs = await import("../../../hqptuner/static/store/ui/prefs.js");

const FALL = "fall";

test("test_storage_present_but_the_key_unset_loads_the_fall_ghost", () => {
  assert.equal(prefs.spectrumGhost.value, FALL);
});
