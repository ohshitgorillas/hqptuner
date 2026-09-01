// Behavioral suite for the LIVE page's two rate menus — store/live/rates.js's
// `pcmRate` / `sdmRate`: which of them a user may edit, which tiers each one
// offers as reachable, and which source each column's own value comes from.
//
// The rates enumeration is MODE-DEPENDENT (protocol.md §6): the engine
// enumerates rates for the family it has LOADED and says nothing about the
// other one, and the list narrows further with the transport and the resampling
// filter (manual p.18 §4.4), so it can legitimately come back with almost
// nothing in it. `RatesItem` carries neither name nor value — it is
// `<RatesItem index rate/>`, the rate in Hz, index 0 meaning auto — and `State`
// reports the LIST INDEX rather than the Hz (protocol.md §4/§6), so every
// fixture below gives a rate an index that is not its value: one where the two
// coincided could not tell a correct join from no join at all.
//
// The menus name a TIER, not a frequency. Every tier has a 44.1k and a 48k
// member and the menu carries the 48k one, so DSD512 is 24576000 in the menu
// and 22579200 as the same tier's 44.1k twin. REACHABILITY and the RATE SENT
// are two separate questions:
//
//   - a tier is reachable when the engine's list holds EITHER of its members,
//     and grayed with a reason only when it holds NEITHER. A tier the engine is
//     offering at one of its two rates is a tier the engine is offering, so the
//     source playing cannot take an entry out of reach. This rule is scoped to
//     the column for the family the engine is RUNNING, and only that one: the
//     engine enumerates rates for the loaded family and says nothing about the
//     other, so there is no list the DORMANT column could be judged against and
//     it is offered whole, every tier reachable. The dormant-column cases below
//     are not an exception to the either-member rule — they are the case where
//     the rule has nothing to speak about.
//   - which member actually leaves the browser does NOT depend on the source:
//     the tier's own 48k member when the engine's list holds it, otherwise the
//     tier's 44.1k member when the list holds only that one, otherwise the 48k
//     member regardless. Those sends are pinned at the wire, on `w.posts`.
//
// A tier the engine is not offering is LISTED and grayed, never dropped: an
// entry that has vanished reads as a rate this build does not support rather
// than one the engine is not offering right now. Every "grays nothing" case is
// therefore paired with one that finds the entry through `optionFor`, which
// throws when the menu has lost it — a store that filtered instead of graying
// passes a count of zero and fails those.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire — the exported `engineState` / `engineStatus` / `enums` / `config`
// signals carry the shapes /api/state, /api/status, /api/enumerations and
// /api/config actually serve, the one write goes out over a faked
// `globalThis.fetch` on the real REST path, and no store function is stubbed.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/liverate.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { engineState, engineStatus, enums, config } from "../../../hqptuner/static/store/signals.js";
import { liveModel } from "../../../hqptuner/static/store/live/model.js";
import { liveErrors, liveBusy } from "../../../hqptuner/static/store/live/state.js";
import { writeLive } from "../../../hqptuner/static/store/live/write.js";
import { ok } from "../support/wire.js";

/**
 * The globals a fake wire installs a `fetch` on, viewed as an optional
 * member: the DOM lib declares it returning a real `Response`, which this
 * fake does not build.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;

/**
 * One filter/shaper/junk-filter enum entry the engine reports: enum ID
 * differs from list index throughout.
 *
 * @typedef {{ index: string, value: string, name: string }} EnumItem
 */

/**
 * One `<RatesItem index rate/>` — no name and no value (protocol.md §4/§6).
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
 * The config-file overlay keyed by form field: `FILE()` always carries the
 * mode plus both rate limits.
 *
 * @typedef {{ mode: string, defaults_samplerate: string, defaults_bitrate: string }} FileOverlay
 */

/**
 * The /api/status payload while a track plays — `metadata.samplerate` is
 * absent when the daemon has been given no source rate at all.
 *
 * @typedef {{ status: { active_rate: string }, metadata: { samplerate?: string, bits: string } }} EngineStatus
 */

/**
 * One scenario `reset()` drives the whole suite from.
 *
 * @typedef {{ state: EngineState, lists: Enums, file: FileOverlay, status?: EngineStatus | null }} Scenario
 */

/**
 * A rate menu entry, as `optionFor` / `marks` / `markedCount` read it.
 *
 * @typedef {{ value: string | number, disabled?: boolean, reason?: string }} RateOption
 */

/**
 * A rate column carrying its own menu.
 *
 * @typedef {{ field?: string, options: RateOption[] }} RateColumn
 */

