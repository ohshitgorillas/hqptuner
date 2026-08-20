// The apodizing strip's time-window preference against a stored value that is
// not one of the five the store offers — a key left behind by an older build,
// or one edited by hand. It reads as the "60" default rather than reaching the
// strip.
//
// The seeded value is "600": well formed, plausible as a window, and rejected
// only by a membership check against APOD_WINDOWS — a value like "banana" would
// also be turned away by any incidental number parse, and would pin nothing.
//
// Own process on purpose (tests/js/store/apodwindow-pref.test.js pins the
// well-formed seeding): the module reads storage once at import, so each storage
// shape needs a file of its own. The working fake is installed and seeded with
// the bad value BEFORE prefs.js is imported.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/apodwindow-pref-junk.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const storage = useStorage();
storage.setItem("hqptuner.apodWindow", "600");

const prefs = await import("../../../hqptuner/static/store/prefs.js");

test("test_a_window_the_store_does_not_offer_loads_the_default_window", () => {
  assert.equal(prefs.apodWindow.value, "60");
});
