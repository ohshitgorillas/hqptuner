// Behavioral suite for the mirror in store/sync.js viewed through the signals it
// writes: a poll whose answer reads the same as the signal already holds leaves
// the signal unnotified, and one whose answer differs moves it. Every poll parses
// a fresh object off the wire, so "the same" is by content, never by reference;
// the fake wire here answers each request with its own parse to match.
//
// Fakes go at the wire and the environment seams only (docs/testing.md rule 4):
// globalThis.fetch answers the real REST paths with real shapes, and
// globalThis.setInterval/clearInterval are captured the way pollgate.test.js
// captures them, keeping the callback so a case can drive one fast tick. Nothing
// waits on the wall clock and no scheduled callback ever fires by itself.
//
// The timer fakes are installed for the life of this file, deliberately:
// startPolling registers a reactive effect it never disposes, so restoring the
// real setInterval mid-file would let that leak schedule a real repeating poll.
// Files run in their own child process, so nothing escapes.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/live/mirror.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { effect } from "@preact/signals";

import { config, volumeRange } from "../../../../hqptuner/static/store/signals.js";
import { startPolling, refreshConfig } from "../../../../hqptuner/static/store/sync.js";
import { activeTab } from "../../../../hqptuner/static/store/ui/ui.js";
import { quickSystemUpdates, liveMode } from "../../../../hqptuner/static/store/ui/prefs.js";

const INTERVAL = 2000;

// --- the timer seam, faked for the file's life (see header) -------------------

/** @typedef {{ id: number, ms: number, fn: () => unknown }} Registration */

/** @type {Registration[]} */
const intervals = [];
let nextId = 1;

/**
 * The globals these fakes install over, viewed as optional members: the DOM
 * lib's signatures do not match these simplified fakes.
 *
 * @type {{ setInterval?: unknown, clearInterval?: unknown, fetch?: unknown }}
 */
const env = globalThis;
env.setInterval = (/** @type {() => unknown} */ fn, /** @type {number} */ ms) => {
  const id = nextId++;
  intervals.push({ id, ms, fn });
  return id;
};
env.clearInterval = () => {};

// --- the wire -----------------------------------------------------------------

/** @type {Record<string, unknown>} */
const BODIES = {
  "GET /api/health": { reachable: true, ready: true, alarm: false, unreachable_since: null, info: {} },
  "GET /api/state": { stale: false, data: { adaptive: "0" } },
  "GET /api/status": { stale: false, data: { status: {} } },
  "GET /api/volume": { volume: "-20.5", min: -60, max: 0, enabled: true, adaptive: false },
  "GET /api/metadata": { filters: [] },
  "GET /api/enumerations": { data: null },
  "GET /api/config": { data: { fields: [], file: {}, active: "Desk" } },
  "GET /api/matrix": { data: { fields: [] } },
  "GET /api/config/pending": { live: {}, http: {} },
};

/** @type {Record<string, unknown>} */
let answers = { ...BODIES };

// Each response parses its own copy of the body, the way a real fetch does.
env.fetch = async (/** @type {string} */ path, /** @type {{ method?: string }} */ opts = {}) => {
  const body = answers[`${opts.method || "GET"} ${path}`] ?? {};
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
};

// The fake wire resolves in microtasks only, so a handful of macrotask turns
// drains the whole await chain — event-loop turns, never a duration
// (docs/testing.md rule 7).
const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setImmediate(resolve));
};

// --- one registration for the whole file ---------------------------------------

activeTab.value = "output";
quickSystemUpdates.value = false;
liveMode.value = false;
startPolling(INTERVAL);
await settle();

/** The fast lane's live timer callback: the last one registered at the fast cadence. */
async function fastTick() {
  const reg = intervals.filter((entry) => entry.ms === INTERVAL).at(-1);
  if (reg === undefined) throw new Error(`no interval registered at ${INTERVAL} ms`);
  await reg.fn();
  await settle();
}

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
 * Run `poll` twice over the same answer and say how far the counter moved on
 * the second run.
 *
 * @param {() => Promise<unknown>} poll
 * @param {"config" | "volumeRange"} which
 */
async function secondRunMoves(poll, which) {
  await poll();
  const before = runs[which];
  await poll();
  return runs[which] - before;
}

/**
 * Run `poll` once over `body` at `key`, and say how far the counter moved.
 *
 * @param {() => Promise<unknown>} poll
 * @param {"config" | "volumeRange"} which
 * @param {string} key
 * @param {unknown} body
 */
async function changedRunMoves(poll, which, key, body) {
  await poll();
  const before = runs[which];
  answers = { ...answers, [key]: body };
  await poll();
  return runs[which] - before;
}

// --- the config poll ------------------------------------------------------------

test("test_an_identical_config_poll_leaves_the_config_signal_unnotified", async () => {
  answers = { ...BODIES };
  assert.equal(await secondRunMoves(refreshConfig, "config"), 0);
});

test("test_a_changed_config_poll_notifies_the_config_signal", async () => {
  answers = { ...BODIES };
  const body = { data: { fields: [], file: {}, active: "Couch" } };
  assert.equal(await changedRunMoves(refreshConfig, "config", "GET /api/config", body), 1);
});

// --- the fast tick's volume range -------------------------------------------------

test("test_an_identical_volume_poll_leaves_the_range_signal_unnotified", async () => {
  answers = { ...BODIES };
  assert.equal(await secondRunMoves(fastTick, "volumeRange"), 0);
});

test("test_a_changed_volume_poll_notifies_the_range_signal", async () => {
  answers = { ...BODIES };
  const body = { volume: "-20.5", min: -80, max: 0, enabled: true, adaptive: false };
  assert.equal(await changedRunMoves(fastTick, "volumeRange", "GET /api/volume", body), 1);
});
