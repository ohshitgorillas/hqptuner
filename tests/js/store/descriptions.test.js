// Behavioral suite for profile descriptions on the client (store/matrix/descriptions.js):
// the prose a user attaches to a saved matrix profile, kept on the SERVER so
// every browser sees the same note, and keyed by profile NAME — the stable join
// key, which is also all `<matrix_profile>` carries (hqplayerd-readme.txt §1.12).
//
// Persistence is one REST pair, GET/PUT /api/descriptions, driven through the
// fetch fake below: it speaks those paths with those shapes, HOLDS the map the
// way the backend's store does, and stamps every entry it accepts.
//
// Saving is queue-then-flush: typing calls `queueDescription`, and one
// `flushDescriptions` sends what the typing left behind. So the cases about what
// reaches the wire assert on the PUT bodies the fake was handed, and the case
// about a refused save asserts on what the user is left looking at.
//
// `reset()` puts every piece of module state a test touches back: both signals,
// and the private queue, which it empties by flushing once against an accepting
// wire. All three outlive a test, and a partial reset makes cases that only pass
// in a particular order.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/descriptions.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { ok, bad } from "../support/wire/wire.js";
import { settle } from "../support/wire/livepresetwire.js";
import { fakeClock } from "../support/clock.js";
import {
  descriptions,
  descriptionError,
  descriptionFor,
  queueDescription,
  flushDescriptions,
} from "../../../hqptuner/static/store/matrix/descriptions.js";

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
const puts = (w) => w.calls.filter((c) => c.path === PATH && c.method === "PUT").map((c) => JSON.parse(String(c.body)));

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
 * Put the module back to a stated starting state: nothing queued, the map and
 * the error line as the case says they are, and the case's own wire installed.
 *
 * The queue is module-private and outlives a test, so it is emptied the only
 * way a caller can — one flush against a wire that accepts everything, sent
 * BEFORE the case's wire is installed so that drain lands nowhere the case can
 * see. Without it a case passes only behind whichever case last drained.
 *
 * @param {{ profiles?: ProfileMap, putStatus?: number, putDetail?: string }} [cfg]
 * @returns {Promise<DescriptionWire>}
 */
async function reset(cfg = {}) {
  descriptionsWire();
  await flushDescriptions();
  const w = descriptionsWire(cfg);
  descriptions.value = { ...(cfg.profiles || {}) };
  descriptionError.value = "";
  return w;
}

/** @param {string} text @param {string} [updated] */
const entry = (text, updated = STAMP) => ({ text, updated });

// --- reading one profile's description ------------------------------------------

test("test_a_stored_description_is_answered_for_its_profile_name", async () => {
  await reset({ profiles: { [NAME]: entry(TEXT) } });
  assert.equal(descriptionFor(NAME)?.text, TEXT);
});

test("test_a_profile_with_no_description_answers_null", async () => {
  await reset({ profiles: { [NAME]: entry(TEXT) } });
  assert.equal(descriptionFor(OTHER), null);
});

// --- queue then flush --------------------------------------------------------------

test("test_queueing_a_description_sends_nothing_until_the_flush", async () => {
  const w = await reset();
  queueDescription(NAME, TEXT);
  await settle();
  assert.deepEqual(puts(w), []);
});

test("test_a_flush_sends_the_last_text_queued_for_that_profile", async () => {
  const w = await reset();
  queueDescription(NAME, "half a thou");
  queueDescription(NAME, "half a thought");
  queueDescription(NAME, TEXT);
  await flushDescriptions();
  assert.deepEqual(puts(w).at(-1), { name: NAME, text: TEXT });
});

test("test_retyping_a_profile_before_the_flush_sends_only_one_put", async () => {
  const w = await reset();
  queueDescription(NAME, "half a thought");
  queueDescription(NAME, TEXT);
  await flushDescriptions();
  assert.equal(puts(w).length, 1);
});

test("test_a_flush_with_nothing_queued_sends_nothing", async () => {
  const w = await reset();
  await flushDescriptions();
  assert.deepEqual(puts(w), []);
});

test("test_a_second_flush_does_not_resend_what_the_first_already_saved", async () => {
  const w = await reset();
  queueDescription(NAME, TEXT);
  await flushDescriptions();
  await flushDescriptions();
  assert.equal(puts(w).length, 1);
});

// --- the send that goes out on its own ----------------------------------------------
// Typing paces on the Clock handed to `queueDescription`, here a fake that moves
// only on `advance`. The quiet window is the module's own choice, so no case
// states it: `pacedClock` reads it off the delay of the timer the module last
// armed, and every case is stated relative to it.

