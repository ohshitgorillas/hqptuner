// Which meters the page's Source levels column shows, free of the DOM: slim, the one the Meters pick names, and the
// pick itself offered; full, the level bars and the VU meters both, and no pick. The levels column draws what this
// returns, and the Display popover offers the pick and the rows of the meters it returns.

/**
 * The Source meters shown: whether the Meters pick is offered, whether the level bars show, whether the VU meters show.
 *
 * @typedef {{ pick: boolean, levels: boolean, vu: boolean }} MetersShown
 */

/**
 * The Source meters shown on a slim or full section under the Meters pick `pick`.
 *
 * @param {boolean} slim
 * @param {string} pick  "levels" or "vu"
 * @returns {MetersShown}
 */
export function metersShown(slim, pick) {
  return { pick: slim, levels: !slim || pick === "levels", vu: !slim || pick === "vu" };
}