// The chain enumerations play no part here; they are present because the store
// reads one engine payload. Enum ID differs from list index throughout.
const FILTERS = [
  { index: "0", value: "0", name: "none" },
  { index: "1", value: "40", name: "poly-sinc-gauss-long" },
];
const SHAPERS = [{ index: "0", value: "5", name: "NS9" }];
const JUNK = [{ index: "0", value: "0", name: "none" }];

// Tier menu members, 48k side (settings-classification §Rate per-family).
const PCM_2X = "96000";
const PCM_4X = "192000";
const PCM_8X = "384000";
const DSD256 = "12288000";
const DSD512 = "24576000";
const DSD1024 = "49152000";
// The same tiers by their 44.1k members. Twin resolution is a rule about tiers,
// not about DSD, so the PCM side is exercised too: an implementation whose twin
// table covers the DSD rates alone, or one hard-coding this single pair, passes
// every DSD case here and gets 192000 wrong.
const DSD512_44K = "22579200";
const PCM_4X_44K = "176400";

/**
 * `<RatesItem index rate/>`, in list order, index 0 being auto.
 *
 * @param {...string} hz
 * @returns {RateItem[]}
 */
const rates = (...hz) => ["0", ...hz].map((rate, i) => ({ index: String(i), rate }));

/**
 * @param {string} modeName
 * @param {RateItem[]} list
 * @returns {Enums}
 */
const ENUMS = (modeName, list) => ({
  filters: FILTERS,
  shapers: SHAPERS,
  rates: list,
  junk_filters: JUNK,
  mode: { name: modeName },
});

// State reports the rate as a LIST INDEX and answers only for the family the
// engine is running (settings-classification.md: one pin, cleared by SetMode).
/**
 * @param {{ mode: string, chain: string | null, rate: string }} seams
 * @returns {EngineState}
 */
const STATE = ({ mode, chain, rate }) => ({
  mode,
  filter1x: "0",
  filterNx: "1",
  shaper: "0",
  rate,
  filter_junk: "0",
  adaptive: "0",
  volume: "-10.0",
  active_chain: chain,
});

// The running configuration with LIVE's own overrides on top, keyed by form
// field: the PCM rate limit is `defaults_samplerate`, the SDM one
// `defaults_bitrate`. Each scenario gives these numbers no other source in the
// fixture carries, so a column reading the wrong one shows a rate nothing else
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
});

// What /api/status serves while a 44.1 kHz track plays. The SOURCE's own rate
// is `metadata.samplerate`; `status.active_rate` is what the engine is putting
// out. The member sent never depends on it: a store that resolved the tier
// against the source would send 22579200 under this fixture.
/**
 * @param {string} out
 * @returns {EngineStatus}
 */
const SOURCE_44K = (out) => ({ status: { active_rate: out }, metadata: { samplerate: "44100", bits: "24" } });

// A live-lane server: the one POST a rate edit takes, plus the endpoints the
// store re-mirrors from afterwards, each answering what the scenario seeded so
// a fake that has not moved says what the signals already hold. `w.posts` is
// what actually left the browser.
/**
 * @param {{ state: EngineState, lists: Enums, file: FileOverlay }} seams
 * @returns {{ posts: unknown[] }}
 */
function liveWire({ state, lists, file }) {
  const w = { posts: /** @type {unknown[]} */ ([]) };
  env.fetch = async (/** @type {string} */ path, /** @type {{ body?: string }} */ opts = {}) => {
    if (path === "/api/config/live") {
      w.posts.push(JSON.parse(String(opts.body)));
      return ok({ live: [] });
    }
    if (path === "/api/state") return ok({ data: state });
    if (path === "/api/enumerations") return ok({ data: lists });
    if (path === "/api/config") return ok({ data: { fields: [], file, active: "", profiles: null } });
    // Pending answers RAW — the store mirrors it with the raw unwrapper.
    if (path === "/api/config/pending") return ok({ live: {}, http: {} });
    return ok({});
  };
  return w;
}

// Total reset: module-level signals outlive a test, so a partial one makes
// cases pass alone and fail in sequence. `status` defaults to null — the engine
// reporting nothing playing, so no source's family answers for the send.
/**
 * @param {Scenario} seams
 * @returns {{ posts: unknown[] }}
 */
function reset({ state, lists, file, status = null }) {
  const w = liveWire({ state, lists, file });
  engineState.value = state;
  engineStatus.value = status;
  enums.value = lists;
  config.value = { fields: [], file, active: "", profiles: null };
  liveErrors.value = {};
  liveBusy.value = "";
  return w;
}

