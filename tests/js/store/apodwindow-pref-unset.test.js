// The apodizing strip's time-window preference when localStorage is PRESENT but
// holds no hqptuner.apodWindow key at all — a browser that has never seen the
// control. The window loads at its "60" default.
//
// Own process on purpose (tests/js/store/apodwindow-pref.test.js pins the
// seeded shape, -junk the unusable one): the module reads storage once at
// import, so each storage shape needs a file of its own. The working fake is
// installed BEFORE prefs.js is imported and nothing seeds it.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/apodwindow-pref-unset.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const prefs = await import("../../../hqptuner/static/store/prefs.js");

test("test_storage_present_but_the_key_unset_loads_the_default_window", () => {
  assert.equal(prefs.apodWindow.value, "60");
});
