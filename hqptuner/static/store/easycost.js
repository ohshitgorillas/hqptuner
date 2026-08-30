// How much Easy Mode's curated presets cost the machine, in pips. The roster
// and the write tables live in store/easy.js; this module holds the cost
// tables and the one question asked of them, and is pure the same way — no
// signals, no DOM, no network.

// What a preset costs the machine, in pips, per chain. Neither column is a
// filter specification: both rank the presets against each other and say nothing
// about how any filter is designed.
//
// The SDM column is measured. Each preset's Space filter was loaded in turn on a
// playing engine and GPU power and utilization sampled, the two channels agreeing
// on the ranking once the shaper's floor is subtracted. Old School sets the scale
// at one pip. The measurement was taken on the SDM chain only, so it says nothing
// about PCM.
//
// The PCM column is the owner's ranking, unmeasured, and does not follow the SDM
// one.
//
// Only Damage Control changes family when its material knob moves: its lossless
// positions take the xtr-short filters and its lossy ones the mqa/mp3 family, so
// it is the one preset with a second row. The flagships take the same family in
// both positions and cost the same in both.
/**
 * @type {Record<string, {sdm: number, pcm: number}>}
 */
const PIPS = {
  "perfect-ten": { sdm: 2, pcm: 1 },
  lifelike: { sdm: 2, pcm: 1 },
  "concert-hall": { sdm: 17, pcm: 8 },
  purist: { sdm: 2, pcm: 1 },
  "old-school": { sdm: 1, pcm: 1 },
  "damage-control": { sdm: 1, pcm: 3 },
  textbook: { sdm: 1, pcm: 1 },
};

// The SDM figure matches the row above: on that chain Damage Control costs the
// same whichever material it is aimed at. The PCM figure is the one this row
// exists for.
/** @type {Record<string, {sdm: number, pcm: number}>} */
const LOSSY_PIPS = { "damage-control": { sdm: 1, pcm: 1 } };

// The presets whose Emphasis knob picks a filter LENGTH rather than a phase:
// Space takes the longer filter of the pair. On the rest of the card the knob
// moves between `-lp` and `-mp`, which is the same filter run at a different
// phase and the same work either way.
//
// The extra pip applies OFF THE SDM CHAIN ONLY. Measured, the longer filter of a
// pair costs a few percent more than the shorter, which is far under what a pip
// can say, so the SDM column reads the same in both positions. The PCM column
// keeps the pip because no measurement has been taken on that chain to replace
// it, and there it is the Transients figure that the table states.
const LENGTH_EMPHASIS = new Set(["perfect-ten", "lifelike", "purist"]);

/**
 * How many pips a preset shows for an output mode — 0 for a preset this module
 * does not carry.
 *
 * Auto shows the PCM number rather than both or the larger: nearly all material
 * is PCM, and a tile that quoted the SDM cost to someone who will never reach
 * that chain would be quoting a number that never comes true for them.
 *
 * @param {string} presetId
 * @param {string} outputMode "pcm" | "sdm" | "auto"
 * @param {Record<string, string>} [knobs] knob id -> option id
 * @returns {number}
 */
export function pipsFor(presetId, outputMode, knobs = {}) {
  const row = (knobs.material === "lossy" && LOSSY_PIPS[presetId]) || PIPS[presetId];
  if (!row) return 0;
  const sdm = outputMode === "sdm";
  let cost = sdm ? row.sdm : row.pcm;
  if (!sdm && knobs.emphasis === "space" && LENGTH_EMPHASIS.has(presetId)) cost += 1;
  // Error correction off costs one pip less, which is the same thing that knob's
  // own tip says in words. One pip rather than a proportion: the tiles carrying
  // the knob are the expensive ones, and a pip is the smallest thing this scale
  // can say.
  return knobs.correction === "off" ? Math.max(cost - 1, 1) : cost;
}
