// Rate/shaper conflicts, as alert-strip rows.
//
// The option lists gray a shaper the rate cannot reach (store/options.js
// grayShapersByRate), which closes one direction only: pick the rate first and
// the modulator menu tells you. The other direction — a modulator already
// selected, then the rate dropped under it — is deliberately NOT closed by
// graying rates, because that would lock the user into the higher rate, a worse
// failure than the one it fixes. It is surfaced in words here instead.
//
// The two families differ in kind, not just in degree. An SDM modulator below
// its floor makes the engine produce no output at all, so it is a `crit`; a PCM
// ditherer below its floor still dithers, just not as well as the one the
// manual recommends, so it is a `warn`. That hard/soft split is the product
// decision `data/shapers.json` records as `sdm_modulators` against
// `pcm_dithers` — the manual's own wording is "optimized for" on both sides.
//
// Only the family that will actually produce output raises anything: a PCM-only
// listener carrying a permanent red alert about an SDM chain they never load
// would be noise, not a fault report.

import { computed } from "@preact/signals";
import { metadata } from "./signals.js";
import { effective } from "./resolve.js";
import { optionsFor } from "./options.js";
import { schema, DSD_RATES, PCM_RATES, TIER } from "./schema.js";
import { loadedChain } from "./live/rates.js";

/**
 * @typedef {{ value: string, label: string }} RateTier
 *
 * @typedef {object} Family
 * @property {RateTier[]} rates
 * @property {string} rateKey
 * @property {string} shaperKey
 * @property {string} db
 * @property {string} sev
 * @property {(name: string, rate: string, floor: string) => string} text
 */

// Per family: the rate menu whose tiers name the rates, the schema keys the two
// halves of the conflict read from, and the words the alert is built out of.
/** @type {Record<string, Family>} */
const FAMILIES = {
  sdm: {
    rates: DSD_RATES,
    rateKey: "sdm_rate",
    shaperKey: "sdm_modulator",
    db: "sdm_modulators",
    sev: "crit",
    /**
     * @param {string} name
     * @param {string} rate
     */
    text: (name, rate) =>
      `The current settings are invalid: modulator ${name} is incompatible with ${rate} output. ` +
      `HQPlayer cannot produce output.`,
  },
  pcm: {
    rates: PCM_RATES,
    rateKey: "pcm_rate",
    shaperKey: "pcm_dither",
    db: "pcm_dithers",
    sev: "warn",
    /**
     * @param {string} name
     * @param {string} rate
     * @param {string} floor
     */
    text: (name, rate, floor) =>
      `The current settings are suboptimal: ditherer ${name} is optimized for output rates >=${floor}, ` +
      `but the current rate is ${rate}.`,
  },
};

// A tier's own label. The menus carry the 48k member of each tier and mean the
// tier, so either member answers for it (store/schema.js TIER).
/**
 * @param {RateTier[]} rates
 * @param {number} hz
 * @returns {string}
 */
function tierLabel(rates, hz) {
  const menu = TIER[String(hz)] || String(hz);
  const hit = rates.find((r) => r.value === menu);
  return hit ? hit.label : "";
}

// A floor rounds UP to the nearest tier in its own family. The thresholds in
// `data/shapers.json` are the manual's MHz statements and sit between tiers by
// design (AHM's 40.96 MHz falls between DSD512 and DSD1024), so the tier that
// actually satisfies the floor is the first one at or above it. `min_rate_label`
// carries the manual's prose, which is worded inconsistently entry to entry, so
// it is not used for this.
/**
 * @param {RateTier[]} rates
 * @param {number} floor
 * @returns {string}
 */
function floorLabel(rates, floor) {
  const hit = rates.find((r) => Number(r.value) >= floor);
  return hit ? hit.label : "";
}

// The selected shaper's NAME. The config-form domain is the enum ID, and
// `data/shapers.json` joins to the engine's enumerations by name (architecture
// §2) — so the form's own option list is what turns one into the other.
/**
 * @param {string} key
 * @returns {string}
 */
function shaperName(key) {
  const value = String(effective(key) ?? "");
  if (!value) return "";
  const hit = optionsFor("config", schema[key].field || "").find((o) => String(o.value) === value);
  return hit ? hit.label : "";
}

// One family's conflict, or null when its shaper sits at or above its floor —
// which includes every shaper carrying no floor at all.
/**
 * @param {string} family
 * @returns {{ sev: string, text: string } | null}
 */
function conflict(family) {
  const f = FAMILIES[family];
  const db = ((metadata.value && metadata.value.shapers) || {})[f.db];
  const name = shaperName(f.shaperKey);
  const rate = Number(effective(f.rateKey));
  if (!db || !name || !rate) return null;
  const floor = Number((db[name] || {}).min_rate_hz) || 0;
  if (!floor || rate >= floor) return null;
  return { sev: f.sev, text: f.text(name, tierLabel(f.rates, rate), floorLabel(f.rates, floor)) };
}

// Which families to judge — the ones the settings on screen will actually
// produce output in. The operands already read the pending picture (`effective`
// covers a staged edit and a previewed preset alike), so the family gate has to
// as well: gating on the chain the engine has loaded RIGHT NOW while judging the
// pending rate and shaper mixes two pictures, and reports a conflict in a chain
// the pending settings never load — a previewed SDM preset judged as PCM because
// PCM is what is playing, and the reverse.
//
// `auto` is the one mode that names no family: there the engine chooses per
// track from the source and the configured limit (manual §4.4), so the setting
// has no answer to give and the chain the engine has LOADED is the only thing
// that does. With nothing loaded either — auto, stopped — neither has decided
// and both families are judged.
//
// The loaded chain, deliberately, and not `liveFamily` — that falls back to the
// mode the ENGINE reports, which is the same question `effective` has already
// answered here from the better source. Asking it twice puts the stale answer
// back: stage auto while the engine still reports PCM and only PCM would be
// judged, though after the apply either family may run.
/**
 * @returns {string[]}
 */
function familiesToJudge() {
  const mode = String(effective("output_mode") ?? "");
  if (mode === "pcm" || mode === "sdm") return [mode];
  const chain = loadedChain();
  return chain ? [chain] : ["sdm", "pcm"];
}

/**
 * Rate/shaper conflicts as alert-strip rows, empty when the settings are consistent.
 * SDM first — it is the one that stops output.
 */
export const shaperAlerts = computed(() => familiesToJudge().map(conflict).filter(Boolean));
