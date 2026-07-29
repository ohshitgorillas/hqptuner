// Behavioral suite for store/live.js — the LIVE view's store: the values and
// option lists its controls read, and the one path they write by.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. Every case drives the exported `engineState` / `enums` signals with
// the shapes /api/state and /api/enumerations actually serve, and every write
// goes out over a faked `globalThis.fetch` on the real REST path — no store
// function is ever stubbed.
//
// The fake enumerations deliberately give each item an index that differs from
// its value. State reports the LIST INDEX and the config-form domain these
// controls speak is the enum ID (protocol.md §4), so a fixture where the two
// coincide could not tell a correct join from no join at all.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/live.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { engineState, enums } from "../../hqptuner/static/store/state.js";
import { liveModel, liveErrors, liveBusy, writeLive } from "../../hqptuner/static/store/live.js";
import { ok, bad } from "./wire.js";

const FILTERS = [
  { index: "0", value: "0", name: "none" },
  { index: "1", value: "40", name: "poly-sinc-gauss-long" },
  { index: "2", value: "25", name: "sinc-M" },
];
const SHAPERS = [
  { index: "0", value: "0", name: "none" },
  { index: "1", value: "31", name: "TPDF" },
];
// RatesItem carries no name and no value — `<RatesItem index rate/>` (protocol.md §6).
const RATES = [
  { index: "0", rate: "0" },
  { index: "1", rate: "96000" },
  { index: "2", rate: "192000" },
];
// value differs from index so a control that reads the ID rather than the index
// (which is what this one speaks on both sides) fails loudly.
const JUNK = [
  { index: "0", value: "0", name: "none" },
  { index: "1", value: "7", name: "20 kHz" },
];

const ENUMS = () => ({ filters: FILTERS, shapers: SHAPERS, rates: RATES, junk_filters: JUNK, mode: { name: "PCM" } });

// filterNx sits at index 2, whose enum ID is 25; rate at index 1, which is 96 kHz.
const STATE = () => ({
  mode: "1",
  filter1x: "1",
  filterNx: "2",
  shaper: "1",
  rate: "1",
  filter_junk: "1",
  adaptive: "0",
  active_chain: "pcm",
});

// The enumerations a re-enumerating write pulls in: same shape, different names,
// so adopting them is observable.
const RE_ENUMS = () => ({ ...ENUMS(), filters: [{ index: "0", value: "3", name: "poly-sinc-short" }] });

// A live-lane server: the write path, plus the two endpoints a successful write
// re-mirrors from. `report` is what /api/config/live answers on 200; `status` +
// `detail` make it refuse instead.
function liveWire({ status = 200, detail, report = { live: [] }, fresh } = {}) {
  const w = { posts: [] };
  globalThis.fetch = async (path, opts = {}) => {
    if (path === "/api/config/live") {
      w.posts.push(JSON.parse(opts.body));
      return status === 200 ? ok(report) : bad(status, detail);
    }
    if (path === "/api/state") return ok({ data: STATE() });
    if (path === "/api/enumerations") return ok({ data: fresh || ENUMS() });
    return ok({});
  };
  return w;
}

// Total reset: module-level signals outlive a test, so a partial one makes cases
// pass alone and fail in sequence.
function reset(wire = {}) {
  engineState.value = STATE();
  enums.value = ENUMS();
  liveErrors.value = {};
  liveBusy.value = "";
  return liveWire(wire);
}

const control = (field) => liveModel.value.chainControls.find((c) => c.field === field);

test("test_the_filter_control_reads_the_enum_id_the_engine_is_using", () => {
  reset();
  assert.equal(control("filter").value, "25");
});

test("test_the_rate_control_reads_the_rate_in_hz", () => {
  reset();
  assert.equal(liveModel.value.pcmRate.value, "96000");
});

test("test_the_junk_filter_control_speaks_list_indices", () => {
  reset();
  assert.equal(liveModel.value.junk.value, "1");
});

test("test_the_mode_control_reads_pcm_from_the_engines_mode_name", () => {
  reset();
  assert.equal(liveModel.value.mode.value, "pcm");
});

test("test_a_dormant_chain_offers_no_filter_controls", () => {
  reset();
  engineState.value = { ...STATE(), active_chain: null };
  assert.deepEqual(liveModel.value.chainControls, []);
});

test("test_writing_a_control_posts_one_field_to_the_live_lane", async () => {
  const w = reset();
  await writeLive("filter", "40");
  assert.deepEqual(w.posts, [{ fields: { filter: "40" } }]);
});

test("test_a_verified_write_leaves_the_control_without_an_error", async () => {
  reset({ report: { live: [{ setting: "filter", ok: true }] } });
  await writeLive("filter", "40");
  assert.equal(liveErrors.value.filter, undefined);
});

test("test_a_setter_that_did_not_verify_names_itself_on_the_control", async () => {
  reset({ report: { live: [{ setting: "filter", ok: false, error: "filter never converged" }] } });
  await writeLive("filter", "40");
  assert.equal(liveErrors.value.filter, "filter never converged");
});

test("test_a_refused_batch_carries_the_engines_own_reason", async () => {
  reset({ status: 409, detail: { filter: "the pcm chain is not loaded (engine chain: sdm)" } });
  await writeLive("filter", "40");
  assert.equal(liveErrors.value.filter, "the pcm chain is not loaded (engine chain: sdm)");
});

test("test_a_mode_write_re_pulls_the_enumerations", async () => {
  reset({ fresh: RE_ENUMS() });
  await writeLive("mode", "sdm");
  assert.equal(enums.value.filters[0].name, "poly-sinc-short");
});

test("test_a_junk_filter_write_leaves_the_enumerations_alone", async () => {
  reset({ fresh: RE_ENUMS() });
  await writeLive("junk_filter", "0");
  assert.equal(enums.value.filters[0].name, "none");
});
