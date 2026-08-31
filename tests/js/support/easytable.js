// The curated preset table, swept: every write set Easy Mode's table can
// produce, and the filter vocabulary that sweep adds up to.
//
// Not a *.test.js file on purpose: the runner glob would execute it.
//
// It asks the shipped table — `presetsFor` for which presets the card has and
// which knob positions each defines, `writeSet` for what every combination of
// those positions names — rather than restating any of it. A name typed out
// here would be a second copy of the table, drifting the first time the owner
// curates it.
//
// Its own module rather than part of tests/js/support/easytiles.js, because
// both a rendering suite and the pure store suite need it and that harness
// cannot be imported by the latter: it pulls in preact, EasyCard and the store
// signals, and `store/easyview.js` reads localStorage at import.

import { writeSet, presetsFor } from "../../../hqptuner/static/store/easy.js";

/** @typedef {{ id: string, default: string, options: string[] }} Knob */
/** @typedef {{ id: string, emoji: string, knobs: Knob[] }} Preset */

/**
 * Every combination of knob positions a preset defines, defaults included.
 *
 * @param {Knob[]} knobs
 * @returns {Record<string, string>[]}
 */
export const combos = (knobs) =>
  knobs.reduce(
    (/** @type {Record<string, string>[]} */ acc, knob) =>
      acc.flatMap((one) => knob.options.map((option) => ({ ...one, [knob.id]: option }))),
    [{}],
  );

/** Every write set the table can produce, every knob position included. */
export const everyWrite = () =>
  presetsFor().flatMap((/** @type {Preset} */ preset) =>
    combos(preset.knobs).map((knobs) => writeSet(preset.id, "auto", knobs)),
  );

/**
 * Every distinct filter name the card's presets can write, across all four
 * schema keys and every knob combination — the whole vocabulary Easy Mode can
 * put in front of the daemon.
 *
 * @returns {string[]}
 */
export const namesWritten = () => [
  ...new Set(
    everyWrite()
      .flatMap((set) => Object.values(set))
      .filter(Boolean),
  ),
];

// --- picking a subject preset out of the table, without naming one -----------------
//
// A case about the SDM chain needs A preset whose SDM writes it can class in the
// seeded enumeration. WHICH preset that is stays the table's business: naming
// one here would pin a curated display list (docs/testing.md rule 9) and would
// go stale the first time the owner recurates the grid. So the subject is
// derived — the table is asked which presets it has, what each writes on the
// SDM chain at every knob position, and the first one meeting the case's
// requirements is handed back by id.

const SDM_KEYS = ["sdm_filter_1x", "sdm_filter_nx"];

/** One preset of the shipped table, by id. */
const presetOf = (/** @type {string} */ presetId) => {
  const preset = presetsFor().find((/** @type {Preset} */ p) => String(p.id) === presetId);
  if (preset === undefined) throw new Error(`the table has no preset "${presetId}"`);
  return preset;
};

/**
 * Every distinct filter name a preset can put on the SDM chain, across every
 * combination of its knob positions.
 *
 * @param {string} presetId
 * @returns {string[]}
 */
export function sdmNames(presetId) {
  const preset = presetOf(presetId);
  return [
    ...new Set(
      combos(preset.knobs)
        .flatMap((knobs) => SDM_KEYS.map((key) => writeSet(preset.id, "sdm", knobs)[key]))
        .filter(Boolean),
    ),
  ];
}

/**
 * Every preset an SDM case may be hung on: one writing filter names on that
 * chain and sharing none of them with any other preset, so that classing those
 * names in the enumeration is a statement about that preset alone. Ids are
 * sorted, so a pick off this list does not ride on the order the owner lays the
 * grid out in.
 *
 * @returns {string[]}
 */
function sdmSubjects() {
  const ids = presetsFor()
    .map((/** @type {Preset} */ preset) => String(preset.id))
    .sort();
  const mine = new Map(ids.map((id) => [id, sdmNames(id)]));
  return ids.filter((id) => {
    const names = /** @type {string[]} */ (mine.get(id));
    const others = new Set(ids.filter((other) => other !== id).flatMap((other) => mine.get(other) || []));
    return names.length > 0 && names.every((name) => !others.has(name));
  });
}

/**
 * The first of those writing at least `least` distinct names.
 *
 * @param {number} [least]
 * @returns {string}
 */
export function sdmSubject(least = 1) {
  const hit = sdmSubjects().find((id) => sdmNames(id).length >= least);
  if (hit === undefined) throw new Error(`no preset writes ${least} SDM filters of its own`);
  return hit;
}

/**
 * The SDM filter names a preset writes at its OWN default knob positions — the
 * one combination a tile shows before anything is pressed. Stated through each
 * knob's `default` rather than through an empty knob map, so it is the table's
 * declared resting position and not a coincidence of how a missing position is
 * resolved.
 *
 * @param {string} presetId
 * @returns {string[]}
 */
function sdmDefaultNames(presetId) {
  const preset = presetOf(presetId);
  const resting = Object.fromEntries(preset.knobs.map((knob) => [knob.id, knob.default]));
  return [...new Set(SDM_KEYS.map((key) => writeSet(preset.id, "sdm", resting)[key]).filter(Boolean))];
}

/**
 * The SDM filter names a preset reaches ONLY away from its default knob
 * positions. A case classing one of these is asking whether the reader swept the
 * preset's other combinations at all: an implementation looking only at the
 * resting position never meets the name.
 *
 * @param {string} presetId
 * @returns {string[]}
 */
export function sdmOffDefaultNames(presetId) {
  const resting = new Set(sdmDefaultNames(presetId));
  return sdmNames(presetId).filter((name) => !resting.has(name));
}

/**
 * A preset to hang a SWEEP case on: one of its own filters (`sdmSubject`'s
 * disjointness) that it reaches only by moving a knob off its default.
 *
 * @returns {string}
 */
export function sdmSweepSubject() {
  const hit = sdmSubjects().find((id) => sdmOffDefaultNames(id).length > 0);
  if (hit === undefined) throw new Error("no preset of its own reaches an SDM filter off its default knobs");
  return hit;
}

/**
 * One ratio class for every name in a list, as the `classes` seam of
 * tests/js/support/easytiles.js takes it.
 *
 * @param {string[]} names
 * @param {string} cls
 * @returns {Record<string, string>}
 */
export const classedAs = (names, cls) => Object.fromEntries(names.map((name) => [name, cls]));
