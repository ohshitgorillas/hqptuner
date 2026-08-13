// Behavioral suite for the PERSISTENCE half of filter narrowing
// (store/narrowing.js): the facets the narrow bar is set to, kept on the SERVER
// so a reload finds the bar the way the user left it. Which filters a facet
// then hides is narrowing.test.js's subject, not this file's.
//
// Persistence is one REST pair, GET/PUT /api/narrowing, both sides carrying
// `{facets: {...}}`, driven through the fetch fake below: it speaks that path
// with those shapes and HOLDS the facet map the way the backend's store does
// (docs/testing.md rule 4 — real path, real shapes, nothing of ours stubbed).
// No daemon is behind it; narrowing is HQPTuner's own presentational state
// (docs/architecture.md, "Filter narrowing").
//
// Writing is coalesce-then-flush. The debounce window is not a behaviour to
// test on a clock (rule 7), so every case that sends drives the write through
// `flushNarrowing()`, the way descriptions.test.js drives `flushDescriptions`.
//
// `reset()` puts every piece of module state a case touches back: the eleven
// facet signals, the error line, and the private "changed since the last write"
// mark, which it clears the only way a caller can — one flush against a
// throwaway wire, sent BEFORE the case's own wire is installed so that drain
// lands nowhere the case can see. Without it a case passes only behind
// whichever case last drained.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/narrowing-persist.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { ok, bad } from "../support/wire.js";
import { settle } from "../support/livepresetwire.js";
import {
  nGenre,
  nQuality,
  nFocus,
  nPhase,
  nLength,
  nRatio,
  nUpsampleOnly,
  nApod1x,
  nApodNx,
  nHires1x,
  nHiresNx,
  narrowingError,
  resetNarrowing,
  hydrateNarrowing,
  flushNarrowing,
} from "../../../hqptuner/static/store/narrowing.js";

const PATH = "/api/narrowing";

/**
 * The global the fetch fake is installed on, viewed as an optional member: the
 * DOM lib declares `fetch` returning a real `Response`, which this fake does
 * not build.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;

/** @typedef {Record<string, unknown>} Facets */

/**
 * @typedef {{
 *   calls: { path: string, method: string, body?: string }[],
 *   facets: Facets,
 *   hold: boolean,
 *   release: () => void,
 * }} NarrowingWire
 */

/** The eleven facets at their documented defaults — the contract table. */
/** @type {Facets} */
const DEFAULTS = {
  genre: [],
  quality: 0,
  focus: [],
  phase: "",
  length: "",
  ratio: "",
  upsample_only: false,
  apod_1x: "only",
  apod_nx: "all",
  hires_1x: "hide",
  hires_nx: "all",
};

/** One in-domain value per facet, each different from that facet's default. */
/** @type {Facets} */
const SET = {
  genre: ["rock"],
  quality: 4,
  focus: ["timbre"],
  phase: "linear",
  length: "long",
  ratio: "2x",
  upsample_only: true,
  apod_1x: "all",
  apod_nx: "only",
  hires_1x: "show",
  hires_nx: "only",
};

/** The wire key of each facet, against the signal that carries it. */
/** @type {Record<string, { value: unknown }>} */
const SIGNALS = {
  genre: nGenre,
  quality: nQuality,
  focus: nFocus,
  phase: nPhase,
  length: nLength,
  ratio: nRatio,
  upsample_only: nUpsampleOnly,
  apod_1x: nApod1x,
  apod_nx: nApodNx,
  hires_1x: nHires1x,
  hires_nx: nHiresNx,
};

/**
 * The PUT bodies the wire was handed, newest last, each as its `facets` member.
 *
 * @param {NarrowingWire} w
 * @returns {Facets[]}
 */
const puts = (w) =>
  w.calls.filter((c) => c.path === PATH && c.method === "PUT").map((c) => JSON.parse(String(c.body)).facets);

/**
 * A fake of the server side of the pair: it holds the facet map, replaces the
 * whole map on a PUT, and answers `{facets}` either way — which is what the
 * real routes do. `hold` parks every answer until `release()`, which is how a
 * case observes what the client did BEFORE its request came back without
 * waiting on a clock.
 *
 * @param {{ facets?: Facets, getStatus?: number, getDetail?: string, putStatus?: number, putDetail?: string }} [cfg]
 * @returns {NarrowingWire}
 */
