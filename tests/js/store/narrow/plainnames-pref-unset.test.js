// The "Option style" preference when localStorage is PRESENT but holds no
// hqptuner.plainNames key at all — a browser that has never seen the switch.
// The load-time read writes nothing back.
//
// Own process on purpose: the module reads storage once at import, so each
// storage shape needs a file of its own. The working fake is installed BEFORE
// prefs.js is imported and nothing seeds it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/narrow/plainnames-pref-unset.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../../support/storage.js";

const storage = useStorage();

await import("../../../../hqptuner/static/store/ui/prefs.js");

test("test_the_load_time_read_writes_no_key_back", () => {
  assert.equal(storage.getItem("hqptuner.plainNames"), null);
});
