// Behavioral suite for hfNow in hqptuner/static/store/faceplate/hf.js: the engine row's HF filter, the playback filter
// HQPlayer calls the junk filter, read off the index the engine reports and the `junk_filters` enumeration.
//
// The wire is the seam: /api/state into `engineState`, /api/enumerations into `enums`. Each enumeration entry's value
// differs from its index, and the value of each entry equals another entry's index, so a join on the value rather than
// the index names the wrong filter.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/hf.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { engineState, engineStatus, enums, health } from "../../../../hqptuner/static/store/signals.js";
import { hfNow } from "../../../../hqptuner/static/store/faceplate/hf.js";

/** The `junk_filters` names, in the engine's order, which is not their sorted order. */
const NAMES = ["none", "20k", "2x"];

/** The running junk filter's index every case starts from. */
const RUNNING = "1";

/**
 * One `junk_filters` entry as the daemon sends it: every attribute a string, its value the index of the next entry.
 *
 * @param {string} name
 * @param {number} i
 */
const item = (name, i) => ({ index: String(i), value: String((i + 2) % NAMES.length), name });

/**
 * Write one running engine onto the wire-side signals.
 *
 * @param {string} junk  the running junk filter's index
 */
function wire(junk) {
  engineState.value = { state: "2", active_chain: "pcm", filter_junk: junk, filter1x: "0", filterNx: "0", shaper: "0" };
  enums.value = { junk_filters: NAMES.map(item), filters: [], shapers: [] };
}

beforeEach(() => wire(RUNNING));

const at = (/** @type {string} */ junk) => {
  wire(junk);
  return hfNow().txt;
};

test("test_the_hf_filter_reads_the_junk_filter_named_at_reported_index_1", () => {
  assert.equal(at("1"), "20k");
});

test("test_the_hf_filter_reads_the_junk_filter_named_at_reported_index_2", () => {
  assert.equal(at("2"), "2x");
});

test("test_each_hf_option_is_valued_by_its_entrys_index", () => {
  assert.deepEqual(
    hfNow().options.map((o) => o.value),
    ["0", "1", "2"],
  );
});

test("test_the_hf_options_are_labeled_by_name_in_engine_order", () => {
  assert.deepEqual(
    hfNow().options.map((o) => o.label),
    NAMES,
  );
});

/**
 * The HF filter's name for a running engine that lost its State or its enumeration, beside the name when the engine
 * has neither; what reads as no filter is whatever the row shows with nothing known at all.
 *
 * @param {"state" | "enums"} lost  the wire side that went missing
 * @returns {[string, string]}
 */
function namedWithout(lost) {
  wire(RUNNING);
  if (lost === "state") engineState.value = null;
  else enums.value = null;
  const named = hfNow().txt;
  engineState.value = null;
  enums.value = null;
  return [named, hfNow().txt];
}

test("test_the_hf_filter_names_no_filter_without_engine_state", () => {
  assert.equal(...namedWithout("state"));
});

test("test_the_hf_filter_names_no_filter_without_an_enumeration", () => {
  assert.equal(...namedWithout("enums"));
});

const current = (/** @type {string} */ junk) => {
  wire(junk);
  return hfNow()
    .options.filter((o) => o.cur === true)
    .map((o) => o.value);
};

test("test_only_the_hf_option_at_running_index_1_is_current", () => {
  assert.deepEqual(current("1"), ["1"]);
});

test("test_only_the_hf_option_at_running_index_2_is_current", () => {
  assert.deepEqual(current("2"), ["2"]);
});

/** Every `junk_filters` name the engine offers, in its order. */
const ALL = ["none", "20k", "30k", "40k", "50k", "2x", "4x", "8x"];

/**
 * The names of the options grayed while a source plays, or sits in the transport `state`, at a rate.
 *
 * @param {string} rate  the source rate in hertz
 * @param {{ sdm?: string, state?: string }} [over]  the source's DSD flag; the Status `state`, "2" playing
 * @returns {string[]}
 */
function grayedAt(rate, over = {}) {
  health.value = { phase: "Ready" };
  engineState.value = { state: "2", active_chain: "pcm", filter_junk: "1" };
  enums.value = { junk_filters: ALL.map((name, i) => ({ index: String(i), value: String(i), name })) };
  engineStatus.value = { status: { state: over.state ?? "2" }, metadata: { samplerate: rate, sdm: over.sdm ?? "0" } };
  return hfNow()
    .options.filter((o) => o.grayed)
    .map((o) => o.label);
}

test("test_a_44_1_source_grays_every_option_but_none", () => {
  assert.deepEqual(grayedAt("44100"), ALL.slice(1));
});

test("test_a_dsd64_source_grays_every_option_but_none", () => {
  assert.deepEqual(grayedAt("2822400", { sdm: "1" }), ALL.slice(1));
});

test("test_an_88_2_source_grays_50k_2x_4x_and_8x", () => {
  assert.deepEqual(grayedAt("88200"), ["50k", "2x", "4x", "8x"]);
});

test("test_a_176_4_source_grays_4x_and_8x_only", () => {
  assert.deepEqual(grayedAt("176400"), ["4x", "8x"]);
});

test("test_a_paused_source_is_judged_like_a_playing_one", () => {
  assert.deepEqual(grayedAt("88200", { state: "1" }), ["50k", "2x", "4x", "8x"]);
});

test("test_a_stopped_engine_with_stale_44_1_metadata_grays_nothing", () => {
  assert.deepEqual(grayedAt("44100", { state: "0" }), []);
});

test("test_a_grayed_running_option_is_still_current", () => {
  grayedAt("44100");
  assert.deepEqual(
    hfNow()
      .options.filter((o) => o.grayed && o.cur)
      .map((o) => o.label),
    ["20k"],
  );
});
