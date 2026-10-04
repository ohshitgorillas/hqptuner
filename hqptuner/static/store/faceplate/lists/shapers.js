// The shaper lists' own narrowing, which v1 never had: modulators by the DSD rate floor their row badge names, dithers by
// the rate marker their plain-names leaf carries (`Ninth order, ≥4x`). Each facet is the picks, OR across them, empty
// meaning any. Favorites-only narrows the modulators on their own star set, which v1 holds.

import { signal } from "@preact/signals";
import { plainEntry } from "../../plainnames.js";
import { favoriteModulators } from "../../narrow/favorites.js";

/** @typedef {import("./open.js").ListKind} ListKind */

/** The modulator rate floors picked (`512+`), empty for any. @type {{ value: string[] }} */
export const modTier = signal(/** @type {string[]} */ ([]));

/** The dither rate markers picked (`≥4x`), empty for any. @type {{ value: string[] }} */
export const ditherRate = signal(/** @type {string[]} */ ([]));

const RATE_MARK = /≥\d+x/;

/**
 * A dither's rate marker, read off its plain-names leaf whatever the option style; '' when it carries none.
 *
 * @param {string} name
 * @returns {string}
 */
const ditherMark = (name) => (plainEntry("dithers", name)?.leaf.match(RATE_MARK) ?? [""])[0];

/**
 * Whether a shaper survives its list's facets. A modulator list narrows against its own stars only while it has any.
 *
 * @param {{ v: string, tier?: string }} o
 * @param {ListKind} kind
 * @param {{ fav: boolean, modTier: string[], ditherRate: string[] }} st
 * @returns {boolean}
 */
export function shaperKeeps(o, kind, st) {
  if (kind === "modulators") {
    const stars = favoriteModulators.value;
    if (st.fav && stars.size > 0 && !stars.has(o.v)) return false;
    return st.modTier.length === 0 || st.modTier.includes(o.tier ?? "");
  }
  return kind !== "dithers" || st.ditherRate.length === 0 || st.ditherRate.includes(ditherMark(o.v));
}