// --- the scenarios ------------------------------------------------------------

// The engine runs SDM and offers DSD256 alone; DSD512 is a tier it does not
// enumerate. The configuration carries a different number for each family, so
// neither column can borrow the other's or the engine's by accident.
const SDM_RUNNING = () => ({
  state: STATE({ mode: "2", chain: "sdm", rate: "1" }),
  lists: ENUMS("SDM (DSD)", rates(DSD256)),
  file: FILE("sdm", PCM_8X, DSD1024),
});

// The mirror, engine in PCM offering 2x alone.
const PCM_RUNNING = () => ({
  state: STATE({ mode: "1", chain: "pcm", rate: "1" }),
  lists: ENUMS("PCM", rates(PCM_2X)),
  file: FILE("pcm", PCM_4X, DSD512),
});

// The engine runs SDM and enumerates the DSD512 tier by its 44.1k member alone.
// One of the tier's two members is listed, so the tier is reachable whatever is
// playing; with nothing playing the source's own member is the 48k one, which
// the list does not hold, so the write falls to the other member.
/**
 * @param {{ status?: EngineStatus }} [over]
 * @returns {Scenario}
 */
const SDM_LIST_44K = (over = {}) => ({
  state: STATE({ mode: "2", chain: "sdm", rate: "1" }),
  lists: ENUMS("SDM (DSD)", rates(DSD512_44K)),
  file: FILE("sdm", PCM_8X, DSD1024),
  ...over,
});

// The PCM mirror of SDM_LIST_44K: the engine runs PCM and enumerates the 192000
// tier by its 44.1k member 176400 alone. Nothing is playing, so the source's
// member is the 48k one the list is missing and the write falls to the other.
/**
 * @param {{ status?: EngineStatus }} [over]
 * @returns {Scenario}
 */
const PCM_LIST_44K = (over = {}) => ({
  state: STATE({ mode: "1", chain: "pcm", rate: "1" }),
  lists: ENUMS("PCM", rates(PCM_4X_44K)),
  file: FILE("pcm", PCM_8X, DSD512),
  ...over,
});

// The mirror: the engine enumerates DSD512 by its 48k member alone, and is
// putting that same 48k rate out, while the source is 44.1 kHz — so the member
// that would be sent is the one the list is missing.
const SDM_LIST_48K_ON_44K_SOURCE = () => ({
  state: STATE({ mode: "2", chain: "sdm", rate: "1" }),
  lists: ENUMS("SDM (DSD)", rates(DSD512)),
  file: FILE("sdm", PCM_8X, DSD1024),
  status: SOURCE_44K(DSD512),
});

// A list with nothing in it but auto — the near-empty case the transport and
// filter dependency produces (manual p.18 §4.4). One per family, because the
// rule has to hold on the column whose family is RUNNING: the dormant column is
// ungrayed for its own separate reason and cannot show this.
const AUTO_ONLY_IN_PCM = () => ({
  state: STATE({ mode: "1", chain: "pcm", rate: "0" }),
  lists: ENUMS("PCM", rates()),
  file: FILE("pcm", PCM_4X, DSD512),
});
const AUTO_ONLY_IN_SDM = () => ({
  state: STATE({ mode: "2", chain: "sdm", rate: "0" }),
  lists: ENUMS("SDM (DSD)", rates()),
  file: FILE("sdm", PCM_4X, DSD512),
});

// [source] before playback starts: the configured mode is auto and no chain is
// loaded, so neither family is the running one and the engine's current list is
// all there is to judge by. It carries PCM rates, being what the engine has.
const NOTHING_LOADED = () => ({
  state: STATE({ mode: "0", chain: null, rate: "0" }),
  lists: ENUMS("[source]", rates(PCM_2X)),
  file: FILE("auto", PCM_4X, DSD512),
});

// --- reading the menus --------------------------------------------------------

// A menu entry by the tier it names. A miss throws rather than quietly
// measuring nothing: a menu that has lost a tier must fail loudly.
/**
 * @param {RateColumn} control
 * @param {string} value
 * @returns {RateOption}
 */
function optionFor(control, value) {
  const hit = control.options.find((o) => String(o.value) === value);
  if (!hit) throw new Error(`the rate menu offers no ${value} entry`);
  return hit;
}

