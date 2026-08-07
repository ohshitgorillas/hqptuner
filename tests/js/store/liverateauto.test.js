// Behavioral suite for the ONE setting the LIVE page refuses: the two output
// rate columns under the `[source]` output mode — store/live/rates.js's
// `pcmRate.disabled` / `.reason` / `.value` and their SDM mirrors.
//
// In `[source]` the engine accepts no rate over the wire at all (protocol.md
// §6: mid-playback SetRate requests for a lower rate moved neither the request
// slot nor the actual output, `result="OK"` both times). What governs the
// output rate there is the config limit — `defaults_samplerate` for PCM,
// `defaults_bitrate` for SDM — and the Control API has no command for it, so
// changing it is a config write and a daemon restart. That restart is why the
// LIVE page cannot offer the setting, and architecture.md §5 makes the gray
// carry a caption naming the restart and pointing at the Output tab: a control
// the user cannot use must say why.
//
// Two conflations this suite exists to catch, both named in architecture.md §5:
//
//   - the gray is the CONFIGURED MODE's, not the loaded chain's. In auto a
//     chain IS loaded and a source IS playing, and both columns gray anyway;
//     under an explicit PCM or SDM mode BOTH columns take edits — including the
//     DORMANT COLUMN, the one for the family the engine is not running, whose
//     edit is held until that family loads. (The loaded chain follows the
//     configured mode, so an explicit mode running the other family's chain is
//     not a state that exists; what the explicit-mode cases below pin is the
//     dormant column, never a dormant chain.)
//   - the chain is a different question from the rate. In auto the filter and
//     shaper controls stay live — the rate is the only thing the engine
//     refuses — so every chain control must come back ungrayed and unlabelled.
//
// `State` reports the rate as a LIST INDEX, not Hz (protocol.md §5), and
// `<RatesItem index rate/>` carries neither name nor value, so every fixture
// that reports a pin at all gives it an index that is not its own value: one
// where the two coincided could not tell a correct join from no join at all.
// The `[source]` fixtures report index 0, auto, because that is the only thing
// auto produces — the daemon clears the pin on the mode change and refuses new
// ones while `[source]` stands, so a fixture pairing auto with a live pin would
// pin behaviour no real daemon can show. The menus name a
// TIER, not a frequency, and carry the 48k member of each tier, so every source
// here is in the 48k family and no tier has to be re-resolved.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire — the exported `engineState` / `engineStatus` / `enums` / `config`
// signals carry the shapes /api/state, /api/status, /api/enumerations and
// /api/config actually serve, and no store function is stubbed. Every case here
// is read-side; nothing is written.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/liverateauto.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { engineState, engineStatus, enums, config, metadata } from "../../../hqptuner/static/store/signals.js";
import { liveModel } from "../../../hqptuner/static/store/live/model.js";
import { liveErrors, liveBusy } from "../../../hqptuner/static/store/live/state.js";
import { staticWire } from "../support/wire.js";
import {
  PCM_FILTERS,
  PCM_SHAPERS,
  SDM_FILTERS,
  SDM_SHAPERS,
  JUNK,
  formField,
  FORM,
  LISTS,
} from "../support/chainenums.js";

/** @typedef {import("../support/chainenums.js").EnumItem} EnumItem */

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
 *   volume: string,
 *   active_chain: string | null,
 * }} EngineState
 */

/**
 * The config-file overlay keyed by form field: the two rate limits plus
 * `FORM`'s own six keys, which `FILE()` spreads onto every fixture.
 *
 * @typedef {{
 *   mode: string,
 *   defaults_samplerate: string,
 *   defaults_bitrate: string,
 *   filter1x: string,
 *   filter: string,
 *   dither: string,
 *   oversampling1x: string,
 *   oversampling: string,
 *   modulator: string,
 * }} FileOverlay
 */

/**
 * The /api/status payload while a track plays.
 *
 * @typedef {{ status: { active_rate: string }, metadata: { samplerate: string, bits: string } }} EngineStatus
 */

