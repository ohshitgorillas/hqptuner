// Behavioral suite for the PERSISTENCE half of filter narrowing
// (store/narrow/state.js): the facets the narrow bar is set to, kept on the SERVER
// so a reload finds the bar the way the user left it. Which filters a facet
// then hides is narrowing.test.js's subject, not this file's. The three
// rate-narrowing switches that replaced the ratio pick live in
// tests/js/store/narrowing-rate.test.js, wire keys and all.
//
// Persistence is one REST pair, GET/PUT /api/narrowing, both sides carrying
// `{facets: {...}}`, driven through the shared fetch fake in
// tests/js/support/narrowingwire.js: it speaks that path with those shapes and
// HOLDS the facet map the way the backend's store does (docs/testing.md rule 4
// — real path, real shapes, nothing of ours stubbed). No daemon is behind it;
// narrowing is HQPTuner's own presentational state (docs/architecture.md,
// "Filter narrowing").
//
// Writing is coalesce-then-flush. The debounce window is not a behaviour to
// test on a clock (rule 7), so every case that sends drives the write through
// `flushNarrowing()`, the way descriptions.test.js drives `flushDescriptions`.
//
// `reset()` puts every piece of module state a case touches back: the facet
// signals, the error line, and the private "changed since the last write"
// mark, which it clears the only way a caller can — one flush against a
// throwaway wire, sent BEFORE the case's own wire is installed so that drain
// lands nowhere the case can see. Without it a case passes only behind
// whichever case last drained.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/narrowing-persist.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { ok } from "../support/wire.js";
import { settle } from "../support/livepresetwire.js";
import { NARROWING_DEFAULTS as DEFAULTS, narrowingWire, puts } from "../support/narrowingwire.js";
import {
  nGenre,
  nGenreMode,
  nQuality,
  nFocus,
  nFocusMode,
  nPhase,
  nLength,
  nApod1x,
  nApodNx,
  nLossy1x,
  nSrcFormat,
  resetNarrowing,
} from "../../../hqptuner/static/store/narrow/state.js";
import { narrowingError, hydrateNarrowing, flushNarrowing } from "../../../hqptuner/static/store/narrow/persist.js";

const PATH = "/api/narrowing";

/**
 * The global the fetch fake is installed on, viewed as an optional member: the
 * DOM lib declares `fetch` returning a real `Response`, which this fake does
 * not build.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;

/** @typedef {import("../support/narrowingwire.js").Facets} Facets */
/** @typedef {import("../support/narrowingwire.js").NarrowingWire} NarrowingWire */

/** One in-domain value per facet, each different from that facet's default. */
/** @type {Facets} */
const SET = {
  genre: ["classical"],
  genre_mode: "and",
  quality: 4,
  focus: ["timbre"],
  focus_mode: "or",
  phase: ["linear"],
  length: ["long"],
  apod_1x: "only",
  apod_nx: "only",
  lossy_1x: "lossless",
  src_format: "both",
};

/** The wire key of each facet, against the signal that carries it. */
/** @type {Record<string, { value: unknown }>} */
const SIGNALS = {
  genre: nGenre,
  genre_mode: nGenreMode,
  quality: nQuality,
  focus: nFocus,
  focus_mode: nFocusMode,
  phase: nPhase,
  length: nLength,
  apod_1x: nApod1x,
  apod_nx: nApodNx,
  lossy_1x: nLossy1x,
  src_format: nSrcFormat,
};

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

// The facet holds a value before the hydrate under test, so this tells "put
// back to the default" apart from "left exactly as it was": after `reset()`
// alone the two look alike and an implementation that ignored an omitted facet
// would pass either way.
//
// That starting value arrives from a FIRST hydrate rather than from an
// assignment. Writing the signal is how the user ticking a box looks from here,
// and a facet the user has moved is deliberately left alone by a later hydrate
// (pinned just below) — so seeding by assignment would test that guard instead
// of the omitted facet, and never reach the branch these two are named for.
async function hydratedThenOmitted() {
  await hydrateNarrowing();
  env.fetch = async (/** @type {string} */ path) => (path === PATH ? ok({ facets: { quality: 4 } }) : ok({}));
  await hydrateNarrowing();
}

test("test_hydration_leaves_a_facet_the_server_omits_at_its_default", async () => {
  await reset({ facets: SET });
  await hydratedThenOmitted();
  assert.deepEqual(nPhase.value, []);
});

// Its own case rather than a second reading of the one above: phase and length
// no longer share a classifier fallback and are hydrated as two facets, so one
// coming back empty says nothing about the other.
test("test_hydration_leaves_the_length_facet_the_server_omits_at_its_default", async () => {
  await reset({ facets: SET });
  await hydratedThenOmitted();
  assert.deepEqual(nLength.value, []);
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
  nPhase.value = ["minimum"];
  await hydrateNarrowing();
  assert.deepEqual(nPhase.value, ["minimum"]);
});

