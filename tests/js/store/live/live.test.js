// Behavioral suite for store/live/ — the LIVE view's store: the values and
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

import { engineState, enums, config } from "../../../../hqptuner/static/store/signals.js";
import { liveModel } from "../../../../hqptuner/static/store/live/model.js";
import { liveErrors, liveBusy } from "../../../../hqptuner/static/store/live/state.js";
import { writeLive } from "../../../../hqptuner/static/store/live/write.js";
import { bad, ok } from "../../support/wire/wire.js";

/**
 * The globals a fake wire installs a `fetch` on, viewed as an optional
 * member: the DOM lib declares it returning a real `Response`, which this
 * fake does not build.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;

/**
 * One filter/shaper/junk-filter enum entry the engine reports.
 *
 * @typedef {{ index: string, value: string, name: string }} EnumItem
 */

/**
 * One `<RatesItem index rate/>` — no name and no value (protocol.md §6).
 *
 * @typedef {{ index: string, rate: string }} RateItem
 */

/**
 * The /api/enumerations payload this suite drives.
 *
 * @typedef {{
 *   filters: EnumItem[],
 *   shapers: EnumItem[],
 *   rates: RateItem[],
 *   junk_filters: EnumItem[],
 *   mode: { name: string },
 * }} Enums
 */

/**
 * The /api/state payload this suite drives.
 *
 * @typedef {{
 *   mode: string,
 *   filter1x: string,
 *   filterNx: string,
 *   shaper: string,
 *   rate: string,
 *   filter_junk: string,
 *   adaptive: string,
 *   active_chain: string,
 * }} EngineState
 */

/**
 * The config-file overlay keyed by form field: `mode` is always present, the
 * two rate limits only when a scenario needs them.
 *
 * @typedef {{ mode: string, defaults_samplerate?: string, defaults_bitrate?: string }} FileOverlay
 */

/**
 * One /api/config/live report entry.
 *
 * @typedef {{ setting: string, ok: boolean, error?: string, code?: string }} LiveReportEntry
 */

/**
 * The report a /api/config/live success body carries.
 *
 * @typedef {{ live: LiveReportEntry[] }} LiveReport
 */

/**
 * The seams `liveWire` answers from — `detail` on a refusal is a plain string
 * for a transport-level failure (a 503 the daemon never answered) and a
 * per-field object for a 409 the daemon refused outright (docs/protocol.md:
 * FastAPI's own `detail` shape differs by status).
 *
 * @typedef {{
 *   status?: number,
 *   detail?: string | Record<string, string>,
 *   report?: LiveReport,
 *   fresh?: Enums,
 *   mirrored?: EngineState,
 *   file?: FileOverlay,
 *   refreshed?: FileOverlay,
 * }} WireSeams
 */

/**
 * @typedef {{ state?: EngineState, lists?: Enums } & WireSeams} ResetSeams
 */

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

// `file` is the config XML overlaid with the engine's live settings, keyed by
// FORM FIELD name: the PCM rate limit is `defaults_samplerate`, the SDM one
// `defaults_bitrate` (store/schema.js pcm_rate / sdm_rate, both fileTruth).
const FILE = () => ({ mode: "pcm" });

// A live-lane server: the write path, plus the three endpoints a successful
// write re-mirrors from. `report` is what /api/config/live answers on 200;
// `status` + `detail` make it refuse instead. `fresh` / `mirrored` / `refreshed`
// are what the daemon reports AFTER the write — enumerations, State, and the
// config overlay — each defaulting to what the test seeded, so a fake that has
// not moved answers what the signals already hold.
/** @param {WireSeams} [seams] */
function liveWire({ status = 200, detail, report = { live: [] }, fresh, mirrored, file = FILE(), refreshed } = {}) {
  const w = { posts: /** @type {unknown[]} */ ([]) };
  // The read-side routes, each answering what its endpoint really wraps —
  // pending answers RAW, no {data}: the store mirrors it with the raw
  // unwrapper.
  /** @type {Record<string, () => unknown>} */
  const reads = {
    "/api/state": () => ok({ data: mirrored || STATE() }),
    "/api/enumerations": () => ok({ data: fresh || ENUMS() }),
    "/api/config": () => ok({ data: { fields: [], file: refreshed || file, active: "", profiles: null } }),
    "/api/config/pending": () => ok({ live: {}, http: {} }),
  };
  env.fetch = async (/** @type {string} */ path, /** @type {{ body?: string }} */ opts = {}) => {
    if (path === "/api/config/live") {
      w.posts.push(JSON.parse(String(opts.body)));
      return status === 200 ? ok({ report }) : bad(status, detail);
    }
    const answer = reads[path];
    return answer ? answer() : ok({});
  };
  return w;
}

