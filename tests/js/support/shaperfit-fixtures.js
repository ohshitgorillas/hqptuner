// Shared scenario builder for the rate/shaper-fit suites — the live chain cards'
// modulator graying (shaperfit-graying.test.js), the alert rows
// (shaperfit-alerts.test.js) and their place in the strip
// (shaperfit-strip.test.js).
//
// Not a *.test.js file on purpose: the runner glob would execute it.
//
// Everything a scenario needs is stated at the wire the store reads from — the
// /api/state, /api/enumerations, /api/config and /api/metadata payloads carried
// by the exported signals. No store function is stubbed (docs/testing.md rule 4).
//
// Two facts drive the shape of the fixtures:
//
//   * The engine answers for the chain it has LOADED and nothing else, so the
//     dormant family's rate and shaper come from the running configuration
//     (`file`, which already carries LIVE's overrides) and its option list from
//     the daemon's own /config form. `reset()` therefore always states BOTH, and
//     always states them in agreement: the engine's pin is the same tier as the
//     configuration's limit, and the engine's shaper is the same name as the
//     configuration's enum ID. A fixture where the two disagreed would be asking
//     which source the rate/shaper fit reads, which is store/live's contract and
//     is pinned in liverate.test.js / livechain.test.js, not here.
//   * Shaper names are the engine's, and the constraint file joins to them BY
//     NAME (architecture §2/§5) — so the floors below are keyed by the names
//     support/chainenums.js puts on both the enum side and the form side, with
//     the enum ID differing from the list index throughout.

import { config, enums, engineState, engineStatus, metadata } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { liveErrors, liveBusy } from "../../../hqptuner/static/store/live/state.js";
import { staticWire } from "./wire.js";
import { PCM_FILTERS, PCM_SHAPERS, SDM_FILTERS, SDM_SHAPERS, JUNK, formField, FORM, LISTS } from "./chainenums.js";

// Tier menu members, 48k side — a menu value names the TIER, never the
// frequency (settings-classification §Rate per-family).
export const DSD64 = "3072000";
export const DSD512 = "24576000";
export const DSD1024 = "49152000";
export const PCM_1X = "48000";
export const PCM_4X = "192000";
export const PCM_8X = "384000";

// The two shapers every scenario runs on, by the name the engine reports them
// under. `state.shaper` is list index 1 on either chain, and `FORM` carries the
// matching enum ID (dither 5 = NS9, modulator 3 = ASDM7EC).
export const MODULATOR = "ASDM7EC";
export const DITHER = "NS9";
// The other member of each list, which no scenario selects.
export const OTHER_MODULATOR = "ASDM5";

/**
 * The rate floors a scenario gives the shapers, in Hz, `null` for a shaper the
 * constraint file records no floor for.
 *
 * @typedef {{ sdm?: Record<string, number | null>, pcm?: Record<string, number | null> }} Floors
 */

/** @param {Record<string, number | null>} floors */
const overlay = (floors) => Object.fromEntries(Object.entries(floors).map(([name, hz]) => [name, { min_rate_hz: hz }]));

// The /api/metadata payload: settings prose plus the filters.json / shapers.json
// name-keyed overlays, the second of which carries the rate constraints.
/** @param {Floors} floors */
const META = ({ sdm = {}, pcm = {} }) => ({
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
  shapers: { pcm_dithers: overlay(pcm), sdm_modulators: overlay(sdm) },
});

// `<RatesItem index rate/>` — no name and no value, index 0 meaning auto
// (protocol.md §4/§6). The index a rate lands on is never its value.
/** @param {...string} hz */
const rateItems = (...hz) => ["0", ...hz].map((rate, i) => ({ index: String(i), rate }));

/** @type {Record<string, string>} */
const MODE_NAME = { 0: "[source]", 1: "PCM", 2: "SDM (DSD)" };
/** @type {Record<string, string>} */
const FILE_MODE = { 0: "auto", 1: "pcm", 2: "sdm" };

/**
 * One scenario: which chain the engine has loaded (null for none at all), the
 * configured output mode as `State` reports it, the tier each family sits at,
 * and the shaper floors in force.
 *
 * @typedef {{
 *   chain?: "pcm" | "sdm" | null,
 *   mode?: string,
 *   sdmRate?: string,
 *   pcmRate?: string,
 *   floors?: Floors,
 *   status?: unknown,
 * }} Scenario
 */

/** @type {Floors} */
const DEFAULT_FLOORS = {
  sdm: { [MODULATOR]: 40960000, [OTHER_MODULATOR]: null },
  pcm: { [DITHER]: 352800, none: null },
};

// A scenario with every member stated: the engine running SDM at DSD512 under a
// 40.96 MHz modulator floor, PCM held at 8x, nothing playing.
/**
 * @param {Scenario} scenario
 * @returns {Required<Scenario>}
 */
const settle = ({
  chain = "sdm",
  mode = "2",
  sdmRate = DSD512,
  pcmRate = PCM_8X,
  floors = DEFAULT_FLOORS,
  status = null,
}) => ({ chain, mode, sdmRate, pcmRate, floors, status });

// Total reset: module-level signals outlive a test file, so a partial one makes
// cases pass alone and fail in sequence. `staged` is private and is cleared
// through the faked /api/config/pending, via discardAll().
/**
 * @param {Scenario} [scenario]
 * @returns {Promise<void>}
 */
export async function reset(scenario = {}) {
  const { chain, mode, sdmRate, pcmRate, floors, status } = settle(scenario);
  staticWire({ live: {}, http: {} });
  const loaded = chain === "sdm";
  engineState.value = {
    mode,
    filter1x: "1",
    filterNx: loaded ? "1" : "2",
    shaper: "1",
    rate: chain === null ? "0" : "1",
    filter_junk: "0",
    adaptive: "0",
    volume: "-10.0",
    active_chain: chain,
  };
  engineStatus.value = status;
  enums.value = {
    filters: loaded ? SDM_FILTERS : PCM_FILTERS,
    shapers: loaded ? SDM_SHAPERS : PCM_SHAPERS,
    rates: chain === null ? rateItems() : rateItems(loaded ? sdmRate : pcmRate),
    junk_filters: JUNK,
    mode: { name: MODE_NAME[mode] },
  };
  metadata.value = META(floors);
  config.value = {
    fields: [
      ...Object.entries(FORM).map(([name, value]) => formField(name, value, LISTS[name])),
      // The two rate LIMITS, as the daemon's own form carries them: the PCM
      // family's is `defaults_samplerate`, the SDM family's `defaults_bitrate`.
      { name: "defaults_samplerate", value: pcmRate },
      { name: "defaults_bitrate", value: sdmRate },
    ],
    file: { mode: FILE_MODE[mode], ...FORM, defaults_samplerate: pcmRate, defaults_bitrate: sdmRate },
    active: "",
    profiles: null,
  };
  liveErrors.value = {};
  liveBusy.value = "";
  await discardAll();
}
