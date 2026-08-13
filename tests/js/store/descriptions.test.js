// Behavioral suite for profile descriptions on the client (store/descriptions.js):
// the prose a user attaches to a saved matrix profile, kept on the SERVER so
// every browser sees the same note, and keyed by profile NAME — the stable join
// key (docs/architecture.md §2), which is also all `<matrix_profile>` carries
// (hqplayerd-readme.txt §1.12).
//
// Persistence is one REST pair, GET/PUT /api/descriptions, driven through the
// fetch fake below: it speaks those paths with those shapes, HOLDS the map the
// way the backend's store does, and stamps every entry it accepts (docs/testing.md
// rule 4 — real path, real shapes, nothing of ours stubbed).
//
// Saving is queue-then-flush: typing calls `queueDescription`, and one
// `flushDescriptions` sends what the typing left behind. So the cases about what
// reaches the wire assert on the PUT bodies the fake was handed, and the case
// about a refused save asserts on what the user is left looking at.
//
// `reset()` reassigns both module-level signals a test touches — they outlive a
// test file, and a partial reset makes tests pass alone and fail in sequence.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/descriptions.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { ok, bad } from "../support/wire.js";
import { settle } from "../support/livepresetwire.js";
import {
  descriptions,
  descriptionError,
  descriptionFor,
  queueDescription,
  flushDescriptions,
} from "../../../hqptuner/static/store/descriptions.js";

const PATH = "/api/descriptions";
const NAME = "Living Room";
const OTHER = "Study";
const TEXT = "Wide stereo, gentle tilt below 200 Hz.";
const STAMP = "2026-02-03T04:05:06+00:00";

/**
 * The global the fetch fake is installed on, viewed as an optional member: the
 * DOM lib declares `fetch` returning a real `Response`, which this fake does
 * not build.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;

/**
 * @typedef {Record<string, { text: string, updated: string }>} ProfileMap
 */

/**
 * @typedef {{
 *   calls: { path: string, method: string, body?: string }[],
 *   profiles: ProfileMap,
 * }} DescriptionWire
 */

/**
 * The PUT bodies the wire was handed, newest last, each as its `{name, text}`
 * pair.
 *
 * @param {DescriptionWire} w
 * @returns {{ name: string, text: string }[]}
 */
const puts = (w) =>
  w.calls.filter((c) => c.path === PATH && c.method === "PUT").map((c) => JSON.parse(String(c.body)));

/**
 * A fake of the server side of the pair: it holds the map, stores what a PUT
 * names under a fresh stamp, drops the entry when the text is blank, and
 * answers the whole map either way — which is what the real routes do.
 *
 * @param {{ profiles?: ProfileMap, putStatus?: number, putDetail?: string }} [cfg]
 * @returns {DescriptionWire}
 */
function descriptionsWire(cfg = {}) {
  /** @type {DescriptionWire} */
  const w = { calls: [], profiles: { ...(cfg.profiles || {}) } };
  const putStatus = cfg.putStatus || 200;
  env.fetch = async (/** @type {string} */ path, /** @type {{method?: string, body?: string}} */ opts = {}) => {
    const method = opts.method || "GET";
    w.calls.push({ path, method, body: opts.body });
    if (path !== PATH) return ok({});
    if (method !== "PUT") return ok({ profiles: w.profiles });
    if (putStatus !== 200) return bad(putStatus, cfg.putDetail);
    const { name, text } = JSON.parse(String(opts.body));
    if (String(text).trim() === "") delete w.profiles[name];
    else w.profiles[name] = { text, updated: STAMP };
    return ok({ profiles: w.profiles });
  };
  return w;
}

/**
 * @param {{ profiles?: ProfileMap, putStatus?: number, putDetail?: string }} [cfg]
 * @returns {DescriptionWire}
 */
function reset(cfg = {}) {
  const w = descriptionsWire(cfg);
  descriptions.value = { ...(cfg.profiles || {}) };
  descriptionError.value = "";
  return w;
}

/** @param {string} text @param {string} [updated] */
const entry = (text, updated = STAMP) => ({ text, updated });

// --- reading one profile's description ------------------------------------------

test("test_a_stored_description_is_answered_for_its_profile_name", () => {
  reset({ profiles: { [NAME]: entry(TEXT) } });
  assert.equal(descriptionFor(NAME)?.text, TEXT);
});

test("test_a_stored_description_carries_the_stamp_the_server_sent", () => {
  reset({ profiles: { [NAME]: entry(TEXT) } });
  assert.equal(descriptionFor(NAME)?.updated, STAMP);
});