function narrowingWire(cfg = {}) {
  /** @type {(() => void)[]} */
  let parked = [];
  /** @type {NarrowingWire} */
  const w = {
    calls: [],
    facets: { ...DEFAULTS, ...(cfg.facets || {}) },
    hold: false,
    release: () => {
      const waiting = parked;
      parked = [];
      for (const resume of waiting) resume();
    },
  };
  const getStatus = cfg.getStatus || 200;
  const putStatus = cfg.putStatus || 200;
  env.fetch = async (/** @type {string} */ path, /** @type {{method?: string, body?: string}} */ opts = {}) => {
    const method = opts.method || "GET";
    w.calls.push({ path, method, body: opts.body });
    if (path !== PATH) return ok({});
    if (w.hold) await new Promise((resolve) => parked.push(() => resolve(undefined)));
    if (method !== "PUT") {
      if (getStatus !== 200) return bad(getStatus, cfg.getDetail);
      return ok({ facets: w.facets });
    }
    if (putStatus !== 200) return bad(putStatus, cfg.putDetail);
    w.facets = { ...DEFAULTS, ...JSON.parse(String(opts.body)).facets };
    return ok({ facets: w.facets });
  };
  return w;
}

/**
 * Put the module back to a stated starting state: every facet at its default,
 * nothing outstanding to write, no error line, and the case's own wire
 * installed.
 *
 * @param {{ facets?: Facets, getStatus?: number, getDetail?: string, putStatus?: number, putDetail?: string }} [cfg]
 * @returns {Promise<NarrowingWire>}
 */
async function reset(cfg = {}) {
  narrowingWire();
  resetNarrowing();
  await flushNarrowing();
  const w = narrowingWire(cfg);
  narrowingError.value = "";
  return w;
}

// --- hydration ----------------------------------------------------------------

for (const key of Object.keys(SIGNALS)) {
  test(`test_hydration_fills_the_${key}_facet_from_the_server`, async () => {
    await reset({ facets: SET });
    await hydrateNarrowing();
    assert.deepEqual(SIGNALS[key].value, SET[key]);
  });
}

test("test_hydration_leaves_a_facet_the_server_omits_at_its_default", async () => {
  await reset();
  env.fetch = async (/** @type {string} */ path) => (path === PATH ? ok({ facets: { quality: 4 } }) : ok({}));
  await hydrateNarrowing();
  assert.equal(nPhase.value, "");
});

test("test_hydration_fills_the_facet_the_server_did_send_when_it_omits_the_rest", async () => {
  await reset();
  env.fetch = async (/** @type {string} */ path) => (path === PATH ? ok({ facets: { quality: 4 } }) : ok({}));
  await hydrateNarrowing();
  assert.equal(nQuality.value, 4);
});

test("test_hydration_writes_nothing_back", async () => {
  const w = await reset({ facets: SET });
  await hydrateNarrowing();
  assert.deepEqual(puts(w), []);
});

// --- a hydration the server refused ---------------------------------------------

// The facet is set away from its default first, so this tells "left alone"
// apart from "wiped back to the defaults" — after `reset()` both look alike.
test("test_a_failed_hydration_leaves_a_facet_at_the_value_it_already_held", async () => {
  await reset({ getStatus: 503, getDetail: "Narrowing is unavailable." });
  nPhase.value = "minimum";
  await hydrateNarrowing();
  assert.equal(nPhase.value, "minimum");
});

test("test_a_failed_hydration_reports_the_sentence_the_server_sent", async () => {
  await reset({ getStatus: 503, getDetail: "Narrowing is unavailable." });
  await hydrateNarrowing();
  assert.equal(narrowingError.value, "Narrowing is unavailable.");
});

test("test_a_failed_hydration_does_not_throw", async () => {
  await reset({ getStatus: 503, getDetail: "Narrowing is unavailable." });
  await assert.doesNotReject(() => hydrateNarrowing());
});

// A facet the user has already touched is theirs: the answer that was in flight
// while they toggled describes the page before the toggle, and must not undo it.
test("test_a_facet_changed_while_the_hydration_was_in_flight_survives_it", async () => {
  const w = await reset({ facets: SET });
  w.hold = true;
  const pending = hydrateNarrowing();
  await settle();
  nQuality.value = 5;
  w.release();
  await pending;
  assert.equal(nQuality.value, 5);
});

