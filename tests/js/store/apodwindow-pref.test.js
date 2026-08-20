// The apodizing strip's time-window preference as it is read back at load — a
// browser that already holds a persisted choice under hqptuner.apodWindow.
//
// Own process on purpose, and one case only (tests/js/store/plainnames-pref.test.js
// is the pattern): the module reads storage once at import, so anything that
// writes the same key afterwards would decide what a later case in the same file
// sees. The setter cases live in tests/js/store/apodwindow-set.test.js and the
// other two storage shapes in the -unset and -junk files.
//
// The working fake localStorage is installed and PRE-SEEDED BEFORE prefs.js is
// imported, so the module's load-time read is the one that meets it. No other
// module in this file may pull prefs.js in first. Nothing of HQPTuner's is
// stubbed.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/apodwindow-pref.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const storage = useStorage();
storage.setItem("hqptuner.apodWindow", "300");

const prefs = await import("../../../hqptuner/static/store/prefs.js");

test("test_a_persisted_window_loads_as_that_window", () => {
  assert.equal(prefs.apodWindow.value, "300");
});
