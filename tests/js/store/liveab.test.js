// Behavioral suite for the Setting Switcher's store — store/live/ab.js: which
// live form field the card is pointed at once the engine's chain is taken into
// account, and which of the two slots the engine is currently sitting on.
//
// The two chains carry different enumerations and a filter is an enum ID within
// its own chain's list (protocol.md §4), so the field a target names is not a
// constant: PCM's three live fields are filter1x / filter / dither, SDM's are
// oversampling1x / oversampling / modulator, and which set is live is what
// /api/state's `active_chain` reports (architecture.md:91). Every case below
// therefore drives a CONFIGURED mode of auto, where the chain can only come
// from `active_chain` — a store reading the configured mode instead has no
// answer to read there.
//
// The fixtures are the daemon's own two enumerations (support/chainenums.js),
// whose enum IDs deliberately differ from their list indices: State reports the
// LIST INDEX of the loaded chain's filter and the slots hold the enum ID, so a
// fixture where the two coincided could not tell a join from no join at all.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire — the exported `engineState` / `enums` / `config` signals carry the
// shapes /api/state, /api/enumerations and /api/config actually serve.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/liveab.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { engineState, enums, config } from "../../../hqptuner/static/store/signals.js";
import { abField, abLit, setAbSlot, setAbTarget } from "../../../hqptuner/static/store/live/ab.js";
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

const RATES = [
  { index: "0", rate: "0" },
  { index: "1", rate: "96000" },
];

const base = { rates: RATES, junk_filters: JUNK };
// `[source]`: the configured mode is auto whichever chain the source has left
// loaded, so the mode name says nothing about which chain that is.
const AUTO_PCM_ENUMS = () => ({ ...base, filters: PCM_FILTERS, shapers: PCM_SHAPERS, mode: { name: "[source]" } });
const AUTO_SDM_ENUMS = () => ({ ...base, filters: SDM_FILTERS, shapers: SDM_SHAPERS, mode: { name: "[source]" } });

/** @typedef {ReturnType<typeof AUTO_PCM_ENUMS>} Enums */

// State reports the LIST INDEX of the loaded chain's filter and shaper, and
// nothing at all about the chain that is not loaded.
/** @param {{ chain?: string, filterNx?: string }} [sc] */
const STATE = ({ chain = "pcm", filterNx = "2" } = {}) => ({
  mode: "0",
  filter1x: "1",
  filterNx,
  shaper: "1",
  rate: "1",
  filter_junk: "0",
  adaptive: "0",
  volume: "-10.0",
  active_chain: chain,
});

/** @param {Record<string, string>} [over] */
const FIELDS = (over = {}) =>
  Object.entries({ ...FORM, ...over }).map(([name, value]) => formField(name, value, LISTS[name]));

// `file` is the running configuration with the live lane's overrides on top,
// keyed by form field.
/** @param {Record<string, string>} [over] */
const FILE = (over = {}) => ({ mode: "auto", ...FORM, ...over });

// The two settings the user is switching between, as the card stores them: the
// enum ID that applies, with the display name it had (architecture.md:133).
/** @type {[string, string]} */
const A = ["25", "sinc-M"];
/** @type {[string, string]} */
const B = ["40", "poly-sinc-gauss-long"];

// Total reset: module-level signals outlive a test, so a partial one makes cases
// pass alone and fail in sequence. Both slots are written on every case, so a
// slot left behind by an earlier one cannot answer a later one's question.
/**
 * @param {{ chain?: string, lists?: Enums, filterNx?: string, target?: string,
 *   a?: [string, string], b?: [string, string], over?: Record<string, string> }} [scenario]
 */
function reset({ chain = "pcm", lists, filterNx, target = "filter", a = A, b = B, over = {} } = {}) {
  staticWire({ live: {}, http: {} });
  engineState.value = STATE({ chain, filterNx });
  enums.value = lists || AUTO_PCM_ENUMS();
  config.value = { fields: FIELDS(over), file: FILE(over), active: "", profiles: null };
  liveErrors.value = {};
  liveBusy.value = "";
  setAbTarget(target);
  setAbSlot("a", a[0], a[1]);
  setAbSlot("b", b[0], b[1]);
}

// --- the target is a field on whichever chain the engine has loaded ---------------

// The configured mode is auto in both, so `active_chain` is the only source that
// can tell these two apart: a fixed target-to-field table answers the same name
// for both and is red on one of them.
for (const [chain, lists, field] of /** @type {[string, Enums, string][]} */ ([
  ["pcm", AUTO_PCM_ENUMS(), "filter"],
  ["sdm", AUTO_SDM_ENUMS(), "oversampling"],
])) {
  test(`test_the_filter_target_is_the_${field}_field_while_the_engine_runs_${chain}`, () => {
    reset({ chain, lists, filterNx: chain === "sdm" ? "1" : "2" });
    assert.equal(abField.value, field);
  });
}

// --- which slot the engine is sitting on ------------------------------------------

// State's filterNx is a list index into the PCM enumeration: index 2 is enum 25,
// index 1 is enum 40, index 0 is enum 0 — the ID in slot A, the ID in slot B,
// and an ID neither slot holds. A card that lit whichever side was pressed last
// answers the same side for all three.
for (const [filterNx, lit, sitting] of /** @type {[string, string, string][]} */ ([
  ["2", "a", "slot_as_id"],
  ["1", "b", "slot_bs_id"],
  ["0", "", "a_third_setting"],
])) {
  test(`test_the_engine_sitting_on_${sitting}_lights_${lit || "neither_side"}`, () => {
    reset({ filterNx, over: { filter: PCM_FILTERS[Number(filterNx)].value } });
    assert.equal(abLit.value, lit);
  });
}