// The two marks an entry can carry, read as a pair: whether it can be picked,
// and what it says about itself. A grayed entry must carry BOTH — an entry
// disabled without a reason leaves the user guessing, and a reason on an entry
// that is still selectable grays nothing.
// The reason's wording is owner copy (docs/testing.md rule 9), so the pair
// records only that one is there.
/** @param {RateOption} o */
const marks = (o) => [Boolean(o.disabled), o.reason ? "reason" : null];
const GRAYED = [true, "reason"];
const REACHABLE = [false, null];

/** @param {RateColumn} control */
const markedCount = (control) => control.options.filter((o) => o.disabled || o.reason).length;

// --- both columns stay editable -----------------------------------------------
// HQPTuner honors every user action; an edit to the family the engine is not
// running is remembered and asserted when that family loads, so there is
// nothing to disable.

test("test_the_pcm_rate_column_is_editable_while_the_engine_runs_sdm", () => {
  reset(SDM_RUNNING());
  assert.equal(Boolean(liveModel.value.pcmRate.disabled), false);
});

test("test_the_sdm_rate_column_is_editable_while_the_engine_runs_sdm", () => {
  reset(SDM_RUNNING());
  assert.equal(Boolean(liveModel.value.sdmRate.disabled), false);
});

test("test_the_sdm_rate_column_is_editable_while_the_engine_runs_pcm", () => {
  reset(PCM_RUNNING());
  assert.equal(Boolean(liveModel.value.sdmRate.disabled), false);
});

test("test_the_pcm_rate_column_is_editable_while_the_engine_runs_pcm", () => {
  reset(PCM_RUNNING());
  assert.equal(Boolean(liveModel.value.pcmRate.disabled), false);
});

test("test_an_edit_to_the_dormant_pcm_column_goes_out_on_the_live_lane", async () => {
  // The four cases above read a property, which a model that never sets it at
  // all also satisfies. This is the same claim made at the wire: the engine is
  // running SDM, and the PCM column's edit still leaves the browser.
  const w = reset(SDM_RUNNING());
  const { field } = liveModel.value.pcmRate;
  await writeLive(field, PCM_4X);
  assert.deepEqual(w.posts, [{ fields: { [field]: PCM_4X } }]);
});

// --- the column for the family the engine is not running ----------------------
// The engine enumerates rates for the loaded family only, so it holds no list
// the other family can be judged against and nothing there may be grayed.

test("test_the_dormant_pcm_column_grays_no_tier_while_the_engine_runs_sdm", () => {
  // The engine's list is all DSD; a column judged against it would gray every
  // PCM tier it offers.
  reset(SDM_RUNNING());
  assert.equal(markedCount(liveModel.value.pcmRate), 0);
});

test("test_the_dormant_sdm_column_grays_no_tier_while_the_engine_runs_pcm", () => {
  reset(PCM_RUNNING());
  assert.equal(markedCount(liveModel.value.sdmRate), 0);
});

test("test_the_dormant_pcm_column_still_offers_a_tier_the_engine_does_not_enumerate", () => {
  // 96000 is nowhere in the engine's DSD list. A store that dropped what it
  // could not vouch for instead of leaving it reachable counts zero grayed
  // entries above and loses this one entirely.
  reset(SDM_RUNNING());
  assert.deepEqual(marks(optionFor(liveModel.value.pcmRate, PCM_2X)), REACHABLE);
});

test("test_the_dormant_sdm_column_still_offers_a_tier_the_engine_does_not_enumerate", () => {
  reset(PCM_RUNNING());
  assert.deepEqual(marks(optionFor(liveModel.value.sdmRate, DSD256)), REACHABLE);
});

// --- the column for the family the engine is running --------------------------

test("test_the_running_sdm_column_grays_a_tier_the_engine_does_not_enumerate", () => {
  reset(SDM_RUNNING());
  assert.deepEqual(marks(optionFor(liveModel.value.sdmRate, DSD512)), GRAYED);
});

test("test_the_running_sdm_column_leaves_an_enumerated_tier_reachable", () => {
  // The other half of the judgment: a column that grayed its whole menu would
  // pass the case above and fail this one.
  reset(SDM_RUNNING());
  assert.deepEqual(marks(optionFor(liveModel.value.sdmRate, DSD256)), REACHABLE);
});

test("test_the_running_pcm_column_grays_a_tier_the_engine_does_not_enumerate", () => {
  reset(PCM_RUNNING());
  assert.deepEqual(marks(optionFor(liveModel.value.pcmRate, PCM_8X)), GRAYED);
});

