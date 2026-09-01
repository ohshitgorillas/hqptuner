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

import { engineState, enums, config } from "../../../hqptuner/static/store/signals.js";
import { liveModel } from "../../../hqptuner/static/store/live/model.js";
import { liveErrors, liveBusy } from "../../../hqptuner/static/store/live/state.js";
import { writeLive } from "../../../hqptuner/static/store/live/write.js";
import { bad, ok } from "../support/wire.js";

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
 * @typedef {{ setting: string, ok: boolean, error?: string }} LiveReportEntry
 */

/**
 * The /api/config/live success body.
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

// The SDM side of the engine. The rates enumeration is MODE-DEPENDENT (manual
// §4.6) — SDM mode enumerates DSD rates — and the daemon holds ONE rate pin
// that SetMode clears, so State can only ever answer for the running family.
// The dormant family's rate reaches the frontend the other way, through
// config.file (overrides.live_overrides), which is what these fixtures separate.
const SDM_RATES = [
  { index: "0", rate: "0" },
  { index: "1", rate: "12288000" },
  { index: "2", rate: "24576000" },
];
const SDM_ENUMS = () => ({ ...ENUMS(), rates: SDM_RATES, mode: { name: "SDM (DSD)" } });
const SDM_STATE = () => ({ ...STATE(), mode: "2", rate: "1", active_chain: "sdm" });

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
      return status === 200 ? ok(report) : bad(status, detail);
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

// --- the two rate columns, one engine pin -----------------------------------
// The engine is running SDM with DSD256 (12288000) pinned, and the config
// overlay carries a different rate for each family — so a column that read the
// wrong one of the two sources shows a rate no other fixture value matches.

const SDM_RUNNING = () => ({
  state: SDM_STATE(),
  lists: SDM_ENUMS(),
  file: { mode: "sdm", defaults_samplerate: "384000", defaults_bitrate: "24576000" },
});

test("test_the_dormant_pcm_column_reads_the_running_configs_limit", () => {
  reset(SDM_RUNNING());
  assert.equal(liveModel.value.pcmRate.value, "384000");
});

test("test_the_dormant_sdm_column_reads_the_running_configs_limit", () => {
  // The mirror of the case above, with the engine in PCM: a store that sourced
  // one column from State and the other from the overlay regardless of which
  // family is running passes one of these two and fails the other.
  reset({ file: { mode: "pcm", defaults_bitrate: "24576000" } });
  assert.equal(liveModel.value.sdmRate.value, "24576000");
});

test("test_the_running_familys_column_reads_the_engines_own_pin", () => {
  reset(SDM_RUNNING());
  assert.equal(liveModel.value.sdmRate.value, "12288000");
});

// The engine ends a mode write in the other family, so the column that just went
// dormant has no State to read and the overlay it reads instead has moved: the
// daemon answers /api/config with the pin LIVE remembered for it. Asserting the
// re-pull happened would go green on a store that threw the answer away.

test("test_a_mode_write_adopts_the_config_overlay_it_changed", async () => {
  reset({
    ...SDM_RUNNING(),
    mirrored: STATE(),
    refreshed: { mode: "pcm", defaults_samplerate: "384000", defaults_bitrate: "49152000" },
  });
  await writeLive("mode", "pcm");
  assert.equal(liveModel.value.sdmRate.value, "49152000");
});

test("test_a_rate_write_adopts_the_config_overlay_it_changed", async () => {
  reset({
    file: { mode: "pcm", defaults_bitrate: "3072000" },
    refreshed: { mode: "pcm", defaults_bitrate: "6144000" },
  });
  await writeLive("rate", "192000");
  assert.equal(liveModel.value.sdmRate.value, "6144000");
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
