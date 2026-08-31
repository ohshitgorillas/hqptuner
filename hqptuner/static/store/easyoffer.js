// Which Easy Mode presets the grid offers at all, as opposed to which one is
// marked. The curated table and its write sets live in store/easy.js, which is
// deliberately pure — no signals, no engine state; this module is where a
// preset meets what the engine can currently do with it.
//
// Two rules. A tile whose every path leads to a filter that can produce
// nothing is not offered. With the backend pinned to the 44.1 kHz DSD base and
// the output in SDM, a rate-limited filter (ratio class 2x or integer) has no
// path from a 48 kHz-family source, so a preset naming only such filters leads
// nowhere and the grid leaves it out rather than offering a press that cannot
// play.
//
// Derived end to end: which presets qualify falls out of the filters the table
// writes and the ratio classes the running engine states, so the owner moving a
// preset in or out of the table moves it in or out of this set with it.
//
// Positive evidence only, the rule the narrowing this reads from follows: a
// filter whose ratio class nothing states is not limited, and a backend whose
// 48 kHz switch this config surface cannot read (combo) hides nothing.
import { combos, filterFor, knobsShown, presetsFor, writeSet } from "./easy.js";
import { dsd44kOnly, rateLimited } from "./narrow/match.js";
import { filterFacets } from "./narrow/facets.js";
import { sourceIsNx } from "./live/derive.js";
import { easyMaterial } from "./easyview.js";

/**
 * @typedef {import("./easy.js").Preset} Preset
 * @typedef {import("./easy.js").Knob} Knob
 */

/**
 * Every distinct filter name a preset can write in one output mode, across
 * every knob combination it offers — the vocabulary one tile stands for, as
 * opposed to the four names one press writes.
 *
 * @param {string} presetId
 * @param {string} outputMode "pcm" | "sdm" | "auto"
 * @returns {string[]}
 */
function filtersWritten(presetId, outputMode) {
  const preset = presetsFor().find((p) => p.id === presetId);
  if (!preset) return [];
  const names = combos(preset).flatMap((knobs) => Object.values(writeSet(presetId, outputMode, knobs)));
  return [...new Set(names.filter(Boolean))];
}

/**
 * Whether the grid offers a preset a tile under one lane's output mode.
 *
 * @param {Preset} preset
 * @param {string} mode "pcm" | "sdm" | "auto"
 * @returns {boolean}
 */
export function presetOffered(preset, mode) {
  if (mode !== "sdm" || !dsd44kOnly.value) return true;
  return filtersWritten(preset.id, "sdm").some((name) => !rateLimited(name, "sdm"));
}

/**
 * The knobs set on the card rather than on a tile, each once, in the order the
 * presets first name them.
 *
 * @returns {Knob[]}
 */
export function cardKnobs() {
  /** @type {Knob[]} */
  const out = [];
  for (const preset of presetsFor()) {
    for (const knob of preset.knobs) if (knob.card && !out.some((k) => k.id === knob.id)) out.push(knob);
  }
  return out;
}

// The card's knobs, at their positions. One today, and the store holds it as one
// named signal rather than a map, so this is where a knob id meets its signal.
/**
 * Where the card's knobs stand, by knob id.
 *
 * @returns {Record<string, string>}
 */
export function cardPositions() {
  return { material: easyMaterial.value };
}

/**
 * Whether any card knob stands off its default.
 *
 * @returns {boolean}
 */
function cardMoved() {
  const at = cardPositions();
  return cardKnobs().some((knob) => at[knob.id] !== knob.default);
}

// The third rule, the card-level one. With the card's material knob off its
// default the user has said the source is lossy, and a preset whose every path
// writes a filter not made for it is offered but grayed: it still works, it is
// just not the answer to what they said. Read across every combination the tile
// can write, so a preset that reaches a hi-res filter at some position of its
// other knobs stays lit.
//
// Positive evidence only, again: a preset whose filters the engine has said
// nothing about is not grayed, since nothing known says it should be.
/**
 * Whether a tile is grayed under one lane's output mode.
 *
 * @param {Preset} preset
 * @param {string} mode "pcm" | "sdm" | "auto"
 * @returns {boolean}
 */
export function presetGrayed(preset, mode) {
  if (!cardMoved()) return false;
  const known = filtersWritten(preset.id, mode)
    .map((name) => filterFacets.value[name])
    .filter((facet) => !!facet);
  return known.length > 0 && !known.some((facet) => facet.hiresFamily);
}

/**
 * Whether the filter a tile NAMES at these positions is a hi-res one — the same
 * name `FilterName` paints, so the question is asked of the filter the user can
 * see rather than of one of the four a press writes.
 *
 * @param {string} presetId
 * @param {Record<string, string>} knobs
 * @param {string} mode "pcm" | "sdm" | "auto"
 * @returns {boolean}
 */
function namesHires(presetId, knobs, mode) {
  const facet = filterFacets.value[filterFor(presetId, mode, knobs, sourceIsNx())];
  return !!facet && facet.hiresFamily;
}

// The second rule, and the knob-level one. A knob declaring `whenHires` moves a
// hi-res filter and nothing else (store/easy.js), so it is offered only while
// that filter is the one the tile names: under Lossy, where both fields take it,
// or from an Nx source, where it is the field in play. Anywhere else the lever
// has nothing on the other end and the tile does without it.
//
// Withheld rather than offered when the engine has said nothing about the filter
// yet, which is the same "positive evidence only" the rate rule above follows,
// pointed the other way: this rule makes an offer instead of hiding a tile, so
// the absent evidence withholds the offer.
//
// A hidden knob still counts in the write. `writeSet` reads `knobsShown`, so the
// position the user last left it at continues to fill its field — the tile stops
// offering the choice, it does not forget the one already made.
/**
 * The knobs a tile offers at these positions under one lane's output mode.
 *
 * @param {Preset} preset
 * @param {Record<string, string>} knobs
 * @param {string} mode "pcm" | "sdm" | "auto"
 * @returns {Knob[]}
 */
export function knobsOffered(preset, knobs, mode) {
  // A card knob is offered on the card, once, never on a tile.
  return knobsShown(preset, knobs).filter(
    (knob) => !knob.card && (!knob.whenHires || namesHires(preset.id, knobs, mode)),
  );
}
