// What pressing a preset does, and which error-correction mark the filter it writes wears. Both are read by every
// surface that offers the presets (the Easy Mode tiles, the faceplate's Filter presets popover), so they live under the
// store rather than in either one's component.
//
// Clicking is an ordinary field edit, four of them at most and only for the fields whose value actually changes,
// through whichever lane the page is on (store/easy/easylane.js). No idle gate: a preset is honored whether or not the
// daemon is playing, which is the binding product rule.
import { rememberKnobs } from "./easyview.js";
import { writeSet } from "./easy.js";
import { easyLane } from "./easylane.js";
import { filterFacets } from "../narrow/facets.js";

/**
 * @typedef {import("./easy.js").Preset} Preset
 */

// The fields go one at a time because both lanes write one at a time: staging
// returns the whole pending set on each POST, and a live write re-mirrors the
// engine behind it. Sequential is the honest shape of both.
/**
 * Write one preset's filters at the given knob positions, through this page's lane.
 *
 * @param {string} lane
 * @param {Preset} preset
 * @param {Record<string, string>} knobs
 * @returns {Promise<void>}
 */
export async function applyPreset(lane, preset, knobs) {
  // Recorded before the write, not after: the positions are what the user asked
  // for, and a write that resolves no filter name still leaves the tile showing
  // where they put its knobs. Unconditional, so a press that writes nothing
  // still moves the record. The card's knobs are the card's, so the record
  // keeps the tile's own.
  const own = Object.fromEntries(
    Object.entries(knobs).filter(([id]) => !preset.knobs.some((k) => k.card && k.id === id)),
  );
  rememberKnobs(preset.id, own);
  const l = easyLane(lane);
  for (const [key, name] of Object.entries(writeSet(preset.id, l.mode, knobs))) {
    // A field already holding this filter is skipped. On LIVE every write is a
    // POST the engine acts on, so writing a value a field already holds reloads
    // that filter and interrupts playback to arrive where it already was.
    // This is not an idle gate: the button is never disabled and never refuses,
    // and the state a press leaves behind is the state it names.
    if (l.values[key] === name) continue;
    await l.write(key, name);
  }
}

// Which mark a preset wears. The filters a preset writes all share one apodizing
// class — checked across the whole table, 1x and Nx, PCM and SDM, `-2s` and
// plain — so any one of them answers for the preset, and the PCM chain is asked
// rather than the page's actual output mode. That keeps the mark off the lane
// entirely: building one per preset per render to learn a mode all four fields
// agree on is work for an answer already known.
//
// Derived from the same facet map the health card reads (store/health.js), not
// from a table here: apodizing is a fact about a filter, and a preset naming it
// again is a second place to keep true.
/**
 * The error-correction mark a preset wears at these knob positions.
 *
 * @param {string} presetId
 * @param {Record<string, string>} knobs
 * @returns {"full" | "half" | "none" | undefined} undefined when nothing is known about the filter
 */
export function markFor(presetId, knobs) {
  const name = Object.values(writeSet(presetId, "pcm", knobs))[0];
  const facet = name ? filterFacets.value[name] : undefined;
  if (!facet) return undefined;
  if (facet.apodizing) return "full";
  return facet.apodizingHalf ? "half" : "none";
}
