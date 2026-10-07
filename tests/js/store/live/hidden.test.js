// Behavioral suite for the poll ticks in store/sync.js over a page the browser
// has hidden: neither timer asks the wire for anything while `document.hidden`
// is true, and the page coming back takes one fast reading and one config
// reading at once rather than waiting out the next tick.
//
// Fakes go at the wire and the environment seams only (docs/testing.md rule 4):
// globalThis.fetch answers the real REST paths with real shapes, the interval
// fake keeps each callback so a case drives exactly one tick, and a minimal
// document carries a writable `hidden` flag and keeps its `visibilitychange`
// listeners so a case can fire them. Nothing here waits on the wall clock and
// no scheduled callback ever fires by itself.
//
// The fakes stay installed for the life of this file, as in pollgate.test.js:
// startPolling registers a reactive effect it never disposes.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/live/hidden.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { health } from "../../../../hqptuner/static/store/signals.js";
import { startPolling } from "../../../../hqptuner/static/store/sync.js";
import { activeTab } from "../../../../hqptuner/static/store/ui/ui.js";
import { quickSystemUpdates, liveMode } from "../../../../hqptuner/static/store/ui/prefs.js";
import { ok } from "../../support/wire/wire.js";

const FAST_MS = 2000;
const CONFIG_MS = FAST_MS * 2;

/**
 * The globals these fakes install over, viewed as optional members: the DOM
 * lib's signatures do not match these simplified fakes, and under `node --test`
 * there is no document at all.
 *
 * @type {{ setInterval?: unknown, clearInterval?: unknown, fetch?: unknown, document?: unknown }}
 */
const env = globalThis;

// --- the timer seam: the last callback registered at each cadence -------------

/** @type {Map<number, () => unknown>} */
const timers = new Map();
env.setInterval = (/** @type {() => unknown} */ fn, /** @type {number} */ ms) => {
  timers.set(ms, fn);
  return timers.size;
};
env.clearInterval = () => {};

// --- the document seam -----------------------------------------------------------

/** @type {Set<() => unknown>} */
const onVisibility = new Set();
const page = {
  hidden: false,
  addEventListener(/** @type {string} */ type, /** @type {() => unknown} */ fn) {
    if (type === "visibilitychange") onVisibility.add(fn);
  },
  removeEventListener(/** @type {string} */ type, /** @type {() => unknown} */ fn) {
    if (type === "visibilitychange") onVisibility.delete(fn);
  },
};
env.document = page;

// --- the wire ------------------------------------------------------------------

/** @type {string[]} */
const asked = [];
let ready = true;

const healthFrame = () => ({
  reachable: true,
  ready,
  credentials_ok: ready,
  alarm: false,
  unreachable_since: null,
  info: {},
});

/** @type {Record<string, () => unknown>} */
const ANSWERS = {
  "/api/health": healthFrame,
  "/api/metadata": () => ({ filters: [] }),
  "/api/state": () => ({ stale: false, data: { adaptive: "0" } }),
  "/api/status": () => ({ stale: false, data: { status: {} } }),
  "/api/volume": () => ({ volume: "-20.5", min: -60, max: 0, enabled: true, adaptive: false }),
  "/api/enumerations": () => ({ data: null }),
  "/api/config": () => ({ data: { fields: [], file: {}, active: "" } }),
  "/api/matrix": () => ({ data: { fields: [] } }),
  "/api/config/pending": () => ({ live: {}, http: {} }),
};

env.fetch = async (/** @type {string} */ path) => {
  asked.push(path);
  const answer = ANSWERS[path];
  return ok(answer ? answer() : {});
};

// Event-loop turns, never a duration (docs/testing.md rule 7): the fake wire
// resolves in microtasks, so a few macrotask turns drain every await chain.
async function drain() {
  for (let n = 0; n < 10; n += 1) await new Promise((done) => setImmediate(done));
}

activeTab.value = "output";
quickSystemUpdates.value = false;
liveMode.value = false;
startPolling(FAST_MS);
await drain();

/**
 * Put the page in the given visibility over a health reading at the given
 * readiness, then run `act` and answer with every path it asked the wire for.
 *
 * @param {{ hidden: boolean, ready: boolean }} at
 * @param {() => unknown} act
 * @returns {Promise<string[]>}
 */
async function askedDuring(at, act) {
  ready = at.ready;
  health.value = healthFrame();
  page.hidden = at.hidden;
  await drain();
  asked.length = 0;
  await act();
  await drain();
  return [...asked];
}

/**
 * Drive one tick of the timer registered at `ms`.
 *
 * @param {number} ms
 * @returns {() => unknown}
 */
const tickOf = (ms) => () => {
  const fn = timers.get(ms);
  if (fn === undefined) throw new Error(`no interval registered at ${ms} ms`);
  return fn();
};

// The browser flips `hidden` before it dispatches the event.
const fireVisibility = () => Promise.all([...onVisibility].map((fn) => fn()));

/**
 * How many times each of /api/status and /api/config was asked for.
 *
 * @param {string[]} paths
 */
const statusAndConfig = (paths) => ({
  status: paths.filter((p) => p === "/api/status").length,
  config: paths.filter((p) => p === "/api/config").length,
});

test("test_a_fast_tick_while_the_page_is_hidden_asks_the_wire_for_nothing", async () => {
  const paths = await askedDuring({ hidden: true, ready: true }, tickOf(FAST_MS));
  assert.deepEqual(paths, []);
});

test("test_a_config_tick_while_the_page_is_hidden_asks_the_wire_for_nothing", async () => {
  const paths = await askedDuring({ hidden: true, ready: true }, tickOf(CONFIG_MS));
  assert.deepEqual(paths, []);
});

test("test_a_fast_tick_while_the_page_is_visible_still_asks_for_status", async () => {
  const paths = await askedDuring({ hidden: false, ready: true }, tickOf(FAST_MS));
  assert.ok(paths.includes("/api/status"));
});

// `ready` is the config timer's own gate, so the return reading honours it too:
// held reachable across both cases, only `ready` accounts for the difference.
const RETURNS = [
  { ready: true, counts: { status: 1, config: 1 } },
  { ready: false, counts: { status: 1, config: 0 } },
];

for (const c of RETURNS) {
  test(`test_the_page_coming_back_asks_status_once_and_config_once_only_over_a_ready_daemon: ready=${c.ready}`, async () => {
    const paths = await askedDuring({ hidden: false, ready: c.ready }, fireVisibility);
    assert.deepEqual(statusAndConfig(paths), c.counts);
  });
}

test("test_a_visibilitychange_that_leaves_the_page_hidden_asks_the_wire_for_nothing", async () => {
  const paths = await askedDuring({ hidden: true, ready: true }, fireVisibility);
  assert.deepEqual(paths, []);
});
