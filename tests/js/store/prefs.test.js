// Behavioral suite for store/prefs.js — the localStorage-persisted UI prefs:
// the storage-disabled warn contract, the quick/fast poll opt-in setters, and
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
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/prefs.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { useStorage, dropStorage } from "../support/storage.js";

/** @type {string[]} */
const warns = [];
const realWarn = console.warn;
console.warn = (msg) => warns.push(String(msg));
const prefs = await import("../../../hqptuner/static/store/prefs.js");
console.warn = realWarn;

afterEach(dropStorage);

// --- the storage-disabled warn contract -----------------------------------------

test("test_loading_without_storage_warns_exactly_once", () => {
  // four prefs were read at import; one warning, not four
  assert.equal(warns.length, 1);
});

test("test_the_warning_says_prefs_will_not_persist", () => {
  assert.match(warns[0], /not persisted/);
});

test("test_a_setter_does_not_repeat_the_warning", () => {
  console.warn = (msg) => warns.push(String(msg));
  prefs.setShowDescriptions(true);
  console.warn = realWarn;
  assert.equal(warns.length, 1);
});

// --- defaults when storage is unreadable ------------------------------------------

test("test_descriptions_default_on_without_storage", () => {
  assert.equal(prefs.showDescriptions.value, true);
});

test("test_quick_system_updates_default_off_without_storage", () => {
  assert.equal(prefs.quickSystemUpdates.value, false);
});

// --- the quick/fast setters ----------------------------------------------------------

test("test_the_quick_setter_keeps_its_value_when_storage_is_disabled", () => {
  prefs.setQuickSystemUpdates(true);
  assert.equal(prefs.quickSystemUpdates.value, true);
});

test("test_the_quick_setter_persists_when_storage_works", () => {
  useStorage();
  prefs.setQuickSystemUpdates(true);
  assert.equal(globalThis.localStorage.getItem("hqptuner.quickSystemUpdates"), "1");
});

test("test_the_fast_volume_setter_persists_off_as_zero", () => {
  useStorage();
  prefs.setFastVolumeUpdates(false);
  assert.equal(globalThis.localStorage.getItem("hqptuner.fastVolumeUpdates"), "0");
});

test("test_the_setters_coerce_truthiness_into_a_boolean", () => {
  // The setter's own parameter is typed `boolean`, and every real caller is a
  // checkbox event — but the daemon's own boolean fields arrive as truthy
  // strings elsewhere in this store, so the setter coerces defensively too.
  prefs.setFastVolumeUpdates("yes");
  assert.equal(prefs.fastVolumeUpdates.value, true);
});

// --- the derived visibility flags ------------------------------------------------------

test("test_option_descriptions_survive_a_hidden_master_when_kept", () => {
  prefs.setShowDescriptions(false);
  prefs.setKeepOptionDescriptions(true);
  assert.equal(prefs.descVisible.value, true);
});

test("test_static_notes_follow_the_master_only", () => {
  prefs.setShowDescriptions(false);
  prefs.setKeepOptionDescriptions(true);
  assert.equal(prefs.notesVisible.value, false);
});
