// The two chain cards' controls — narrowing, the count badge, and the per-card
// assembly that decides whether a card reads the engine or the running config.
// Its own module because that loaded/dormant split is a rule of its own: it is
// the only place on this page where a control's options and value come from
// somewhere other than the enumerations.

import { runningValue } from "../resolve.js";
import { optionsFor, grayShapersByRate, stripRateSuffix, dropSupersededTwoStage } from "../options.js";
import { narrowOptions, narrowCount, favOnlyModulators } from "../narrow/match.js";
import { decorateOptions } from "../plainnames.js";
import { CHAINS, idOptions, idValue } from "./derive.js";

/**
 * @typedef {import("./derive.js").MenuOption} MenuOption
 *
 * @typedef {object} ChainControl
 *   One chain control's static half — its wire field plus the catalog entry
 *   whose words it borrows from the tab twin.
 * @property {string} field live form field (routing.ROUTABLE)
 * @property {string} key schema key
 * @property {SchemaField} entry
 * @property {string} enumKey which enumeration its options come from
 * @property {string} state the /api/state attribute holding its current index
 */

// Filter narrowing is the same feature the Resampling tab has, on the same
// state: one set of facets narrows a control here and its twin there, because
// they are the same control and the narrowing is the user's standing answer to
// "which of these 77 filters am I willing to look at". Presentational only — a
// running value the facets exclude drops off its own dropdown and stays selected
// and named on the closed control (`valueLabel`), the same as on the tab.
// Shapers carry `narrow` nowhere and are left whole.
//
// Rate graying is the other half of the same story, and the same feature the
// tabs have (components/Field.js): a modulator whose floor is above the selected
// SDM rate is grayed with that floor as the reason. It is driven off the same
// schema `rateGray` field the tabs read, so the two views share one rule rather
// than growing two — and it is what closes the modulator-first order into a
// rate/shaper conflict. The rate-first order is not closed by graying rates,
// which would lock the user into the higher rate; it is reported in words
// (store/alerts/shaperfit.js). A selected option below the floor grays but stays
// listed and stays selected — grayShapersByRate marks, it never drops.
/**
 * @param {ChainControl} c
 * @param {MenuOption[]} raw
 * @returns {MenuOption[]}
 */
function chainOptions(c, raw) {
  const starred = c.entry.favKind === "modulators" ? favOnlyModulators(raw) : raw;
  const grayed = c.entry.rateGray ? grayShapersByRate(starred, c.entry.rateGray) : starred;
  const options = c.entry.rateGray === "sdm" ? stripRateSuffix(grayed) : grayed;
  const narrowed = c.entry.narrow ? narrowOptions(options, c.entry.narrow, c.key) : options;
  // Decoration runs last of all: narrowing and graying join by raw label
  // (store/plainnames.js) and must never see the transform.
  return c.entry.plainNames ? decorateOptions(narrowed, c.entry.plainNames) : narrowed;
}

// The tab's "n/total" label badge, counted off the same RAW (pre-narrow) list
// Field.js counts — null for the shapers, which carry `narrow` nowhere.
/**
 * @param {ChainControl} c
 * @param {MenuOption[]} raw
 * @returns {{ n: number, total: number } | null}
 */
function chainBadge(c, raw) {
  if (!c.entry.narrow) return null;
  return narrowCount(raw, c.entry.narrow, c.key);
}

// One chain's three controls, whether or not the engine has that chain loaded.
// Both cards are on the page at once, so the dormant one has to read from
// somewhere the engine cannot answer for: GetFilters/GetShapers enumerate the
// LOADED chain only. It reads the running configuration instead — the daemon's
// own /config form for the options, and the config's live overlay for the value,
// which already carries what LIVE set on this chain while it was dormant
// (routing.live_overrides). Both are the enum-ID domain the live lists use, so
// the two sides of the card are the same kind of number and an edit made here
// means the same thing when the chain loads and it is finally sent.
/**
 * One chain card's three controls — each with its current value, option list and narrow
 * badge, read from the enumerations when that chain is loaded and from the running
 * configuration when it is not.
 * @param {string} chain "pcm" | "sdm" — the card being built
 * @param {string | null} loaded the chain the engine has loaded, if any
 */
export function chainControls(chain, loaded) {
  return CHAINS[chain].map((c) => {
    const live = chain === loaded;
    const value = live ? idValue(c.enumKey, c.state) : (runningValue(c.key) ?? "");
    // The loaded chain's list comes from the enumeration, which offers every
    // filter the engine holds, so the SDM chain's superseded single-stage
    // filters are dropped here the way optionsFor drops them on the dormant
    // (config-backed) side. `desc` names the chain a control reads on
    // (store/schema.js), and the modulator carries a different one.
    const listed = live ? idOptions(c.enumKey) : optionsFor("config", c.field);
    const raw = live && c.entry.desc === "sdm_filter" ? dropSupersededTwoStage(listed, value) : listed;
    return {
      field: c.field,
      key: c.key,
      entry: c.entry,
      value,
      // The pre-narrow list rides along: what the closed control names and what
      // its prose describes are read off it, so a selection the facets narrowed
      // off the menu is still named and still described.
      optionsRaw: raw,
      options: chainOptions(c, raw),
      badge: chainBadge(c, raw),
      // The loaded chain's lists come from the enumerations; the dormant one's
      // come from the running config's form and are not invalidated by an
      // engine re-enumeration.
      enumBacked: live,
    };
  });
}
