// Behavioral suite for store/live/pin.js — the pinned output rate.
//
// `pinnedRate` is the rate the engine is pinned to, in Hz, read off the State
// index joined to the engine's own rate list; 0 is auto. `pinRate(hz)` writes it
// through the LIVE lane, and only while Allow pinned rates
// (store/ui/faceplate.js) is on. Turning that preference off clears a pin that
// is standing.
//
// The engine is driven through the exported `engineState` / `enums`
// signals in the shapes /api/state and /api/enumerations serve, and every write
// goes out over a faked `globalThis.fetch` on the real REST path.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/live/pin.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../../support/storage.js";
import { ok } from "../../support/wire/wire.js";

useStorage();

const { engineState, enums } = await import("../../../../hqptuner/static/store/signals.js");
const { setAllowPinnedRates } = await import("../../../../hqptuner/static/store/ui/faceplate.js");
const { pinnedRate, pinRate } = await import("../../../../hqptuner/static/store/live/pin.js");

/**
 * The globals the fake wire installs a `fetch` on, viewed as an optional member:
 * the DOM lib declares it returning a real `Response`, which this fake does not
 * build.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;

// `<RatesItem index rate/>`, index 0 = auto. Index and Hz never
// coincide, so a reading that skipped the join fails.
const RATES = [
  { index: "0", rate: "0" },
  { index: "1", rate: "96000" },
  { index: "2", rate: "192000" },
];

/** @param {string} rate the State rate index */
const state = (rate) => ({ mode: "1", rate, active_chain: "pcm" });

// A live-lane server: every POST /api/config/live is recorded and answered
// verified, and the re-mirror reads answer the State the case seeded.
/** @param {string} rate */
function wire(rate) {
  const w = { posts: /** @type {unknown[]} */ ([]) };
  env.fetch = async (/** @type {string} */ path, /** @type {{ body?: string }} */ opts = {}) => {
    if (path === "/api/config/live") {
      w.posts.push(JSON.parse(String(opts.body)));
      return ok({ report: { live: [{ setting: "rate", ok: true }], stored: {} } });
    }
    if (path === "/api/state") return ok({ data: state(rate) });
    if (path === "/api/enumerations") return ok({ data: { rates: RATES } });
    return ok({});
  };
  return w;
}

// Let a write the store started on its own run out before the next case.
const drain = () => new Promise((resolve) => setImmediate(resolve));

// The preference is set with the engine unpinned, so setting it sends nothing;
// the engine's pin is seeded after, and the wire installed last starts empty.
/** @param {{ rate?: string, allow?: boolean }} [seed] */
async function reset({ rate = "0", allow = true } = {}) {
  engineState.value = state("0");
  enums.value = { rates: RATES };
  setAllowPinnedRates(allow);
  await drain();
  engineState.value = state(rate);
  return wire(rate);
}

// --- what the engine is pinned to -------------------------------------------------

for (const { index, hz } of [
  { index: "1", hz: 96000 },
  { index: "2", hz: 192000 },
]) {
  test(`test_the_pinned_rate_reads_state_index_${index}_as_its_rate_in_hz`, async () => {
    await reset({ rate: index });
    assert.equal(pinnedRate.value, hz);
  });
}

// --- pinning ----------------------------------------------------------------------

test("test_a_pin_posts_the_rate_in_hz_to_the_live_lane_while_the_opt_in_is_on", async () => {
  const w = await reset();
  await pinRate(192000);
  assert.deepEqual(w.posts, [{ fields: { rate: "192000" } }]);
});

test("test_a_pin_asked_for_while_the_opt_in_is_off_never_reaches_the_lane", async () => {
  const w = await reset({ allow: false });
  await pinRate(96000);
  setAllowPinnedRates(true);
  await pinRate(192000);
  assert.deepEqual(w.posts, [{ fields: { rate: "192000" } }]);
});

// --- turning the opt-in off ---------------------------------------------------------

test("test_turning_the_opt_in_off_clears_a_standing_pin", async () => {
  const w = await reset({ rate: "2" });
  setAllowPinnedRates(false);
  await drain();
  assert.deepEqual(w.posts, [{ fields: { rate: "0" } }]);
});

test("test_turning_the_opt_in_off_with_no_pin_standing_sends_nothing", async () => {
  const w = await reset();
  setAllowPinnedRates(false);
  await drain();
  assert.deepEqual(w.posts, []);
});