test("test_a_failed_hydration_reports_the_sentence_the_server_sent", async () => {
  await reset({ getStatus: 503, getDetail: "Narrowing is unavailable." });
  await hydrateNarrowing();
  assert.equal(narrowingError.value, "Narrowing is unavailable.");
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
  nPhase.value = ["minimum"];
  await flushNarrowing();
  assert.equal(puts(w).length, 1);
});

// The put may carry keys this table does not name — the rate-narrowing
// switches, whose wire keys are pinned by their own suite — but every facet of
// the table rides along.
test("test_a_flush_sends_every_facet_of_the_contract_table", async () => {
  const w = await reset();
  await hydrateNarrowing();
  nPhase.value = ["minimum"];
  await flushNarrowing();
  const sent = puts(w).at(-1) || {};
  assert.deepEqual(
    Object.keys(DEFAULTS).filter((k) => !(k in sent)),
    [],
  );
});

test("test_a_flush_sends_the_changed_facet_as_the_user_set_it", async () => {
  const w = await reset();
  await hydrateNarrowing();
  nPhase.value = ["minimum"];
  await flushNarrowing();
  assert.deepEqual((puts(w).at(-1) || {}).phase, ["minimum"]);
});

// The lossy control rides the same put BY VALUE, not merely by key: a client
// that always sent the key at its default would keep the whole table intact
// while the bar silently failed to survive a reload.
test("test_a_flush_sends_the_lossy_facet_as_the_user_set_it", async () => {
  const w = await reset();
  await hydrateNarrowing();
  nLossy1x.value = "lossless";
  await flushNarrowing();
  assert.equal((puts(w).at(-1) || {}).lossy_1x, "lossless");
});

// The source-format control rides the same put BY VALUE, not merely by key: a
// client that always sent the key at its default would keep the whole table
// intact while the bar silently failed to survive a reload.
test("test_a_flush_sends_the_src_format_facet_as_the_user_set_it", async () => {
  const w = await reset();
  await hydrateNarrowing();
  nSrcFormat.value = "both";
  await flushNarrowing();
  assert.equal((puts(w).at(-1) || {}).src_format, "both");
});

test("test_a_flush_sends_a_facet_the_user_did_not_touch_at_the_value_it_holds", async () => {
  const w = await reset({ facets: SET });
  await hydrateNarrowing();
  nPhase.value = ["minimum"];
  await flushNarrowing();
  assert.deepEqual((puts(w).at(-1) || {}).length, ["long"]);
});

test("test_three_changed_facets_coalesce_into_one_put", async () => {
  const w = await reset();
  await hydrateNarrowing();
  nPhase.value = ["minimum"];
  nLength.value = ["short"];
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
  nPhase.value = ["minimum"];
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
  nPhase.value = ["minimum"];
  await flushNarrowing();
  const sent = puts(w).at(-1) || { no_put_was_sent: true };
  assert.deepEqual(
    Object.keys(sent).filter((k) => k.includes("fav") || k === "no_put_was_sent"),
    [],
  );
});

test("test_a_reset_flushes_every_facet_of_the_contract_table_at_its_default", async () => {
  const w = await reset({ facets: SET });
  await hydrateNarrowing();
  nPhase.value = ["minimum"];
  resetNarrowing();
  await flushNarrowing();
  const sent = puts(w).at(-1) || {};
  assert.deepEqual(Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, sent[k]])), DEFAULTS);
});

// --- a write the server refused -----------------------------------------------------
// Unlike favorites, nothing reverts: the facet is presentational, so yanking the
// user's toggle back is worse than a stale file.

test("test_a_failed_write_keeps_the_facet_the_user_set", async () => {
  await reset({ putStatus: 500, putDetail: "State directory is read-only." });
  await hydrateNarrowing();
  nPhase.value = ["minimum"];
  await flushNarrowing();
  assert.deepEqual(nPhase.value, ["minimum"]);
});

test("test_a_failed_write_reports_the_sentence_the_server_sent", async () => {
  await reset({ putStatus: 500, putDetail: "State directory is read-only." });
  await hydrateNarrowing();
  nPhase.value = ["minimum"];
  await flushNarrowing();
  assert.equal(narrowingError.value, "State directory is read-only.");
});

test("test_a_write_that_succeeds_after_a_failed_one_clears_the_error", async () => {
  await reset({ putStatus: 500, putDetail: "State directory is read-only." });
  await hydrateNarrowing();
  nPhase.value = ["minimum"];
  await flushNarrowing();
  narrowingWire();
  nLength.value = ["short"];
  await flushNarrowing();
  assert.equal(narrowingError.value, "");
});

test("test_a_successful_write_leaves_no_error", async () => {
  await reset();
  await hydrateNarrowing();
  nPhase.value = ["minimum"];
  await flushNarrowing();
  assert.equal(narrowingError.value, "");
});
