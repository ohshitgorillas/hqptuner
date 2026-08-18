// Behavioral suite for the persistence half of the LIVE page's block order —
// store/prefs.js's `liveOrder` / `setLiveOrder` / `commitLiveOrder` as
// components/live/Layout.js's `setLiveEditing` drives them.
//
// The contract has two halves. On the way out: leaving layout-edit mode is what
// persists the arrangement, and entering it persists nothing, so a user who
// opens the edit mode and closes the tab keeps the order they had. On the way
// in: whatever the browser has stored is the order the page comes up in, and a
// stored value that is not an order at all costs the user their arrangement and
// nothing else. What renders for a given order is
// tests/js/components/liveblocks.test.js.
//
// The environment is the seam: prefs.js reads its keys once, when the module is
// first imported, so the fake storage is installed at file scope, SEEDED, and
// only then is the module pulled in. No other module in this file may import
// prefs.js first, and the storage stands for the whole file rather than being
// dropped between cases. The load-time value is captured the moment the module
// arrives, so the case asserting on it does not depend on running first.
//
// The junk cases need a module that has not read anything yet, so they load a
// second instance under a `.fresh-<tag>.js` specifier, which
// tests/js/support/vendor-resolve.js resolves to prefs.js's own source under a
// URL node has not cached. The specifier is built rather than written literally
// because it names a file that is not on disk, which `tsc -p jsconfig.json`
// refuses as a literal (TS2307).
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

const PREFS_MODULE = "../../../hqptuner/static/store/prefs.js";

// What this browser had stored before the page ever loaded.
const STORED = ["chains", "matrix", "hero", "playback", "health"];

const storage = useStorage();
storage.setItem(KEY, JSON.stringify(STORED));

const prefs = await import(PREFS_MODULE);
const layout = await import("../../../hqptuner/static/components/live/Layout.js");

// Captured before any case can write it: this is the order the module came up
// with, having read the seeded storage.
const AT_LOAD = [...prefs.liveOrder.value];
const DEFAULT = [...prefs.LIVE_BLOCK_ORDER];

/** @param {string} tag @param {string} junk */
async function loadedWith(tag, junk) {
  storage.setItem(KEY, junk);
  const fresh = await import(`${PREFS_MODULE.replace(/\.js$/, `.fresh-${tag}.js`)}`);
  return [...fresh.liveOrder.value];
}

const ORDER = ["matrix", "hero", "health", "chains", "playback"];

// --- what the browser had stored is what the page comes up in ---------------------

test("test_an_order_stored_in_the_browser_is_the_order_the_page_loads_with", () => {
  assert.deepEqual(AT_LOAD, STORED);
});

test("test_a_stored_value_that_is_not_json_loads_the_default_order", async () => {
  assert.deepEqual(await loadedWith("notjson", "{not json at all"), DEFAULT);
});

test("test_a_stored_value_that_is_not_a_list_of_keys_loads_the_default_order", async () => {
  assert.deepEqual(await loadedWith("notkeys", JSON.stringify([1, 2, 3])), DEFAULT);
});

// --- and leaving layout-edit mode is what stores it -------------------------------

// The key is cleared once edit mode is ON, so only the LEAVE can have written
// what the assertion reads: an implementation that persisted eagerly on
// `setLiveOrder` and did nothing on the way out is red here.
test("test_leaving_layout_edit_mode_stores_the_current_block_order", () => {
  prefs.setLiveOrder(ORDER);
  layout.setLiveEditing(true);
  storage.removeItem(KEY);
  layout.setLiveEditing(false);
  assert.deepEqual(JSON.parse(String(storage.getItem(KEY))), ORDER);
});

test("test_entering_layout_edit_mode_stores_nothing", () => {
  prefs.setLiveOrder(ORDER);
  storage.removeItem(KEY);
  layout.setLiveEditing(true);
  assert.equal(storage.getItem(KEY), null);
});
