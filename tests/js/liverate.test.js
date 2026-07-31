// Behavioral suite for the LIVE page's two rate menus — store/live.js's
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
// and 22579200 on a 44.1 kHz source. Which member would actually be SENT
// depends on the SOURCE the engine reports playing — a source rate that divides
// by 44100 takes the 44.1k member, anything else the 48k one — and that member
// is what `SetRate` has to find in the engine's list, so it is what a tier is
// judged by. Same list and same menu with a different source playing therefore
// come out opposite ways round, which is what the pairs of cases below pin. The
// source is not the engine's own output rate: oversampling puts those two in
// different families routinely, so every playing fixture here separates them.
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
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/liverate.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { engineState, engineStatus, enums, config } from "../../hqptuner/static/store/state.js";
import { liveModel, liveErrors, liveBusy, writeLive } from "../../hqptuner/static/store/live.js";
import { ok } from "./wire.js";

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
// The same DSD512 tier as a 44.1 kHz source reaches it.
const DSD512_44K = "22579200";

// `<RatesItem index rate/>`, in list order, index 0 being auto.
const rates = (...hz) => ["0", ...hz].map((rate, i) => ({ index: String(i), rate }));

const ENUMS = (modeName, list) => ({
  filters: FILTERS,
  shapers: SHAPERS,
  rates: list,
  junk_filters: JUNK,
  mode: { name: modeName },
});

// State reports the rate as a LIST INDEX and answers only for the family the
// engine is running (settings-classification.md: one pin, cleared by SetMode).
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
const FILE = (mode, samplerate, bitrate) => ({
  mode,
  defaults_samplerate: samplerate,
  defaults_bitrate: bitrate,
});

// What /api/status serves while a track plays. The SOURCE's own rate is
// `metadata.samplerate`; `status.active_rate` is what the engine is putting
// out, a different number entirely with oversampling in the path. The tier
// resolves against the source — settings-classification §LIVE: "engine report
// what is playing, so store/live.js resolve the picked tier to that source's
// own member before sending (DSD512 on 44.1k track → 22579200)" — so the
// caller names the output rate separately, and the cases below put it in the
// family the source is NOT in.
const SOURCE_44K = (out) => ({ status: { active_rate: out }, metadata: { samplerate: "44100", bits: "24" } });

// Playing, with no source rate reported at all — metadata the daemon has not
// been given. The engine's own output rate is then all there is to go on.
const NO_SOURCE_RATE = (out) => ({ status: { active_rate: out }, metadata: { bits: "24" } });

// A live-lane server: the one POST a rate edit takes, plus the endpoints the
// store re-mirrors from afterwards, each answering what the scenario seeded so
// a fake that has not moved says what the signals already hold. `w.posts` is
// what actually left the browser.
function liveWire({ state, lists, file }) {
  const w = { posts: [] };
  globalThis.fetch = async (path, opts = {}) => {
    if (path === "/api/config/live") {
      w.posts.push(JSON.parse(opts.body));
      return ok({ live: [] });
    }
    if (path === "/api/state") return ok({ data: state });
    if (path === "/api/enumerations") return ok({ data: lists });
    if (path === "/api/config") return ok({ data: { fields: [], file, active: "", profiles: null } });
    return ok({});
  };
  return w;
}

// Total reset: module-level signals outlive a test, so a partial one makes
// cases pass alone and fail in sequence. `status` defaults to null — the engine
// reporting nothing playing, so no source's family answers for the send.
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
// With nothing playing the 48k member is what would be sent, and the engine
// does not offer it; with a 44.1 kHz source playing the 44.1k member is what
// would be sent, and it does.
const SDM_LIST_44K = (over = {}) => ({
  state: STATE({ mode: "2", chain: "sdm", rate: "1" }),
  lists: ENUMS("SDM (DSD)", rates(DSD512_44K)),
  file: FILE("sdm", PCM_8X, DSD1024),
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
function optionFor(control, value) {
  const hit = control.options.find((o) => String(o.value) === value);
  if (!hit) throw new Error(`the rate menu offers no ${value} entry`);
  return hit;
}

// The two marks an entry can carry, read as a pair: whether it can be picked,
// and what it says about itself. A grayed entry must carry BOTH — an entry
// disabled without a reason leaves the user guessing, and a reason on an entry
// that is still selectable grays nothing.
const marks = (o) => [Boolean(o.disabled), o.reason || null];
const GRAYED = [true, "unavailable"];
const REACHABLE = [false, null];

const markedCount = (control) => control.options.filter((o) => o.disabled || o.reason).length;

// --- both columns stay editable -----------------------------------------------
// HQPTuner honours every user action; an edit to the family the engine is not
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

test("test_a_grayed_tier_gives_unavailable_as_its_reason", () => {
  reset(SDM_RUNNING());
  assert.equal(optionFor(liveModel.value.sdmRate, DSD512).reason, "unavailable");
});

test("test_the_running_sdm_column_leaves_an_enumerated_tier_reachable", () => {
  // The other half of the judgement: a column that grayed its whole menu would
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

// --- a tier is judged by the member that would be sent ------------------------
// One engine list, one menu entry, two sources: the member `SetRate` would have
// to find in the list is the 48k one with nothing playing and the 44.1k one
// under a 44.1 kHz source, so the same DSD512 entry goes both ways.

test("test_with_nothing_playing_a_tier_the_engine_offers_only_at_44_1k_is_grayed", () => {
  // Nothing is playing, so 24576000 is what would be sent — and the engine's
  // list holds 22579200 alone.
  reset(SDM_LIST_44K());
  assert.deepEqual(marks(optionFor(liveModel.value.sdmRate, DSD512)), GRAYED);
});

test("test_under_a_44_1k_source_a_tier_the_engine_offers_at_44_1k_is_reachable", () => {
  // Same list, same menu entry: 22579200 is now what would be sent, and the
  // engine offers exactly that. Graying it here would put the rate the engine
  // is enumerating out of reach on every 44.1 kHz track. The engine's own
  // output rate is 12288000 — the 48k family — so a store judging by that
  // rather than by the source grays this entry and fails.
  reset(SDM_LIST_44K({ status: SOURCE_44K(DSD256) }));
  assert.deepEqual(marks(optionFor(liveModel.value.sdmRate, DSD512)), REACHABLE);
});

test("test_under_a_44_1k_source_a_tier_the_engine_offers_only_at_48k_is_grayed", () => {
  // The mirror, and the other half of the source-not-output discrimination:
  // the engine enumerates and is putting out 24576000, but a 44.1 kHz source
  // sends 22579200, which the list does not hold. Judging by the menu's own
  // number, or by what the engine is putting out, calls this one reachable.
  reset(SDM_LIST_48K_ON_44K_SOURCE());
  assert.deepEqual(marks(optionFor(liveModel.value.sdmRate, DSD512)), GRAYED);
});

test("test_with_no_source_rate_reported_the_engines_output_rate_stands_in", () => {
  // Playing, but the daemon has no source rate to report. Its output rate is
  // 22579200, so the 44.1k family is what the tier resolves against and the
  // engine's 22579200 answers for DSD512; falling back to the 48k member here
  // would gray a rate the engine is offering.
  reset(SDM_LIST_44K({ status: NO_SOURCE_RATE(DSD512_44K) }));
  assert.deepEqual(marks(optionFor(liveModel.value.sdmRate, DSD512)), REACHABLE);
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
