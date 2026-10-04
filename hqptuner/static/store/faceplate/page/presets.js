// The Filter presets popover's rows: the Easy Mode table (store/easy/easy.js) in the owner's order, on the LIVE lane.
// Each row says what pressing it writes and what that costs: its filters, its knobs, its error-correction mark and its
// pips, whether the engine's current state offers it and whether the card's material grays it, and whether it is the
// preset running now.
//
// A subset preset is one with a version knob, a knob whose every position names another preset: Concert Hall and The
// Crucible, the flagships taken further. It draws no row of its own. It nests under each flagship its version knob
// names, in that flagship's version, so the nested row carries no version knob; one flagship shows its nested rows at a
// time. Every other knob a subset has is recorded once per subset (store/easy/easyview.js), so its two nested copies
// stand at the same position.

import { signal } from "@preact/signals";
import { easyProse, paragraphs } from "../../prose.js";
import { filterFor, matchPreset, presetsFor } from "../../easy/easy.js";
import { cardPositions, knobsOffered, presetGrayed, presetOffered } from "../../easy/easyoffer.js";
import { pipsFor } from "../../easy/easycost.js";
import { easyLane } from "../../easy/easylane.js";
import { knobsFor } from "../../easy/easyview.js";
import { applyPreset, markFor } from "../../easy/apply.js";

/** @typedef {import("../../easy/easy.js").Preset} Preset */
/** @typedef {import("../../easy/easy.js").Knob} Knob */

/**
 * One position of a row's knob.
 *
 * @typedef {object} KnobOption
 * @property {string} value  the position's id
 * @property {string} label
 * @property {string} tip  what picking it does, "" when nothing is said
 */

/**
 * One knob a row offers, at the position it stands.
 *
 * @typedef {object} KnobView
 * @property {string} id
 * @property {string} label
 * @property {string} tip  what its positions cost, "" when nothing is said
 * @property {string} value
 * @property {KnobOption[]} options
 */

/**
 * One filter a row names; `stage` is "1x" or "Nx" where the two fields take different filters, else "".
 *
 * @typedef {{ stage: string, name: string }} FilterName
 */

/**
 * One row of the popover.
 *
 * @typedef {object} PresetRow
 * @property {string} id  the preset
 * @property {string} under  the flagship a nested row stands under, "" for a top-level row
 * @property {string} emoji
 * @property {string} title
 * @property {string} description
 * @property {boolean} hires  wears the hi-res badge
 * @property {FilterName[]} filters
 * @property {KnobView[]} knobs
 * @property {Record<string, string>} at  the knob positions a press writes
 * @property {"full" | "half" | "none" | ""} mark  "" when nothing is known about the filter
 * @property {number} pips
 * @property {string} costWord  the caption standing in for pips, "" where pips count
 * @property {boolean} grayed
 * @property {boolean} current  the preset, at these positions, is what the engine runs
 * @property {boolean} open  a flagship whose nested rows show
 * @property {PresetRow[]} subs  a flagship's nested rows, empty on every other row
 */

const LANE = "live";

/** The flagship whose nested rows show, or "" for none. */
const openFlagship = signal("");

/**
 * Show one flagship's nested rows, folding any other's.
 *
 * @param {string} id
 */
export function showSubsets(id) {
  openFlagship.value = id;
}

/** Fold the open flagship's nested rows. */
export function foldSubsets() {
  openFlagship.value = "";
}

/**
 * A preset's version knob: the one whose every position names another preset.
 *
 * @param {Preset} preset
 * @param {Set<string>} ids  every preset's id
 * @returns {Knob | undefined}
 */
const versionKnob = (preset, ids) => preset.knobs.find((k) => k.options.every((o) => o !== preset.id && ids.has(o)));

/**
 * Where a preset's knobs stand when it is not the running one: the position recorded for it, else each knob's default,
 * the card's knobs at the card's positions.
 *
 * @param {Preset} preset
 * @returns {Record<string, string>}
 */
function resting(preset) {
  const kept = knobsFor(preset.id);
  const card = cardPositions();
  return Object.fromEntries(
    preset.knobs.map((k) => {
      if (k.card) return [k.id, card[k.id]];
      return [k.id, k.options.includes(kept[k.id]) ? kept[k.id] : k.default];
    }),
  );
}

/**
 * The filters a preset names at these positions, 1x then Nx when the two fields differ.
 *
 * @param {string} id
 * @param {string} mode
 * @param {Record<string, string>} at
 * @returns {FilterName[]}
 */
function filtersOf(id, mode, at) {
  const x1 = filterFor(id, mode, at, false);
  const nx = filterFor(id, mode, at, true);
  if (x1 && nx && x1 !== nx) {
    return [
      { stage: "1x", name: x1 },
      { stage: "Nx", name: nx },
    ];
  }
  const one = x1 || nx;
  return one ? [{ stage: "", name: one }] : [];
}

