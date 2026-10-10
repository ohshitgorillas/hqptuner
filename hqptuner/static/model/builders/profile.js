// DOM-free decisions the Profile builder makes: which steps a profile skips, what the rail and the overview read for
// each part, which crossfeed preset and settings path a profile's values land on, whether an edit reads dirty, when a
// step must be laid out again, and what the picker, the name box and Delete show. Each takes its tables as arguments,
// returns a value and leaves its arguments as they were.

import { shelfScale } from "../../vendor/eqlab/core/dsp/curves.js";
import { bauerPreset, structuralPreset } from "../gauges/crossfeed.js";
import { percentApplied } from "../gauges/loudness.js";
import { NEW, OVERVIEW, keyOf } from "./builder.js";

/** The station's unnamed profile: the daemon's own name, kept and never deleted (v1). */
export const DEFAULT = "[Default]";

/** @typedef {Record<string, string | number>} Vals  a profile's values (the family's, so numbers may arrive as strings) */

/** @typedef {{ name: string, stations: string[], desc: string, listen: string }} Meta  the edit's name, stations, description, listening */

/** @typedef {{ listen: string, fixed: boolean, models: number }} StepContext  what a step's guide and skip read */

/** @typedef {{ id: string, skip?: (x: StepContext) => string }} Step */

/** @typedef {{ crossfeed: string, loudness: string }} Known  'preset' | 'values' per step: "do you know your settings?" */

/** @typedef {{ v: string, label: string }} BauerPreset */

/** @typedef {{ v: string, label: string, angle: number, lambda: number }} StructuralPreset */

/** @typedef {{ bauer: BauerPreset[], structural: StructuralPreset[] }} Presets  the Bauer presets with fixed values, the Structural ones */

/**
 * @typedef {object} Summary  what the rail and the overview read for each part
 * @property {string} listen
 * @property {{ on: boolean, mode: string, preset: string | null }} crossfeed  preset: the label the values land on, null = none
 * @property {{ on: boolean, model: string }} correction  model '' = none picked
 * @property {{ on: boolean, percent: number }} loudness  percent: how much of the shelving applies at the level
 */

/** @typedef {{ st: string, options: { key: string, name: string, dirty: boolean }[] }} PickerGroup */

/** @typedef {{ fixedName: boolean, deletable: boolean, newDirty: boolean }} RenderView */

/** @typedef {{ structural: string, dacModel: boolean }} PaintView */

/**
 * What a step's guide and skip read: the listening answer, a fixed volume, and how many DAC models carry a value.
 *
 * @param {string} listen
 * @param {boolean} fixed
 * @param {{ v: string }[]} models
 * @returns {StepContext}
 */
export function stepContext(listen, fixed, models) {
  return { listen, fixed, models: models.filter((m) => m.v).length };
}

/**
 * Why a step does not apply ('' = it applies; an unknown id applies).
 *
 * @param {Step[]} steps
 * @param {string} id
 * @param {StepContext} ctx
 * @returns {string}
 */
export function skipOf(steps, id, ctx) {
  return steps.find((x) => x.id === id)?.skip?.(ctx) || "";
}

/**
 * The crossfeed preset the values land on: the Bauer preset named, the Structural preset at the angle and center
 * character, undefined where none matches; any other mode reads as a preset with no label.
 *
 * @param {Vals} vals
 * @param {Presets} presets
 * @returns {{ label: string } | undefined}
 */
export function crossfeedPreset(vals, presets) {
  if (vals.xfmode === "bauer") return bauerPreset(presets.bauer, String(vals.xfpreset));
  if (vals.xfmode === "structural") return structuralPreset(presets.structural, vals.xsangle, vals.xslambda);
  return { label: "" };
}

/**
 * Whether every value in `defaults` is the profile's own (compared as strings).
 *
 * @param {Vals} vals
 * @param {Vals} defaults
 * @returns {boolean}
 */
export function atDefaults(vals, defaults) {
  return Object.entries(defaults).every(([k, x]) => String(vals[k]) === String(x));
}

/**
 * The settings path each step opens on for a loaded profile: a preset where crossfeed is off or its values land on
 * one, the defaults where loudness holds them, the values otherwise.
 *
 * @param {Vals} vals
 * @param {Presets} presets
 * @param {Vals} loudness  the loudness defaults
 * @returns {Known}
 */
export function knownOf(vals, presets, loudness) {
  return {
    crossfeed: vals.xfmode === "off" || crossfeedPreset(vals, presets) ? "preset" : "values",
    loudness: atDefaults(vals, loudness) ? "preset" : "values",
  };
}