/**
 * A rate column or chain control, as `liveModel` and `chainControl` hand one
 * back — the members these cases read off it.
 *
 * @typedef {{ field?: string, value?: string, disabled?: boolean, reason?: string }} Column
 */

/**
 * One scenario `reset()` drives the whole suite from.
 *
 * @typedef {{ state: EngineState, lists: Enums, file: FileOverlay, status?: EngineStatus | null }} Scenario
 */

// Tier menu members, 48k side (settings-classification §Rate per-family).
const PCM_2X = "96000";
const PCM_8X = "384000";
const DSD256 = "12288000";
const DSD1024 = "49152000";

/**
 * `<RatesItem index rate/>`, in list order, index 0 being auto.
 *
 * @param {...string} hz
 * @returns {RateItem[]}
 */
const rates = (...hz) => ["0", ...hz].map((rate, i) => ({ index: String(i), rate }));

// The engine's enumerations are MODE-DEPENDENT: it enumerates for the family it
// has loaded and says nothing about the other one (protocol.md §6). `mode.name`
// is the CONFIGURED output mode, which is `[source]` whatever chain the current
// source happens to have left loaded.
/**
 * @param {{ modeName: string, list: RateItem[], filters: EnumItem[], shapers: EnumItem[] }} seams
 * @returns {Enums}
 */
const ENUMS = ({ modeName, list, filters, shapers }) => ({
  filters,
  shapers,
  rates: list,
  junk_filters: JUNK,
  mode: { name: modeName },
});

// State reports list indices, and one rate pin, answering for the family the
// engine is running. `active_chain` is the chain actually loaded. Every index
// here has to exist in the enumeration the engine is CURRENTLY serving
// (protocol.md §5), and the two chains are different lengths, so `filterNx` is
// the caller's to supply: the PCM list runs 0-2, the SDM one 0-1.
/**
 * @param {{ mode: string, chain: string | null, rate: string, filterNx: string }} seams
 * @returns {EngineState}
 */
const STATE = ({ mode, chain, rate, filterNx }) => ({
  mode,
  filter1x: "1",
  filterNx,
  shaper: "1",
  rate,
  filter_junk: "0",
  adaptive: "0",
  volume: "-10.0",
  active_chain: chain,
});

const FIELDS = () => Object.entries(FORM).map(([name, value]) => formField(name, value, LISTS[name]));

// The running configuration with LIVE's overrides on top, keyed by form field.
// The two rate limits are the slots that govern the output rate in `[source]`,
// and each scenario gives them numbers no other source in the fixture carries,
// so a column reading the engine's pin instead shows a rate nothing else
// explains.
/**
 * @param {string} mode
 * @param {string} samplerate
 * @param {string} bitrate
 * @returns {FileOverlay}
 */
const FILE = (mode, samplerate, bitrate) => ({
  mode,
  defaults_samplerate: samplerate,
  defaults_bitrate: bitrate,
  ...FORM,
});

// What /api/status serves while a track plays: the SOURCE's own rate is
// `metadata.samplerate`, while `status.active_rate` is what the engine is
// putting out — a different number entirely with oversampling in the path. Both
// members here are 48k-family, so no tier has to be re-resolved to its 44.1k
// twin and the gray under test is the only thing in play.
/**
 * @param {string} out
 * @returns {EngineStatus}
 */
const PLAYING = (out) => ({ status: { active_rate: out }, metadata: { samplerate: "48000", bits: "24" } });

const METADATA = {
  settings: {
    output: { output_mode: { label: "Output mode", tooltip: "Selects default output mode." } },
    dsp: {
      filter_1x: { label: "1x filter", tooltip: "Oversampling filter for base-rate sources." },
      filter_nx: { label: "Nx filter", tooltip: "Oversampling filter above the base rates." },
      shaper: { label: "Dither", tooltip: "Noise shaping applied at the output word length." },
    },
    volume: { adaptive_volume: { label: "Adaptive volume", tooltip: "Applies the source's ReplayGain 2.0 offset." } },
  },
  filters: { filters: {}, aliases: {} },
  shapers: { pcm_dithers: {}, sdm_modulators: {} },
};

