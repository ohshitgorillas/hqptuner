// Behavioral suite for lib/keepedits.js: when a reading lands, a setting the user
// moved while it was out keeps the user's value, and every other setting takes
// the reported one.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/keepedits.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { keepEdits } from "../../../hqptuner/static/lib/keepedits.js";

//: The settings as they stood when the read went out, as they stand when it
//: lands (the user moved `nblocks` in between), and as the read reported them.
const BEFORE = { cuda: "0", nblocks: "0" };
const NOW = { cuda: "0", nblocks: "8" };
const REPORTED = { cuda: "1", nblocks: "16" };

test("a setting nobody moved while the read was out takes the reported value", () => {
  assert.equal(keepEdits(BEFORE, NOW, REPORTED).cuda, "1");
});

test("a setting the user moved while the read was out keeps the user's value", () => {
  assert.equal(keepEdits(BEFORE, NOW, REPORTED).nblocks, "8");
});
