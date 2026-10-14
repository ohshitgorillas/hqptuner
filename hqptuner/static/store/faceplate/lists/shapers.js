// The shaper lists' own narrowing: modulators by the DSD rate floor their row badge names, dithers by
// the rate marker their plain-names leaf carries (`Ninth order, ≥4x`). Each facet is a floor: an option at or above
// the lowest pick survives, one with no rate drops out, and no pick means any. Favorites-only narrows the modulators
// on their own star set (store/narrow/favorites.js).

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
 * The multiple a rate text names (`512+`, `≥4x`), or NaN when it names none.
 *
 * @param {string} text
 * @returns {number}
 */
const rateOf = (text) => Number(text.match(/\d+/)?.[0] ?? NaN);

/**
 * Whether a rate text clears the lowest of the picked floors; any rate clears an empty pick, and no rate clears a pick.
 *
 * @param {string[]} picks
 * @param {string} text
 * @returns {boolean}
 */
const clearsFloor = (picks, text) => picks.length === 0 || rateOf(text) >= Math.min(...picks.map(rateOf));

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
    return clearsFloor(st.modTier, o.tier ?? "");
  }
  return kind !== "dithers" || clearsFloor(st.ditherRate, ditherMark(o.v));
}