// Total reset: module-level signals outlive a test, so a partial one makes cases
// pass alone and fail in sequence. `status` defaults to null — the engine
// reporting nothing playing at all.
/** @param {Scenario} seams */
function reset({ state, lists, file, status = null }) {
  staticWire();
  engineState.value = state;
  engineStatus.value = status;
  enums.value = lists;
  metadata.value = METADATA;
  config.value = { fields: FIELDS(), file, active: "", profiles: null };
  liveErrors.value = {};
  liveBusy.value = "";
}

// --- the scenarios ------------------------------------------------------------

// `[source]` before playback starts: no chain loaded, nothing playing. The
// engine's current list carries PCM rates, being what it happens to hold.
const AUTO_IDLE = () => ({
  state: STATE({ mode: "0", chain: null, rate: "0", filterNx: "2" }),
  lists: ENUMS({ modeName: "[source]", list: rates(PCM_2X), filters: PCM_FILTERS, shapers: PCM_SHAPERS }),
  file: FILE("auto", PCM_8X, DSD1024),
});

// `[source]` mid-playback, with a PCM source having put the engine in the PCM
// chain — the case where a store that decided the gray from the LOADED CHAIN
// rather than the CONFIGURED MODE ungrays the PCM column. The rate index is 0,
// auto: in `[source]` the daemon holds no pin of its own, having cleared it on
// the mode change and refusing new ones while the mode stands, so this is the
// only state auto actually produces. The configuration's limits are therefore
// the only things that can answer for either column.
const AUTO_PCM_PLAYING = () => ({
  state: STATE({ mode: "0", chain: "pcm", rate: "0", filterNx: "2" }),
  lists: ENUMS({ modeName: "[source]", list: rates(PCM_2X), filters: PCM_FILTERS, shapers: PCM_SHAPERS }),
  file: FILE("auto", PCM_8X, DSD1024),
  status: PLAYING(PCM_2X),
});

// An explicit PCM mode, engine running and playing PCM. The SDM column is the
// family that is NOT running, and it still takes edits.
const PCM_MODE_PLAYING = () => ({
  state: STATE({ mode: "1", chain: "pcm", rate: "1", filterNx: "2" }),
  lists: ENUMS({ modeName: "PCM", list: rates(PCM_2X), filters: PCM_FILTERS, shapers: PCM_SHAPERS }),
  file: FILE("pcm", PCM_8X, DSD1024),
  status: PLAYING(PCM_2X),
});

// The mirror: an explicit SDM mode with the SDM chain running and playing, so
// the PCM column is the dormant one.
const SDM_MODE_PLAYING = () => ({
  state: STATE({ mode: "2", chain: "sdm", rate: "1", filterNx: "1" }),
  lists: ENUMS({ modeName: "SDM (DSD)", list: rates(DSD256), filters: SDM_FILTERS, shapers: SDM_SHAPERS }),
  file: FILE("sdm", PCM_8X, DSD1024),
  status: PLAYING(DSD256),
});

// --- reading the model --------------------------------------------------------

// A column's caption, normalised for matching. The exact sentence is the
// product's to word; what is pinned is what it has to SAY (architecture.md §5:
// names the restart, points at the Output tab), so these match on meaning and
// nothing more.
/** @param {Column} column */
const reasonOf = (column) => String(column.reason || "").toLowerCase();

// A chain control by its form field. A miss throws rather than quietly
// measuring nothing: a chain that has lost a control must fail loudly.
/**
 * @param {string} field
 * @returns {Column}
 */
function chainControl(field) {
  const all = [...liveModel.value.pcmChain, ...liveModel.value.sdmChain];
  const hit = all.find((c) => c.field === field);
  if (!hit) throw new Error(`the live model carries no ${field} control`);
  return hit;
}

