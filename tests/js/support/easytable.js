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

/**
 * Every distinct filter name a preset can put on the SDM chain, across every
 * combination of its knob positions.
 *
 * @param {string} presetId
 * @returns {string[]}
 */
export function sdmNames(presetId) {
  const preset = presetsFor().find((/** @type {Preset} */ p) => String(p.id) === presetId);
  if (preset === undefined) throw new Error(`the table has no preset "${presetId}"`);
  return [
    ...new Set(
      combos(preset.knobs)
        .flatMap((knobs) => SDM_KEYS.map((key) => writeSet(preset.id, "sdm", knobs)[key]))
        .filter(Boolean),
    ),
  ];
}

/**
 * A preset to hang an SDM case on: one writing at least `least` distinct filter
 * names on that chain, and sharing none of them with any other preset, so that
 * classing those names in the enumeration is a statement about that preset
 * alone. Ids are sorted before the pick, so the answer does not ride on the
 * order the owner lays the grid out in.
 *
 * @param {number} [least]
 * @returns {string}
 */
export function sdmSubject(least = 1) {
  const ids = presetsFor()
    .map((/** @type {Preset} */ preset) => String(preset.id))
    .sort();
  const mine = new Map(ids.map((id) => [id, sdmNames(id)]));
  const hit = ids.find((id) => {
    const names = /** @type {string[]} */ (mine.get(id));
    const others = new Set(ids.filter((other) => other !== id).flatMap((other) => mine.get(other) || []));
    return names.length >= least && names.every((name) => !others.has(name));
  });
  if (hit === undefined) throw new Error(`no preset writes ${least} SDM filters of its own`);
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
