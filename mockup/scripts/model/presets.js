// What a subset preset nested under a flagship shows, free of the DOM: the filter it names, the cost it carries, its
// correction coverage and whether it offers a Correction toggle. components/filter-presets.js builds the row from it; the
// lineage table is data/presets.js LINEAGE.rows.

/** @typedef {{ pips?: number, word?: string }} Cost */
/** @typedef {{ fixed?: string, on?: string, off?: string, cost: Cost }} Version */

/**
 * A subset preset in one flagship's version, with Correction on or off. Correction Off costs one pip less, never below
 * one; a fixed version (no non-correcting twin) or a cost given as a word does not move, and a fixed version always
 * corrects and offers no toggle.
 *
 * @param {Record<string, Record<string, Version>>} rows  versions by subset id, then by flagship lane
 * @param {string} id  the subset preset
 * @param {string} lane  the flagship it is nested under
 * @param {boolean} on  its Correction setting
 * @returns {{ filter: string | undefined, cost: Cost, correction: 'full' | 'none', toggle: boolean }}
 */
export function subsetVersion(rows, id, lane, on) {
  const c = rows[id][lane];
  return {
    filter: c.fixed || (on ? c.on : c.off),
    cost: c.cost.pips && !c.fixed && !on ? { pips: Math.max(1, c.cost.pips - 1) } : c.cost,
    correction: c.fixed || on ? "full" : "none",
    toggle: !c.fixed,
  };
}
