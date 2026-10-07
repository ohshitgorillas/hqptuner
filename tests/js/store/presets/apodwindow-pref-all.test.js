// The apodizing strip's time-window preference against a stored "all": the window list is capped at 300 s, the
// spectrogram's history, so a stored "all" reads as the "60" default.
//
// Own process on purpose: the module reads storage once at import, so each storage shape needs a file of its own. The
// working fake is installed and seeded BEFORE prefs.js is imported.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/presets/apodwindow-pref-all.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../../support/storage.js";

const storage = useStorage();
storage.setItem("hqptuner.apodWindow", "all");

const prefs = await import("../../../../hqptuner/static/store/ui/prefs.js");

test("test_a_stored_all_window_loads_the_default_window", () => {
  assert.equal(prefs.apodWindow.value, "60");
});