// --- auto grays both rate columns ---------------------------------------------

test("test_the_pcm_rate_column_is_disabled_in_auto_output_mode", () => {
  reset(AUTO_IDLE());
  assert.equal(Boolean(liveModel.value.pcmRate.disabled), true);
});

test("test_the_sdm_rate_column_is_disabled_in_auto_output_mode", () => {
  reset(AUTO_IDLE());
  assert.equal(Boolean(liveModel.value.sdmRate.disabled), true);
});

// --- and says why -------------------------------------------------------------
// A control the user cannot use must say why; a gray with no caption leaves the
// user guessing at a refusal the engine, not HQPTuner, is making.

test("test_the_grayed_pcm_rate_column_carries_a_reason", () => {
  reset(AUTO_IDLE());
  assert.ok(reasonOf(liveModel.value.pcmRate).length > 0, "the grayed PCM rate column carries no reason at all");
});

test("test_the_grayed_sdm_rate_column_carries_a_reason", () => {
  reset(AUTO_IDLE());
  assert.ok(reasonOf(liveModel.value.sdmRate).length > 0, "the grayed SDM rate column carries no reason at all");
});

test("test_the_pcm_rate_reason_names_the_restart_the_change_would_cost", () => {
  // The rate limit is a config write, and the daemon self-restarts on it — the
  // whole reason the LIVE page will not offer the setting.
  reset(AUTO_IDLE());
  const said = reasonOf(liveModel.value.pcmRate);
  assert.ok(said.includes("restart"), `the PCM rate reason does not name the restart: ${JSON.stringify(said)}`);
});

test("test_the_sdm_rate_reason_names_the_restart_the_change_would_cost", () => {
  reset(AUTO_IDLE());
  const said = reasonOf(liveModel.value.sdmRate);
  assert.ok(said.includes("restart"), `the SDM rate reason does not name the restart: ${JSON.stringify(said)}`);
});

test("test_the_pcm_rate_reason_sends_the_user_to_the_output_tab", () => {
  // Naming the restart alone leaves the user stuck; the setting does exist, on
  // the tab that writes config and applies with a restart.
  reset(AUTO_IDLE());
  const said = reasonOf(liveModel.value.pcmRate);
  assert.ok(said.includes("output tab"), `the PCM rate reason names no destination: ${JSON.stringify(said)}`);
});

test("test_the_sdm_rate_reason_sends_the_user_to_the_output_tab", () => {
  reset(AUTO_IDLE());
  const said = reasonOf(liveModel.value.sdmRate);
  assert.ok(said.includes("output tab"), `the SDM rate reason names no destination: ${JSON.stringify(said)}`);
});

// --- the gray is the configured mode's, never the loaded chain's --------------
// Auto mid-playback: a chain IS loaded and a source IS playing — and the engine
// still accepts no rate, so both columns stay grayed. A store deciding this
// from `active_chain` ungrays the PCM one.

test("test_the_pcm_rate_column_stays_disabled_in_auto_with_a_pcm_chain_loaded_and_playing", () => {
  reset(AUTO_PCM_PLAYING());
  assert.equal(Boolean(liveModel.value.pcmRate.disabled), true);
});

test("test_the_sdm_rate_column_stays_disabled_in_auto_with_a_pcm_chain_loaded_and_playing", () => {
  reset(AUTO_PCM_PLAYING());
  assert.equal(Boolean(liveModel.value.sdmRate.disabled), true);
});

// --- a grayed column still reports what is in force ---------------------------
// What governs the rate in `[source]` is the config limit, so that limit is
// what a grayed column has to show. Blanking it, or showing auto, hides the
// setting the caption has just sent the user to go and change.

test("test_the_grayed_pcm_rate_column_shows_the_configurations_samplerate_limit", () => {
  // The engine reports rate index 0, auto — it holds no pin in `[source]` — so
  // `defaults_samplerate` is what is actually in force, and 384000 is the tier
  // the column has to name. A column reading the engine here shows auto, or
  // nothing at all.
  reset(AUTO_PCM_PLAYING());
  assert.equal(liveModel.value.pcmRate.value, PCM_8X);
});

