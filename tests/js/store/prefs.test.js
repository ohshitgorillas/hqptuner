// Behavioral suite for store/ui/prefs.js — the localStorage-persisted UI prefs:
// the storage-disabled warn contract, the absent fast-volume opt-in, and
// the two derived visibility computeds.
//
// The environment is the seam here: this process has no localStorage (plain
// node), which IS the storage-disabled case — nothing about our code is
// stubbed. console.warn is captured around the module's import (the module
// warns at load, when the first read fails), so prefs.js must be imported
// dynamically AFTER the capture is installed; no other module in this file may
// pull it in first. Where a test needs working storage, a fake localStorage is
// installed and removed again after every test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/prefs.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { dropStorage } from "../support/storage.js";

/** @type {string[]} */
const warns = [];
const realWarn = console.warn;
console.warn = (msg) => warns.push(String(msg));
const prefs = await import("../../../hqptuner/static/store/ui/prefs.js");
console.warn = realWarn;

afterEach(dropStorage);

// --- the storage-disabled warn contract -----------------------------------------

test("test_loading_without_storage_warns_exactly_once", () => {
  // several prefs were read at import; one warning, not one per pref
  assert.equal(warns.length, 1);
});

// A second case matched the warning's own wording. That exactly one warning is emitted is the
// whole of the contract.

test("test_a_setter_does_not_repeat_the_warning", () => {
  console.warn = (msg) => warns.push(String(msg));
  prefs.setPlainNames(true);
  console.warn = realWarn;
  assert.equal(warns.length, 1);
});

// --- the absent fast-volume opt-in -----------------------------------------------------

// The store keeps no fast-volume opt-in: no preference, no key to persist it
// under, and nothing for a caller to read. Membership rather than a property
// read: naming an absent export directly is a type error, and the question here
// is exactly whether the name is there.

test("test_the_store_offers_no_fast_volume_preference", () => {
  assert.equal("fastVolumeUpdates" in prefs, false);
});

test("test_the_store_offers_no_fast_volume_setter", () => {
  assert.equal("setFastVolumeUpdates" in prefs, false);
});

// --- the derived visibility flags ------------------------------------------------------
