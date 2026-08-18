// Behavioral suite for the persistence half of the LIVE page's block order —
// store/prefs.js's `liveOrder` / `setLiveOrder` / `commitLiveOrder` as
// components/live/Layout.js's `setLiveEditing` drives them.
//
// The contract is when the order reaches the browser, not how it is dragged:
// leaving layout-edit mode is what persists the arrangement, and entering it
// persists nothing, so a user who opens the edit mode and closes the tab keeps
// the order they had. What renders for a given order is
// tests/js/components/liveblocks.test.js.
//
// The environment is the seam: prefs.js reads its keys once, when the module is
// first imported, so the fake storage is installed at file scope and both
// modules are pulled in dynamically after it. No other module in this file may
// import prefs.js first, and the storage stands for the whole file rather than
// being dropped between cases.
//
// The storage key is named here because it IS the contract a persisted
// preference makes with the browser: a rename drops every user's saved layout
// on the floor. The stored value is read back through JSON.parse, so the
// formatting of the array is the writer's business and only its contents are
// pinned.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/liveorder.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

const KEY = "hqptuner.liveOrder";

const storage = useStorage();

const prefs = await import("../../../hqptuner/static/store/prefs.js");
const layout = await import("../../../hqptuner/static/components/live/Layout.js");

const ORDER = ["matrix", "hero", "health", "chains", "playback"];

test("test_leaving_layout_edit_mode_stores_the_current_block_order", () => {
  prefs.setLiveOrder(ORDER);
  layout.setLiveEditing(true);
  layout.setLiveEditing(false);
  assert.deepEqual(JSON.parse(String(storage.getItem(KEY))), ORDER);
});

test("test_entering_layout_edit_mode_stores_nothing", () => {
  prefs.setLiveOrder(ORDER);
  storage.removeItem(KEY);
  layout.setLiveEditing(true);
  assert.equal(storage.getItem(KEY), null);
});
