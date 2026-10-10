// The spectrum style preference against a stored value that is not one of the
// styles the store offers, as a key edited by hand or left by another build
// would be. It loads as the trace style rather than reaching the spectrum.
//
// The seeded value is "spectrogram": well formed and plausible as a style name,
// so only a membership check against SPECTRUM_STYLES turns it away.
//
// Own process on purpose (tests/js/store/presets/apodwindow-pref-junk.test.js is
// the pattern): the module reads storage once at import, so the fake is
// installed and seeded with the bad value BEFORE prefs.js is imported.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/spectrumstyle-pref-junk.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const storage = useStorage();
storage.setItem("hqptuner.spectrumStyle", "spectrogram");

const prefs = await import("../../../hqptuner/static/store/ui/prefs.js");

const TRACE = "trace";

test("test_a_style_the_store_does_not_offer_loads_the_trace_style", () => {
  assert.equal(prefs.spectrumStyle.value, TRACE);
});