test("test_the_running_pcm_column_leaves_an_enumerated_tier_reachable", () => {
  reset(PCM_RUNNING());
  assert.deepEqual(marks(optionFor(liveModel.value.pcmRate, PCM_2X)), REACHABLE);
});

// --- either member listed makes the tier reachable -----------------------------
// One engine list, one menu entry, two sources: the entry comes out reachable
// both ways round, because the engine offering the tier at one of its two rates
// is the engine offering the tier. What the source changes is the send, pinned
// at the wire further down.

test("test_with_nothing_playing_a_tier_the_engine_lists_only_at_44_1k_is_reachable", () => {
  // Nothing is playing, so the source's member is the 48k one and the engine's
  // list holds 22579200 alone — the other member. A store graying on the
  // source's member alone puts a tier the engine is enumerating out of reach.
  reset(SDM_LIST_44K());
  assert.deepEqual(marks(optionFor(liveModel.value.sdmRate, DSD512)), REACHABLE);
});

test("test_under_a_44_1k_source_a_tier_the_engine_offers_at_44_1k_is_reachable", () => {
  // Same list, same menu entry, a 44.1 kHz source: the engine offers exactly
  // the member such a source would send. Graying it here would put the rate the
  // engine is enumerating out of reach on every 44.1 kHz track.
  reset(SDM_LIST_44K({ status: SOURCE_44K(DSD256) }));
  assert.deepEqual(marks(optionFor(liveModel.value.sdmRate, DSD512)), REACHABLE);
});

test("test_under_a_44_1k_source_a_tier_the_engine_offers_only_at_48k_is_reachable", () => {
  // The mirror: the engine enumerates 24576000 alone while a 44.1 kHz source
  // plays. The member matching the source is missing, and the tier is offered
  // all the same — one listed member is enough. The send is the separate
  // question, pinned below.
  reset(SDM_LIST_48K_ON_44K_SOURCE());
  assert.deepEqual(marks(optionFor(liveModel.value.sdmRate, DSD512)), REACHABLE);
});

test("test_with_nothing_playing_a_pcm_tier_the_engine_lists_only_at_44_1k_is_reachable", () => {
  // The PCM half of the same rule: the engine offers 176400 alone, and the
  // 192000 tier the menu names is reachable through it. A twin table covering
  // the DSD rates alone grays this one.
  reset(PCM_LIST_44K());
  assert.deepEqual(marks(optionFor(liveModel.value.pcmRate, PCM_4X)), REACHABLE);
});

test("test_a_grayed_tier_is_still_listed_in_the_menu", () => {
  // The engine offers DSD256 alone, so neither DSD512 member is listed and the
  // entry grays — and it is still an entry. A store that dropped what it could
  // not vouch for reads as a rate this build does not support rather than one
  // the engine is not offering right now.
  reset(SDM_RUNNING());
  const found = liveModel.value.sdmRate.options.some((/** @type {RateOption} */ o) => String(o.value) === DSD512);
  assert.ok(found, "the grayed DSD512 tier was dropped from the menu instead of listed");
});

// --- which member of a picked tier actually leaves the browser ----------------
// The menu carries the 48k member as the tier's name, so every write below asks
// for the same DSD512 entry and the number on the wire is the store's whole
// answer. Order: the source's own member if the engine lists it, else the
// tier's other member if the engine lists that, else the source's own member
// regardless.

test("test_a_write_of_a_tier_the_engine_lists_only_at_44_1k_sends_the_44_1k_member", async () => {
  // Nothing playing, so the source's member is 24576000 and the engine does not
  // list it; 22579200 is listed, so that is what `SetRate` can actually take.
  const w = reset(SDM_LIST_44K());
  await writeLive("rate", DSD512);
  assert.deepEqual(w.posts, [{ fields: { rate: DSD512_44K } }]);
});

test("test_a_write_of_a_pcm_tier_the_engine_lists_only_at_44_1k_sends_the_44_1k_member", async () => {
  // The PCM half of the send rule. Nothing is playing, so the source's member
  // is 192000 and the engine does not list it; 176400 is listed, so that is
  // what `SetRate` can take. A store that resolves twins for DSD alone, or
  // hard-codes the DSD512 pair, sends 192000 here.
  const w = reset(PCM_LIST_44K());
  await writeLive("rate", PCM_4X);
  assert.deepEqual(w.posts, [{ fields: { rate: PCM_4X_44K } }]);
});

