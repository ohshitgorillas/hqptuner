// The two source signals every narrowing suite drives, reset together.
//
// Narrowing reads the filter list off `enums.filters` — the running engine's
// <GetFilters/> enumeration, `{index, name, value, arg, description}` with the
// apodizing flag decoded from `arg` bit 0 (docs/protocol.md:226) — and the
// static name-keyed overlay off `metadata.filters.filters`, served by
// /api/metadata. A suite that drives one and leaves the other holding another
// case's payload narrows on data no wire ever served, so the two are assigned
// as a pair here and `resetNarrowing()` runs with them: module-level signals
// outlive a test, and a partial reset makes cases pass alone and fail in
// sequence.
//
// The overlay is served EMPTY: these suites state their facts in the engine's
// own description format, so an overlay entry would be a second, competing
// source for the same fact. A suite wanting overlay facts assigns
// `metadata.value` itself afterwards.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { enums, metadata } from "../../../hqptuner/static/store/signals.js";
import { resetNarrowing } from "../../../hqptuner/static/store/narrow/state.js";

/**
 * One fixture row: a filter name, its description in the engine's own format,
 * and an optional `arg` bitfield (apodizing is bit 0).
 *
 * @typedef {[name: string, description: string, arg?: number]} FilterRow
 */

/**
 * One dropdown option, as `narrowOptions` consumes it.
 *
 * @typedef {{ label: string, value: string }} FilterOption
 */

/**
 * The metadata payload with no overlay facts in it — every keyed map present
 * and empty, which is the shape /api/metadata serves before any of its data
 * files has an entry for a name. A fresh object every call: writing the same
 * object reference to a signal does not notify.
 *
 * @returns {import("../../../hqptuner/static/store/prose.js").Metadata}
 */
const bareMetadata = () => ({
  settings: {},
  filters: { filters: {}, aliases: {} },
  shapers: { pcm_dithers: {}, sdm_modulators: {} },
});

/**
 * Serve `rows` as the engine's enumeration and an empty overlay, reset
 * narrowing, and answer with the dropdown options those rows make.
 *
 * @param {FilterRow[]} rows
 * @returns {FilterOption[]}
 */
export function resetFilterFacets(rows) {
  enums.value = {
    filters: rows.map(([name, description, arg = 0], index) => ({
      index: String(index),
      name,
      value: String(index),
      arg,
      description,
      apodizing: Boolean(arg & 1),
    })),
  };
  metadata.value = bareMetadata();
  resetNarrowing();
  return rows.map(([name], index) => ({ label: name, value: String(index) }));
}
