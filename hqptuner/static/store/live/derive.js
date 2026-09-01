// --- what the controls read --------------------------------------------------
// The running engine is the sole authority for enumeration names, IDs and
// ordering (architecture §2), so every option list below is built from the
// enumerations rather than from anything shipped.
//
// This module owns the read/derive core: the joins from /api/state and the
// enumerations to the config-form domain the controls speak, and the two chain
// descriptions built on them. Everything here is pure — no signal is written and
// no request is made — which is why the rate card, the chain cards and the view
// model can all sit on top of it without depending on each other.

import { engineState, engineStatus, enums, modeName } from "../signals.js";
import { schema } from "../schema.js";

/**
 * @typedef {import("../narrow/facets.js").EnumItem} EnumItem
 *
 * @typedef {object} MenuOption
 *   One option as this page's menus carry them. Looser than OptionItem: the
 *   lists here are the schema's own bare rate tables as well as OptionItem
 *   lists, and either may pick up a gray mark on the way out.
 * @property {string | number | undefined} value
 * @property {string} label
 * @property {boolean} [disabled]
 * @property {string} [reason]
 */

/**
 * One enumeration's items as the engine currently reports them, empty until it has.
 * @returns {EnumItem[]}
 */
export const items = (/** @type {string} */ key) => (enums.value && enums.value[key]) || [];
/** One attribute of the engine's reported State, undefined until it has reported. */
export const stateOf = (/** @type {string} */ attr) => (engineState.value || {})[attr];

// State reports a LIST INDEX; the config-form domain these controls speak is the
// enum ID (protocol.md §4). The enumeration item carries both, so the join is a
// lookup and never a computation.
const atIndex = (/** @type {EnumItem[]} */ list, /** @type {string | number | undefined} */ index) =>
  list.find((o) => String(o.index) === String(index));

/**
 * One enumeration as menu options: valued by enum ID, labeled by the engine's name.
 * @returns {MenuOption[]}
 */
export const idOptions = (/** @type {string} */ key) => items(key).map((o) => ({ value: o.value, label: o.name }));

/**
 * The enum ID behind the list index State reports for one attribute, "" when the
 * enumeration has no item at that index.
 * @param {string} key
 * @param {string} attr
 * @returns {string}
 */
export function idValue(key, attr) {
  const item = atIndex(items(key), stateOf(attr));
  return (item && item.value) || "";
}

// Every control here names its catalog key, and its words are then the tab
// twin's words: the schema entry carries the label, the settings.json group its
// tooltip lives in, and which description overlay its selection reads
// (store/prose.js). Nothing on this page writes prose of its own — a live
// control and its persistent twin are the same knob and must say the same
// thing.
/** A catalog key paired with its schema entry — the words a live control shares with its tab twin. */
export const catalog = (/** @type {string} */ key) => ({ key, entry: schema[key] });

// The two chains' form fields, in signal order. Mirrors routing.ROUTABLE, which
// is what accepts these names back.
/** @type {Record<string, import("./chains.js").ChainControl[]>} */
export const CHAINS = {
  pcm: [
    { field: "filter1x", ...catalog("pcm_filter_1x"), enumKey: "filters", state: "filter1x" },
    { field: "filter", ...catalog("pcm_filter_nx"), enumKey: "filters", state: "filterNx" },
    { field: "dither", ...catalog("pcm_dither"), enumKey: "shapers", state: "shaper" },
  ],
  sdm: [
    { field: "oversampling1x", ...catalog("sdm_filter_1x"), enumKey: "filters", state: "filter1x" },
    { field: "oversampling", ...catalog("sdm_filter_nx"), enumKey: "filters", state: "filterNx" },
    { field: "modulator", ...catalog("sdm_modulator"), enumKey: "shapers", state: "shaper" },
  ],
};

// Mode is the one live field whose value is a name rather than a number. The
// modes enumeration is device-dependent — it drops SDM on a device that cannot
// do DSD — so the form value is matched from the item's NAME, exactly as
// routing._mode_form_value does on the other side.
/** The mode form value the engine's reported mode name matches, "" when it matches none. */
export function modeValue() {
  const name = modeName.value.toUpperCase();
  if (name.startsWith("[SOURCE]")) return "auto";
  if (name.startsWith("PCM")) return "pcm";
  return name.startsWith("SDM") || name.startsWith("DSD") ? "sdm" : "";
}

// Which side of the 1x/Nx split the playing material falls on. The boundary is
// the engine's own and not a round number of ours: manual §4.6 states that the
// 1x filter selection "covers source sampling rates below 50 kHz, so-called base
// rates", which puts 50 kHz and everything above it on the Nx filter. 64 kHz is
// the one real rate where that differs from the 88.2 kHz figure it is easy to
// assume, and it is Nx.
//
// The SOURCE rate answers this, never `Status.active_rate`: active_rate is what
// the engine is putting out, already upsampled, so it reads Nx during every
// playback there is and would answer the question with its own output. With
// nothing playing there is no source and no Nx side to be on.
const NX_FLOOR = 50000;

/** Whether the playing source's rate puts playback on the Nx side of the filter split. */
export function sourceIsNx() {
  const md = (engineStatus.value || {}).metadata || {};
  return Number(md.samplerate) >= NX_FLOOR;
}