test("test_a_profile_with_no_description_answers_null", () => {
  reset({ profiles: { [NAME]: entry(TEXT) } });
  assert.equal(descriptionFor(OTHER), null);
});

test("test_a_profile_name_answers_null_when_nothing_is_stored_at_all", () => {
  reset();
  assert.equal(descriptionFor(NAME), null);
});

// --- queue then flush --------------------------------------------------------------

test("test_queueing_a_description_sends_nothing_until_the_flush", async () => {
  const w = reset();
  queueDescription(NAME, TEXT);
  await settle();
  assert.deepEqual(puts(w), []);
});

test("test_a_flush_sends_exactly_one_put_for_one_queued_profile", async () => {
  const w = reset();
  queueDescription(NAME, TEXT);
  await flushDescriptions();
  assert.equal(puts(w).length, 1);
});

test("test_a_flush_sends_the_last_text_queued_for_that_profile", async () => {
  const w = reset();
  queueDescription(NAME, "half a thou");
  queueDescription(NAME, "half a thought");
  queueDescription(NAME, TEXT);
  await flushDescriptions();
  assert.deepEqual(puts(w).at(-1), { name: NAME, text: TEXT });
});

test("test_retyping_a_profile_before_the_flush_sends_only_one_put", async () => {
  const w = reset();
  queueDescription(NAME, "half a thought");
  queueDescription(NAME, TEXT);
  await flushDescriptions();
  assert.equal(puts(w).length, 1);
});

test("test_a_flush_with_nothing_queued_sends_nothing", async () => {
  const w = reset();
  await flushDescriptions();
  assert.deepEqual(puts(w), []);
});

test("test_a_second_flush_does_not_resend_what_the_first_already_saved", async () => {
  const w = reset();
  queueDescription(NAME, TEXT);
  await flushDescriptions();
  await flushDescriptions();
  assert.equal(puts(w).length, 1);
});

// --- what the save leaves on screen --------------------------------------------------

test("test_a_saved_description_is_readable_back_out_of_the_store", async () => {
  reset();
  queueDescription(NAME, TEXT);
  await flushDescriptions();
  assert.equal(descriptionFor(NAME)?.text, TEXT);
});

test("test_a_saved_description_takes_the_stamp_the_server_answered_with", async () => {
  reset();
  queueDescription(NAME, TEXT);
  await flushDescriptions();
  assert.equal(descriptionFor(NAME)?.updated, STAMP);
});

test("test_a_save_leaves_another_profiles_description_alone", async () => {
  reset({ profiles: { [OTHER]: entry("near field") } });
  queueDescription(NAME, TEXT);
  await flushDescriptions();
  assert.equal(descriptionFor(OTHER)?.text, "near field");
});

test("test_a_successful_save_leaves_no_error", async () => {
  reset();
  queueDescription(NAME, TEXT);
  await flushDescriptions();
  assert.equal(descriptionError.value, "");
});

// --- a refused save --------------------------------------------------------------------
// The user's typing is the one thing that cannot be thrown away: a save the
// server refused leaves the text queued, so the next flush still carries it, and
// says why on the error line — it never blanks what is on screen.

test("test_a_failed_save_reports_the_sentence_the_server_sent", async () => {
  reset({ putStatus: 422, putDetail: "That description is too long." });
  queueDescription(NAME, TEXT);
  await flushDescriptions();
  assert.equal(descriptionError.value, "That description is too long.");
});

test("test_a_failed_save_keeps_the_text_queued_for_the_next_flush", async () => {
  const w = reset({ putStatus: 500, putDetail: "State directory is read-only." });
  queueDescription(NAME, TEXT);
  await flushDescriptions();
  await flushDescriptions();
  assert.deepEqual(puts(w).at(-1), { name: NAME, text: TEXT });
});

test("test_a_failed_save_does_not_blank_the_description_already_stored", async () => {
  reset({ profiles: { [NAME]: entry("warm") }, putStatus: 500, putDetail: "State directory is read-only." });
  queueDescription(NAME, TEXT);
  await flushDescriptions();
  assert.equal(descriptionFor(NAME)?.text, "warm");
});

test("test_a_failed_save_does_not_throw", async () => {
  reset({ putStatus: 500, putDetail: "State directory is read-only." });
  queueDescription(NAME, TEXT);
  await assert.doesNotReject(() => flushDescriptions());
});
