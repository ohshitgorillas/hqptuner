// The spectrum ghost preference against a stored value that is not one of the three ghost styles, as a key edited by
// hand or left by another build would be. It loads as the fall ghost rather than reaching the spectrum.
//
// The seeded value is "peak": well formed and plausible as a ghost name, so only a membership check against the three
// styles turns it away.
//
// Own process on purpose (tests/js/store/spectrumstyle-pref-junk.test.js is the pattern): the module reads storage
// once at import, so the fake is installed and seeded with the bad value BEFORE prefs.js is imported.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/spectrumghost-pref-junk.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const storage = useStorage();
storage.setItem("hqptuner.spectrumGhost", "peak");

const prefs = await import("../../../hqptuner/static/store/ui/prefs.js");

const FALL = "fall";

test("test_a_ghost_the_store_does_not_offer_loads_the_fall_ghost", () => {
  assert.equal(prefs.spectrumGhost.value, FALL);
});