test("test_the_grayed_sdm_rate_column_shows_the_configurations_bitrate_limit", () => {
  // The engine has the PCM chain loaded and cannot answer for SDM at all, so
  // `defaults_bitrate` is the only thing that can.
  reset(AUTO_PCM_PLAYING());
  assert.equal(liveModel.value.sdmRate.value, DSD1024);
});

// --- an explicit mode leaves both columns alone -------------------------------
// Under PCM or SDM the engine takes a rate on the wire, so both columns are
// editable. The load-bearing half of each pair is the DORMANT column — the one
// for the family the engine is not running, whose edit is held until that
// family loads — since a store that grayed what the engine cannot currently
// accept would take it out. The engine's loaded chain follows the configured
// mode, so each fixture runs the chain its mode names and the dormant column is
// simply the other one.

test("test_the_pcm_rate_column_is_editable_in_pcm_output_mode", () => {
  reset(PCM_MODE_PLAYING());
  assert.equal(Boolean(liveModel.value.pcmRate.disabled), false);
});

test("test_the_sdm_rate_column_is_editable_in_pcm_output_mode_while_pcm_plays", () => {
  reset(PCM_MODE_PLAYING());
  assert.equal(Boolean(liveModel.value.sdmRate.disabled), false);
});

test("test_the_pcm_rate_column_carries_no_reason_in_pcm_output_mode", () => {
  reset(PCM_MODE_PLAYING());
  assert.equal(liveModel.value.pcmRate.reason ?? "", "");
});

test("test_the_sdm_rate_column_carries_no_reason_in_pcm_output_mode_while_pcm_plays", () => {
  reset(PCM_MODE_PLAYING());
  assert.equal(liveModel.value.sdmRate.reason ?? "", "");
});

test("test_the_sdm_rate_column_is_editable_in_sdm_output_mode", () => {
  reset(SDM_MODE_PLAYING());
  assert.equal(Boolean(liveModel.value.sdmRate.disabled), false);
});

test("test_the_pcm_rate_column_is_editable_in_sdm_output_mode_while_sdm_plays", () => {
  reset(SDM_MODE_PLAYING());
  assert.equal(Boolean(liveModel.value.pcmRate.disabled), false);
});

test("test_the_sdm_rate_column_carries_no_reason_in_sdm_output_mode", () => {
  reset(SDM_MODE_PLAYING());
  assert.equal(liveModel.value.sdmRate.reason ?? "", "");
});

test("test_the_pcm_rate_column_carries_no_reason_in_sdm_output_mode_while_sdm_plays", () => {
  reset(SDM_MODE_PLAYING());
  assert.equal(liveModel.value.pcmRate.reason ?? "", "");
});

// --- the chain is a different question ----------------------------------------
// In auto a chain IS loaded and takes filter and shaper edits live; the rate is
// the only setting the engine refuses. These two cases are a GUARD, and only a
// guard: they exist so that the rate gray cannot leak sideways onto the chain
// controls, one on a filter and one on a shaper, covering both marks the gray
// would carry. They are weak evidence on their own — no chain control ever
// grays on the LIVE page, so there is no positive counterpart to pair them
// with, and a model that never set `disabled` or `reason` on a chain control at
// all would satisfy them too. Chain behaviour proper — which source each column
// reads, which options it offers, that a dormant control is still a control —
// belongs to livechain.test.js and is not restated here.

test("test_the_chains_filter_control_is_editable_in_auto_output_mode", () => {
  reset(AUTO_PCM_PLAYING());
  assert.equal(Boolean(chainControl("filter").disabled), false);
});

test("test_the_chains_shaper_control_carries_no_reason_in_auto_output_mode", () => {
  reset(AUTO_PCM_PLAYING());
  assert.equal(chainControl("dither").reason ?? "", "");
});