test("test_under_a_44_1k_source_a_write_of_a_tier_listed_only_at_48k_sends_the_48k_member", async () => {
  // The mirror: the source's member is 22579200 and the engine does not list
  // it, so the tier's other member — the one the engine does list — goes out.
  const w = reset(SDM_LIST_48K_ON_44K_SOURCE());
  await writeLive("rate", DSD512);
  assert.deepEqual(w.posts, [{ fields: { rate: DSD512 } }]);
});

test("test_with_nothing_playing_a_write_of_a_tier_the_engine_lists_at_neither_member_sends_the_48k_member", async () => {
  // The engine offers DSD256 alone, so neither member can be found and the
  // tier goes out unchanged — the number the menu itself carries.
  const w = reset(SDM_RUNNING());
  await writeLive("rate", DSD512);
  assert.deepEqual(w.posts, [{ fields: { rate: DSD512 } }]);
});

// --- a list with nothing to judge by ------------------------------------------

test("test_an_auto_only_rate_list_grays_no_pcm_tier", () => {
  reset(AUTO_ONLY_IN_PCM());
  assert.equal(markedCount(liveModel.value.pcmRate), 0);
});

test("test_an_auto_only_rate_list_grays_no_sdm_tier", () => {
  reset(AUTO_ONLY_IN_SDM());
  assert.equal(markedCount(liveModel.value.sdmRate), 0);
});

test("test_an_auto_only_rate_list_still_offers_the_pcm_tiers", () => {
  reset(AUTO_ONLY_IN_PCM());
  assert.deepEqual(marks(optionFor(liveModel.value.pcmRate, PCM_8X)), REACHABLE);
});

test("test_an_auto_only_rate_list_still_offers_the_sdm_tiers", () => {
  reset(AUTO_ONLY_IN_SDM());
  assert.deepEqual(marks(optionFor(liveModel.value.sdmRate, DSD512)), REACHABLE);
});

// --- which source each column's value comes from ------------------------------
// One pin exists in the engine and it answers for the running family alone; the
// other family's is reported by the running configuration.

test("test_the_running_sdm_column_shows_the_engines_own_pin", () => {
  // State says index 1 of the SDM list, which is DSD256; the configuration says
  // DSD1024, so a column reading it here shows a rate the engine is not on.
  reset(SDM_RUNNING());
  assert.equal(liveModel.value.sdmRate.value, DSD256);
});

test("test_the_dormant_pcm_column_shows_the_running_configurations_pcm_limit", () => {
  reset(SDM_RUNNING());
  assert.equal(liveModel.value.pcmRate.value, PCM_8X);
});

test("test_the_running_pcm_column_shows_the_engines_own_pin", () => {
  reset(PCM_RUNNING());
  assert.equal(liveModel.value.pcmRate.value, PCM_2X);
});

test("test_a_pin_reported_at_44_1k_shows_as_its_tier", () => {
  // The engine is pinned to 22579200 under a 44.1 kHz source; the menus speak
  // tiers on both sides, so the column has to show the DSD512 entry's own
  // 24576000 — a column showing the raw 22579200 against that menu reads as
  // nothing selected. The configuration says DSD1024, so it is not the source
  // of this either.
  reset(SDM_LIST_44K({ status: SOURCE_44K(DSD512_44K) }));
  assert.equal(liveModel.value.sdmRate.value, DSD512);
});

test("test_the_dormant_sdm_column_shows_the_running_configurations_sdm_limit", () => {
  // The mirror: a store that sourced one column from State and the other from
  // the configuration regardless of which family is running passes one of these
  // two and fails the other.
  reset(PCM_RUNNING());
  assert.equal(liveModel.value.sdmRate.value, DSD512);
});

// --- auto, before either chain is loaded --------------------------------------
// Neither family is the running one, so both columns are judged against the one
// list the engine currently holds.

test("test_with_no_chain_loaded_the_pcm_column_grays_a_tier_the_engine_does_not_enumerate", () => {
  reset(NOTHING_LOADED());
  assert.deepEqual(marks(optionFor(liveModel.value.pcmRate, PCM_8X)), GRAYED);
});

test("test_with_no_chain_loaded_the_pcm_column_leaves_an_enumerated_tier_reachable", () => {
  reset(NOTHING_LOADED());
  assert.deepEqual(marks(optionFor(liveModel.value.pcmRate, PCM_2X)), REACHABLE);
});

test("test_with_no_chain_loaded_the_sdm_column_grays_a_tier_the_engine_does_not_enumerate", () => {
  reset(NOTHING_LOADED());
  assert.deepEqual(marks(optionFor(liveModel.value.sdmRate, DSD256)), GRAYED);
});