/**
 * Whether the edit differs from what is saved: a saved value changed (keys the edit lacks are ignored; compared as
 * strings), or the description, name, listening or stations (in any order).
 *
 * @param {Vals} vals
 * @param {Meta} meta
 * @param {{ vals: Vals, meta: Meta }} saved
 * @returns {boolean}
 */
export function isDirty(vals, meta, saved) {
  const valsMoved = Object.keys(saved.vals).some((k) => k in vals && String(vals[k]) !== String(saved.vals[k]));
  const sorted = (/** @type {string[]} */ l) => [...l].sort().join("\u0001");
  return (
    valsMoved ||
    meta.desc !== saved.meta.desc ||
    meta.name !== saved.meta.name ||
    meta.listen !== saved.meta.listen ||
    sorted(meta.stations) !== sorted(saved.meta.stations)
  );
}

/**
 * What the rail and the overview read for each part of a profile at the live level (a fixed volume applies no
 * loudness).
 *
 * @param {Meta} meta
 * @param {Vals} vals
 * @param {Presets} presets
 * @param {{ level: number, fixed: boolean }} env
 * @returns {Summary}
 */
export function summaryOf(meta, vals, presets, env) {
  const scale = env.fixed ? 0 : shelfScale(env.level, Number(vals.ldrlow), Number(vals.ldrhigh));
  return {
    listen: meta.listen,
    crossfeed: {
      on: vals.xfmode !== "off",
      mode: String(vals.xfmode),
      preset: crossfeedPreset(vals, presets)?.label ?? null,
    },
    correction: { on: vals.dcen === "1", model: String(vals.dcdac ?? "") },
    loudness: { on: vals.ldon === "1", percent: percentApplied(scale) },
  };
}

/**
 * Whether the overview's line for a part reads skipped: its step is skipped, except crossfeed while it is engaged.
 *
 * @param {string} id
 * @param {string} skip  why the step is skipped ('' = it applies)
 * @param {Vals} vals
 * @returns {boolean}
 */
export function holdSkipped(id, skip, vals) {
  return !!skip && !(id === "crossfeed" && vals.xfmode !== "off");
}

/**
 * What the step showing lays out: a change to any of these lays it out again.
 *
 * @param {{ at: string, meta: Meta, vals: Vals, known: Known, skip: string }} page  at: the page showing; skip: why it
 *   is skipped
 * @returns {string}
 */
export function shapeOf({ at, meta, vals, known, skip }) {
  return [at, meta.listen, vals.xfmode, known.crossfeed, vals.ldon, known.loudness, skip].join("|");
}

/**
 * Whether the page showing must be laid out again before it paints: a step whose shape moved (the overview and
 * Advanced settings never change shape).
 *
 * @param {string} at
 * @param {string} was  the shape it was laid out with
 * @param {string} now
 * @returns {boolean}
 */
export function needsLayout(at, was, now) {
  return at !== OVERVIEW && at !== "advanced" && now !== was;
}

/**
 * What the step controls show beyond their own values: the Structural preset the angle and center character land on
 * ('' = none), and whether the DAC model is live (correction engaged).
 *
 * @param {Vals} vals
 * @param {StructuralPreset[]} structural
 * @returns {PaintView}
 */
export function paintView(vals, structural) {
  return {
    structural: structuralPreset(structural, vals.xsangle, vals.xslambda)?.v ?? "",
    dacModel: vals.dcen === "1",
  };
}

/**
 * The picker's groups: each station's profiles in list order, keyed as staged edits are, with whether each reads dirty.
 *
 * @param {string[]} stations
 * @param {Record<string, Record<string, unknown>>} book
 * @param {(ref: { st: string, name: string }) => boolean} dirty
 * @returns {PickerGroup[]}
 */
export function pickerOf(stations, book, dirty) {
  return stations.map((st) => ({
    st,
    options: Object.keys(book[st]).map((name) => ({ key: keyOf({ st, name }), name, dirty: dirty({ st, name }) })),
  }));
}

/**
 * What the name box, Delete and the New entry show for the profile being edited: `[Default]`'s name is fixed and it
 * cannot be deleted, nor can New; New reads dirty while staged, or while edited and showing.
 *
 * @param {{ st: string, name: string }} cur
 * @param {boolean} stagedNew  New holds a staged edit
 * @param {boolean} dirtyNow   the edit showing differs from what is saved
 * @returns {RenderView}
 */
export function renderView(cur, stagedNew, dirtyNow) {
  const isNew = cur.name === NEW;
  const fixedName = cur.name === DEFAULT;
  return { fixedName, deletable: !isNew && !fixedName, newDirty: stagedNew || (isNew && dirtyNow) };
}
