// The "Option style" preference when localStorage is PRESENT but holds no
// hqptuner.plainNames key at all — a browser that has never seen the switch.
// The pref loads as Standard (off), and the load-time read writes nothing back.
//
// Own process on purpose (tests/js/store/plainnames-pref.test.js pins the
// pre-seeded storage; tests/js/components/combobox-plainnames.test.js pins the
// no-storage-at-all environment): the module reads storage once at import, so
// each storage shape needs a file of its own. The working fake is installed
// BEFORE prefs.js is imported and nothing seeds it.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/plainnames-pref-unset.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const storage = useStorage();

const prefs = await import("../../../hqptuner/static/store/prefs.js");

test("test_storage_present_but_key_unset_loads_as_standard", () => {
  assert.equal(prefs.plainNames.value, false);
});

test("test_the_load_time_read_writes_no_key_back", () => {
  assert.equal(storage.getItem("hqptuner.plainNames"), null);
});
