// The header's Station · Snapshot tree: one station per named preset the config offers, the loaded one active, each
// with the live snapshots saved under its name. One station's snapshots are unfolded at a time.

import { signal } from "@preact/signals";
import { config } from "../signals.js";
import { activePreset } from "../resolve.js";
import { liveBook } from "../live/presets.js";

/**
 * @typedef {object} Station  one station of the tree
 * @property {string} name  the preset's name
 * @property {boolean} active  loaded now
 * @property {boolean} open  its snapshots unfolded
 * @property {{ name: string }[]} snapshots
 */

/** The station whose snapshots are unfolded, or null. @type {{ value: string | null }} */
export const unfolded = signal(/** @type {string | null} */ (null));

/**
 * A station chevron's tap: its snapshots unfold in place of any other's, or fold when they are the unfolded ones.
 *
 * @param {string} name
 */
export function toggleStation(name) {
  unfolded.value = unfolded.value === name ? null : name;
}

/**
 * Every station the config offers, in its order.
 *
 * @returns {Station[]}
 */
export function stationTree() {
  /** @type {{ value: string }[]} */
  const options = config.value?.profiles?.options ?? [];
  const book = liveBook.value ?? {};
  return options
    .filter((o) => o.value !== "")
    .map((o) => ({
      name: o.value,
      active: o.value === activePreset.value,
      open: o.value === unfolded.value,
      snapshots: Object.keys(book[o.value] ?? {}).map((name) => ({ name })),
    }));
}
