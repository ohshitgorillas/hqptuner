// Behavioral suite for the mirror in store/sync.js viewed through the signals it
// writes: a push event whose body reads the same as the signal already holds
// leaves the signal unnotified, and one whose body differs moves it once. Every
// event is parsed fresh off the stream, so "the same" is by content, never by
// reference.
//
// The stream is the EventSource fake (tests/js/support/eventsource.js), which
// hands each listener its own parse of the body, the page is the document fake
// (tests/js/support/page.js), and globalThis.fetch answers the metadata prime
// through the static wire fake.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/live/mirror.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { effect } from "@preact/signals";

import { config, volumeRange } from "../../../../hqptuner/static/store/signals.js";
import { startSync } from "../../../../hqptuner/static/store/sync.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { usePage } from "../../support/page.js";
import { staticWire } from "../../support/wire/wire.js";

const CONFIG = { stale: false, loaded_at: 1, data: { fields: [], file: {}, active: "Desk" } };
const VOLUME = { volume: "-20.5", min: -60, max: 0, enabled: true, adaptive: false };

const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setImmediate(resolve));
};

useEventSource();
usePage();
staticWire();
startSync();
await settle();

// --- the notification counters --------------------------------------------------

const runs = { config: 0, volumeRange: 0 };
effect(() => {
  void config.value;
  runs.config += 1;
});
effect(() => {
  void volumeRange.value;
  runs.volumeRange += 1;
});

/**
 * Send `first` and then `second` as `type` events on the open stream, and say how
 * far the counter moved on the second.
 *
 * @param {string} type
 * @param {"config" | "volumeRange"} which
 * @param {unknown} first
 * @param {unknown} second
 */
async function secondEventMoves(type, which, first, second) {
  lastStream()?.emit(type, first);
  await settle();
  const before = runs[which];
  lastStream()?.emit(type, second);
  await settle();
  return runs[which] - before;
}

// --- the config event -----------------------------------------------------------

test("test_an_identical_config_event_leaves_the_config_signal_unnotified", async () => {
  assert.equal(await secondEventMoves("config", "config", CONFIG, CONFIG), 0);
});

test("test_a_changed_config_event_notifies_the_config_signal_once", async () => {
  const next = { ...CONFIG, data: { ...CONFIG.data, active: "Couch" } };
  assert.equal(await secondEventMoves("config", "config", CONFIG, next), 1);
});

// --- the volume event's range ---------------------------------------------------

test("test_an_identical_volume_event_leaves_the_range_signal_unnotified", async () => {
  assert.equal(await secondEventMoves("volume", "volumeRange", VOLUME, VOLUME), 0);
});

test("test_a_changed_volume_event_notifies_the_range_signal_once", async () => {
  assert.equal(await secondEventMoves("volume", "volumeRange", VOLUME, { ...VOLUME, min: -80 }), 1);
});