// Total reset: module-level signals outlive a test, so a partial one makes cases
// pass alone and fail in sequence. `state` / `lists` / `file` seed the three
// source signals a rate control reads; the rest goes to the wire.
/** @param {ResetSeams} [seams] */
function reset({ state, lists, file = FILE(), ...wire } = {}) {
  engineState.value = state || STATE();
  enums.value = lists || ENUMS();
  config.value = { fields: [], file, active: "", profiles: null };
  liveErrors.value = {};
  liveBusy.value = "";
  return liveWire({ mirrored: state, file, ...wire });
}

/** @param {string} field */
const control = (field) => [...liveModel.value.pcmChain, ...liveModel.value.sdmChain].find((c) => c.field === field);

test("test_the_filter_control_reads_the_enum_id_the_engine_is_using", () => {
  reset();
  assert.equal(control("filter").value, "25");
});

test("test_the_junk_filter_control_speaks_list_indices", () => {
  reset();
  assert.equal(liveModel.value.junk.value, "1");
});

test("test_the_mode_control_reads_pcm_from_the_engines_mode_name", () => {
  reset();
  assert.equal(liveModel.value.mode.value, "pcm");
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

// --- a write the backend refused outright -------------------------------------
// A Control API command the daemon receives and never answers comes back as 503
// with FastAPI's `detail` string (a plain string, not the per-field object a 409
// carries). The write may well have landed on the engine before the silence — the
// daemon's own log shows the command accepted — so the store cannot assume
// nothing changed: it re-reads State rather than leaving the controls describing
// an engine that has moved.

const STALL_DETAIL = "State: no reply within 5.0s (the daemon may have restarted)";

// The engine ends up on filterNx index 0, enum ID 0 (`none`) — neither the 25 the
// signals were seeded with nor the 40 the write asked for. So this value can only
// come from an actual /api/state re-read: a store that kept the old value fails,
// and so does one that optimistically applied the written value.
const REFUSED = () => ({ status: 503, detail: STALL_DETAIL, mirrored: { ...STATE(), filterNx: "0" } });

test("test_a_write_the_backend_refused_re_reads_the_engines_state", async () => {
  reset(REFUSED());
  await writeLive("filter", "40");
  assert.equal(control("filter").value, "0");
});

// --- a write the daemon failed, in the page's words ------------------------------
// The control's error names it by the label the page gives it, never by the
// daemon's form key. A refusal carries the daemon's own reason; a setter the
// daemon stopped answering has none worth showing, so its error text stays off
// the control (the 200 report's `{ok: false, error, code}` per setter,
// architecture.md §8.2). The fixture invents both texts, so asserting them pins
// no shipped wording. The label is copy and stays out of every assertion
// (docs/testing.md rule 9): an error that names its control reads differently
// for two controls, and never shows a labelled control's form key.

// The PCM chain's two filter slots, by form key, each owned by a control on the
// page (tests/js/components/controls/combobox-favstars.test.js).
const PCM_1X = "filter1x";
const PCM_NX = "filter";
const REFUSAL = { code: "daemon_refused", error: "invalid filter" };
const SILENCE = { code: "daemon_unavailable", error: "SetFilter: no reply within 5.0s" };

/**
 * The per-control error a one-field write left behind.
 *
 * @param {{ code: string, error: string }} failure
 * @param {string} [setting]
 * @returns {Promise<string>}
 */
async function failedWrite(failure, setting = PCM_1X) {
  reset({ report: { live: [{ setting, ok: false, ...failure }] } });
  await writeLive(setting, "40");
  return String(liveErrors.value[setting]);
}

// A key no control on the page owns has no label to show, so its wire key stands in.
const UNLABELLED = "no_control_owns_this_key";

test("test_a_refused_write_no_control_owns_is_named_by_its_wire_key", async () => {
  const text = await failedWrite(REFUSAL, UNLABELLED);
  assert.ok(text.includes(UNLABELLED), text);
});

test("test_refusals_of_two_different_controls_read_differently", async () => {
  const oneX = await failedWrite(REFUSAL, PCM_1X);
  const nX = await failedWrite(REFUSAL, PCM_NX);
  assert.notEqual(oneX, nX);
});

test("test_a_control_the_daemon_refused_is_shown_without_its_form_key", async () => {
  const text = await failedWrite(REFUSAL);
  assert.ok(!text.includes(PCM_1X), text);
});

test("test_two_different_controls_the_daemon_stopped_answering_on_read_differently", async () => {
  const oneX = await failedWrite(SILENCE, PCM_1X);
  const nX = await failedWrite(SILENCE, PCM_NX);
  assert.notEqual(oneX, nX);
});

test("test_a_control_the_daemon_stopped_answering_on_is_shown_without_its_form_key", async () => {
  const text = await failedWrite(SILENCE);
  assert.ok(!text.includes(PCM_1X), text);
});

test("test_a_control_the_daemon_stopped_answering_on_does_not_show_the_setters_error", async () => {
  const text = await failedWrite(SILENCE);
  assert.ok(!text.includes(SILENCE.error), text);
});