/** @typedef {import("../../../hqptuner/static/lib/clock.js").Clock} Clock */

/**
 * A fake Clock that also reports the delay of the last timeout armed on it,
 * which is the module's quiet window; 0 while nothing has been armed.
 *
 * @returns {{ clock: Clock, advance: (ms: number) => void, quiet: () => number }}
 */
function pacedClock() {
  const { clock, advance } = fakeClock();
  /** @type {number[]} */
  const delays = [];
  /** @type {Clock} */
  const paced = {
    ...clock,
    setTimeout: (fn, ms) => {
      delays.push(ms);
      return clock.setTimeout(fn, ms);
    },
  };
  return { clock: paced, advance, quiet: () => delays.at(-1) ?? 0 };
}

/**
 * How many PUTs the wire holds once the clock has moved `ms` on and whatever
 * send that fired has settled.
 *
 * @param {DescriptionWire} w
 * @param {(ms: number) => void} advance
 * @param {number} ms
 * @returns {Promise<number>}
 */
async function putsAfter(w, advance, ms) {
  advance(ms);
  await settle();
  return puts(w).length;
}

const DRAFT = "Wide stereo, gentle";
const STUDY_TEXT = "near field";

/** @param {{ name: string }} a @param {{ name: string }} b */
const byName = (a, b) => a.name.localeCompare(b.name, "en");

test("test_a_queued_description_goes_out_on_its_own_once_the_typist_has_been_quiet_for_the_window", async () => {
  const w = await reset();
  const { clock, advance, quiet } = pacedClock();
  queueDescription(NAME, TEXT, clock);
  const quietMs = quiet();
  const counts = [await putsAfter(w, advance, quietMs - 1), await putsAfter(w, advance, 1)];
  assert.deepEqual(counts, [0, 1]);
});

test("test_typing_again_inside_the_quiet_window_restarts_the_window", async () => {
  const w = await reset();
  const { clock, advance, quiet } = pacedClock();
  queueDescription(NAME, DRAFT, clock);
  const quietMs = quiet();
  advance(quietMs - 1);
  queueDescription(NAME, TEXT, clock);
  const counts = [await putsAfter(w, advance, quietMs - 1), await putsAfter(w, advance, 1)];
  assert.deepEqual(counts, [0, 1]);
});

//: Each PUT one burst of typing sends, by its place in name order, with the profile it names and the text it carries.
/** @type {[string, number, string, string][]} */
const BURST_PUTS = [
  ["a_profile_retyped_in_it_its_newest_text", 0, NAME, TEXT],
  ["a_profile_typed_once_in_it_its_text", 1, OTHER, STUDY_TEXT],
];

for (const [behavior, i, name, text] of BURST_PUTS) {
  test(`test_one_burst_of_typing_sends_${behavior}`, async () => {
    const w = await reset();
    const { clock, advance, quiet } = pacedClock();
    queueDescription(NAME, DRAFT, clock);
    queueDescription(OTHER, STUDY_TEXT, clock);
    queueDescription(NAME, TEXT, clock);
    advance(quiet());
    await settle();
    assert.deepEqual(puts(w).sort(byName)[i], { name, text });
  });
}

// --- what the save leaves on screen --------------------------------------------------

test("test_a_saved_description_is_readable_back_out_of_the_store", async () => {
  await reset();
  queueDescription(NAME, TEXT);
  await flushDescriptions();
  assert.equal(descriptionFor(NAME)?.text, TEXT);
});

test("test_a_saved_description_takes_the_stamp_the_server_answered_with", async () => {
  await reset();
  queueDescription(NAME, TEXT);
  await flushDescriptions();
  assert.equal(descriptionFor(NAME)?.updated, STAMP);
});

test("test_a_save_leaves_another_profiles_description_alone", async () => {
  await reset({ profiles: { [OTHER]: entry("near field") } });
  queueDescription(NAME, TEXT);
  await flushDescriptions();
  assert.equal(descriptionFor(OTHER)?.text, "near field");
});

// --- a refused save --------------------------------------------------------------------
// The user's typing is the one thing that cannot be thrown away: a save the
// server refused leaves the text queued, so the next flush still carries it, and
// says why on the error line — it never blanks what is on screen.

test("test_a_failed_save_does_not_blank_the_description_already_stored", async () => {
  await reset({ profiles: { [NAME]: entry("warm") }, putStatus: 500, putDetail: "State directory is read-only." });
  queueDescription(NAME, TEXT);
  await flushDescriptions();
  assert.equal(descriptionFor(NAME)?.text, "warm");
});
