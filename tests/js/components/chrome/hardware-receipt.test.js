// Behavioral suite for which of the Hardware acceleration card's status messages
// expire on their own (components/system/SystemHardware.js, `receiptExpires`). A
// confirmed apply is a receipt and expires; every other outcome carries something
// the user has to act on, or is still under way, and stays.
//
// The outcome kinds are the state-bearing class tokens the status line carries
// beside `hw-status`, so they are contract (docs/testing.md rule 9). How long a
// receipt lasts is a design choice and is not pinned (rule 11); the timer itself
// is pinned in tests/js/lib/expiry.test.js.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/chrome/hardware-receipt.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { receiptExpires } from "../../../../hqptuner/static/components/system/SystemHardware.js";

//: Every outcome but a confirmed apply, the empty one included.
const STAYS = /** @type {const} */ (["", "busy", "warn", "err"]);

test("test_a_confirmed_applys_receipt_expires", () => {
  assert.equal(receiptExpires("ok"), true);
});

for (const kind of STAYS) {
  test(`test_a_${kind || "blank"}_status_stays_where_a_receipt_expires`, () => {
    assert.notEqual(receiptExpires(kind), receiptExpires("ok"));
  });
}
