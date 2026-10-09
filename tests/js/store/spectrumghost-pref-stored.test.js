// The spectrum ghost preference against a pick stored on an earlier visit: a stored fade ghost loads as the fade
// ghost, so the pick survives a reload.
//
// Own process on purpose (tests/js/store/spectrumstyle-pref-junk.test.js is the pattern): the module reads storage
// once at import, so the fake is installed and seeded with the stored pick BEFORE prefs.js is imported. The seeded
// value is not the default, so a loader that ignores storage fails here.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/spectrumghost-pref-stored.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const FADE = "fade";

const storage = useStorage();
storage.setItem("hqptuner.spectrumGhost", FADE);

const prefs = await import("../../../hqptuner/static/store/ui/prefs.js");

test("test_a_stored_fade_ghost_loads_the_fade_ghost", () => {
  assert.equal(prefs.spectrumGhost.value, FADE);
});
