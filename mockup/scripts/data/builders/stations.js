// Stations (whole hqplayerd config; recall restarts the engine) and their Snapshots (live subset; no restart).
// Snapshots are always scoped under a station. active: currently loaded. open: tree row expanded.

/**
 * One station and the snapshots scoped under it. `active`: loaded now; `open`: its tree row expanded.
 *
 * @typedef {object} Station
 * @property {string} name
 * @property {boolean} [active]
 * @property {boolean} [open]
 * @property {{ name: string, active?: boolean }[]} snapshots
 */

/** @type {Station[]} */
export const STATIONS = [
  {
    name: "Speakers",
    active: true,
    open: true,
    snapshots: [{ name: "Late night", active: true }, { name: "Daytime" }, { name: "Vinyl rips" }],
  },
  { name: "Headphones", snapshots: [{ name: "Desk" }, { name: "Bed" }] },
  { name: "Office", snapshots: [] },
];
