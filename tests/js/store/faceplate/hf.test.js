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

import { engineState, enums } from "../../../../hqptuner/static/store/signals.js";
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

test("test_the_hf_filter_reads_the_junk_filter_named_at_the_index_the_engine_reports", () => {
  const at = (/** @type {string} */ junk) => {
    wire(junk);
    return hfNow().txt;
  };
  assert.deepEqual([at("1"), at("2")], ["20k", "2x"]);
});

test("test_each_hf_option_is_valued_by_its_entrys_index", () => {
  assert.deepEqual(
    hfNow().options.map((o) => o.value),
    ["0", "1", "2"],
  );
});

test("test_the_hf_options_are_labelled_by_name_in_engine_order", () => {
  assert.deepEqual(
    hfNow().options.map((o) => o.label),
    NAMES,
  );
});

test("test_only_the_running_hf_option_is_current", () => {
  const current = (/** @type {string} */ junk) => {
    wire(junk);
    return hfNow()
      .options.filter((o) => o.cur === true)
      .map((o) => o.value);
  };
  assert.deepEqual([current("1"), current("2")], [["1"], ["2"]]);
});

/**
 * Whether a reading names a fixture filter, and whether it is the running index itself.
 *
 * @param {string} txt
 */
const reading = (txt) => ({ named: NAMES.includes(txt), index: txt === RUNNING });

test("test_with_no_engine_state_the_hf_filter_names_no_filter", () => {
  const before = reading(hfNow().txt);
  engineState.value = null;
  const after = reading(hfNow().txt);
  assert.deepEqual(
    [before, after],
    [
      { named: true, index: false },
      { named: false, index: false },
    ],
  );
});

test("test_with_no_enumeration_the_hf_filter_names_no_filter_rather_than_the_index", () => {
  const before = reading(hfNow().txt);
  enums.value = null;
  const after = reading(hfNow().txt);
  assert.deepEqual(
    [before, after],
    [
      { named: true, index: false },
      { named: false, index: false },
    ],
  );
});

test("test_with_no_engine_state_the_hf_options_empty", () => {
  const running = hfNow().options.length;
  engineState.value = null;
  assert.deepEqual([running, hfNow().options.length], [NAMES.length, 0]);
});

test("test_with_no_enumeration_the_hf_options_empty", () => {
  const running = hfNow().options.length;
  enums.value = null;
  assert.deepEqual([running, hfNow().options.length], [NAMES.length, 0]);
});
