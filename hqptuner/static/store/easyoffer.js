// Which Easy Mode presets the grid offers at all, as opposed to which one is
// marked. The curated table and its write sets live in store/easy.js, which is
// deliberately pure — no signals, no engine state; this module is where a
// preset meets what the engine can currently do with it.
//
// One rule so far: a tile whose every path leads to a filter that can produce
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
import { combos, presetsFor, writeSet } from "./easy.js";
import { dsd44kOnly, rateLimited } from "./narrow/match.js";

/** @typedef {import("./easy.js").Preset} Preset */

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