// --- what a flush sends -----------------------------------------------------------

test("test_one_changed_facet_flushes_as_exactly_one_put", async () => {
  const w = await reset();
  await hydrateNarrowing();
  nPhase.value = "minimum";
  await flushNarrowing();
  assert.equal(puts(w).length, 1);
});

test("test_a_flush_sends_all_eleven_facets", async () => {
  const w = await reset();
  await hydrateNarrowing();
  nPhase.value = "minimum";
  await flushNarrowing();
  assert.deepEqual(Object.keys(puts(w).at(-1) || {}).sort(), Object.keys(DEFAULTS).sort());
});

test("test_a_flush_sends_the_changed_facet_as_the_user_set_it", async () => {
  const w = await reset();
  await hydrateNarrowing();
  nPhase.value = "minimum";
  await flushNarrowing();
  assert.equal((puts(w).at(-1) || {}).phase, "minimum");
});

test("test_a_flush_sends_a_facet_the_user_did_not_touch_at_the_value_it_holds", async () => {
  const w = await reset({ facets: SET });
  await hydrateNarrowing();
  nPhase.value = "minimum";
  await flushNarrowing();
  assert.equal((puts(w).at(-1) || {}).length, "long");
});

test("test_three_changed_facets_coalesce_into_one_put", async () => {
  const w = await reset();
  await hydrateNarrowing();
  nPhase.value = "minimum";
  nLength.value = "short";
  nQuality.value = 5;
  await flushNarrowing();
  assert.equal(puts(w).length, 1);
});

test("test_a_flush_with_nothing_changed_sends_nothing", async () => {
  const w = await reset();
  await hydrateNarrowing();
  await flushNarrowing();
  assert.deepEqual(puts(w), []);
});

test("test_a_second_flush_does_not_resend_what_the_first_already_saved", async () => {
  const w = await reset();
  await hydrateNarrowing();
  nPhase.value = "minimum";
  await flushNarrowing();
  await flushNarrowing();
  assert.equal(puts(w).length, 1);
});

// Favorites-only is session state, deliberately not part of this record: a
// browser that had it on must not push it onto every other browser. The
// sentinel stands in for a flush that sent nothing at all, so a client that
// never writes fails here rather than passing on an empty key list.
test("test_the_put_carries_no_favorites_only_key", async () => {
  const w = await reset();
  await hydrateNarrowing();
  nPhase.value = "minimum";
  await flushNarrowing();
  const sent = puts(w).at(-1) || { no_put_was_sent: true };
  assert.deepEqual(
    Object.keys(sent).filter((k) => k.includes("fav") || k === "no_put_was_sent"),
    [],
  );
});

test("test_a_reset_flushes_every_facet_at_its_default", async () => {
  const w = await reset({ facets: SET });
  await hydrateNarrowing();
  nPhase.value = "minimum";
  resetNarrowing();
  await flushNarrowing();
  assert.deepEqual(puts(w).at(-1), DEFAULTS);
});

// --- a write the server refused -----------------------------------------------------
// Unlike favorites, nothing reverts: the facet is presentational, so yanking the
// user's toggle back is worse than a stale file.

test("test_a_failed_write_keeps_the_facet_the_user_set", async () => {
  await reset({ putStatus: 500, putDetail: "State directory is read-only." });
  await hydrateNarrowing();
  nPhase.value = "minimum";
  await flushNarrowing();
  assert.equal(nPhase.value, "minimum");
});

test("test_a_failed_write_reports_the_sentence_the_server_sent", async () => {
  await reset({ putStatus: 500, putDetail: "State directory is read-only." });
  await hydrateNarrowing();
  nPhase.value = "minimum";
  await flushNarrowing();
  assert.equal(narrowingError.value, "State directory is read-only.");
});

test("test_a_write_that_succeeds_after_a_failed_one_clears_the_error", async () => {
  await reset({ putStatus: 500, putDetail: "State directory is read-only." });
  await hydrateNarrowing();
  nPhase.value = "minimum";
  await flushNarrowing();
  narrowingWire();
  nLength.value = "short";
  await flushNarrowing();
  assert.equal(narrowingError.value, "");
});

test("test_a_successful_write_leaves_no_error", async () => {
  await reset();
  await hydrateNarrowing();
  nPhase.value = "minimum";
  await flushNarrowing();
  assert.equal(narrowingError.value, "");
});
