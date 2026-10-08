// The spectrum style preference against a stored "waterfall": a style the store
// no longer offers, left in storage by a build that did. It loads as the trace
// style rather than reaching the spectrum.
//
// Own process on purpose (tests/js/store/spectrumstyle-pref-junk.test.js is the
// pattern): the module reads storage once at import, so the fake is installed
// and seeded with the retired value BEFORE prefs.js is imported.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/spectrumstyle-pref-retired.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const storage = useStorage();
storage.setItem("hqptuner.spectrumStyle", "waterfall");

const prefs = await import("../../../hqptuner/static/store/ui/prefs.js");

const TRACE = "trace";

test("test_a_stored_waterfall_style_loads_the_trace_style", () => {
  assert.equal(prefs.spectrumStyle.value, TRACE);
});