/**
 * The knobs a row offers at these positions: those the tile would, less the card's (not offered on a tile), those the
 * positions leave with nothing to reach, and the version a nested row is fixed at.
 *
 * @param {Preset} preset
 * @param {string} mode
 * @param {Record<string, string>} at
 * @param {string} fixed  the knob a nested row does not offer, "" for none
 * @returns {KnobView[]}
 */
function knobsOf(preset, mode, at, fixed) {
  return knobsOffered(preset, at, mode)
    .filter((k) => !k.inert && k.id !== fixed)
    .map((k) => ({
      id: k.id,
      label: easyProse(preset.id, "knobs", k.id, "label"),
      tip: easyProse(preset.id, "knobs", k.id, "tip"),
      value: at[k.id],
      options: k.options.map((o) => ({
        value: o,
        label: easyProse(preset.id, "knobs", k.id, "options", o),
        tip: easyProse("tips", k.id, o),
      })),
    }));
}

/**
 * What the row-building reads once per pass.
 *
 * @typedef {object} Pass
 * @property {string} mode  the LIVE lane's output mode
 * @property {{ presetId: string, knobs: Record<string, string> } | null} running
 */

/**
 * Where a row stands: the flagship it nests under and the version knob that pins it there, both "" for a top-level row.
 *
 * @typedef {{ under: string, fixed: string }} Nest
 */

/** @type {Nest} */
const TOP = { under: "", fixed: "" };

/**
 * Whether a row is the running preset: the preset matches and, nested, in its flagship's version.
 *
 * @param {Preset} preset
 * @param {Nest} nest
 * @param {Pass} pass
 * @returns {boolean}
 */
function isRunning(preset, nest, pass) {
  const run = pass.running;
  return !!run && run.presetId === preset.id && (!nest.fixed || run.knobs[nest.fixed] === nest.under);
}

/**
 * Where a row's knobs stand: the running positions when the row is the running preset, else its resting ones; a
 * nested row's version is its flagship.
 *
 * @param {Preset} preset
 * @param {Nest} nest
 * @param {Pass} pass
 * @returns {Record<string, string>}
 */
function positionsOf(preset, nest, pass) {
  const run = isRunning(preset, nest, pass) ? pass.running : null;
  const at = { ...resting(preset), ...(run ? run.knobs : {}) };
  return nest.fixed ? { ...at, [nest.fixed]: nest.under } : at;
}

/**
 * One row for a preset where it stands.
 *
 * @param {Preset} preset
 * @param {Nest} nest
 * @param {Pass} pass
 * @returns {PresetRow}
 */
function rowOf(preset, nest, pass) {
  const at = positionsOf(preset, nest, pass);
  const pips = pipsFor(preset.id, pass.mode, at);
  return {
    id: preset.id,
    under: nest.under,
    emoji: preset.emoji,
    title: easyProse(preset.id, "title"),
    description: paragraphs(easyProse(preset.id, "description")).join(" "),
    hires: !!preset.hires,
    filters: filtersOf(preset.id, pass.mode, at),
    knobs: knobsOf(preset, pass.mode, at, nest.fixed),
    at,
    mark: markFor(preset.id, at) || "",
    pips,
    costWord: preset.costText && pips === 0 ? easyProse(preset.id, "cost") : "",
    grayed: presetGrayed(preset, pass.mode),
    current: isRunning(preset, nest, pass),
    open: false,
    subs: [],
  };
}

/**
 * The popover's rows, top-level in the table's order, each flagship carrying its nested rows.
 *
 * @returns {PresetRow[]}
 */
export function presetRows() {
  const lane = easyLane(LANE);
  /** @type {Pass} */
  const pass = { mode: lane.mode, running: matchPreset(lane.values, lane.mode) };
  const offered = presetsFor().filter((p) => presetOffered(p, pass.mode));
  const ids = new Set(presetsFor().map((p) => p.id));
  const subsets = offered.flatMap((p) => {
    const vk = versionKnob(p, ids);
    return vk ? [{ preset: p, vk }] : [];
  });
  return offered
    .filter((p) => !versionKnob(p, ids))
    .map((p) => {
      const subs = subsets
        .filter(({ vk }) => vk.options.includes(p.id))
        .map(({ preset, vk }) => rowOf(preset, { under: p.id, fixed: vk.id }, pass));
      return { ...rowOf(p, TOP, pass), subs, open: subs.length > 0 && openFlagship.value === p.id };
    });
}

/**
 * A row's press, or a move of one of its knobs: write the preset at those positions on the LIVE lane.
 *
 * @param {string} id
 * @param {Record<string, string>} knobs
 * @returns {Promise<void>}
 */
export async function pickPreset(id, knobs) {
  const preset = presetsFor().find((p) => p.id === id);
  if (preset) await applyPreset(LANE, preset, knobs);
}
