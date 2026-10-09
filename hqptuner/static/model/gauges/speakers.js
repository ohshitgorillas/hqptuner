// The Speakers room plan, free of the DOM: which speakers of the set are drawn, where each sits and how far the plan's
// box reaches. A speaker is drawn once its distance or its level is other than 0, HQPlayer's stock value for both,
// meaning nothing entered. The listener is at the origin facing up the page (negative y); a speaker sits at its layout
// angle, clockwise from front, at a radius set by its distance (6 m spans the ring), the sub pushed out past the mains.

/** The listener's head radius on the plan: where a speaker at no distance sits. */
export const HEAD = 13;
const R_MAX = 122,
  DIST_FULL = 600,
  SUB_OUT = 1.35,
  SUB_MAX = 140,
  SUB = 3;

/**
 * One speaker on the plan.
 *
 * @typedef {object} Spot
 * @property {number} i  channel index
 * @property {number} deg  layout angle, degrees clockwise from front (the glyph's rotation)
 * @property {number} x
 * @property {number} y
 * @property {boolean} sub  the sub channel
 */

/**
 * @param {number} i
 * @param {number} d  distance, cm
 */
const radius = (i, d) => {
  const r = HEAD + (Math.max(0, Math.min(DIST_FULL, d)) / DIST_FULL) * (R_MAX - HEAD);
  return i === SUB ? Math.min(r * SUB_OUT, SUB_MAX) : r;
};

/**
 * Whether a value holds something entered: anything but HQPlayer's stock 0.
 *
 * @param {number | undefined} v
 */
const entered = (v) => (v ?? 0) !== 0;

/**
 * Each channel of the set that has a distance or a level entered, on the plan, in set order.
 *
 * @param {readonly number[]} channels  the set's channel indices
 * @param {readonly number[]} layout  each channel's angle, degrees clockwise from front
 * @param {readonly number[]} distances  each channel's distance, cm
 * @param {readonly number[]} levels  each channel's level, dBFS
 * @returns {Spot[]}
 */
export const placeSpeakers = (channels, layout, distances, levels) =>
  channels
    .filter((i) => entered(distances[i]) || entered(levels[i]))
    .map((i) => {
      const a = (layout[i] * Math.PI) / 180,
        r = radius(i, distances[i]);
      return { i, deg: layout[i], x: r * Math.sin(a), y: -r * Math.cos(a), sub: i === SUB };
    });

/**
 * Half the side of the square box, centred on the listener, that fits the head and every speaker with its labels.
 *
 * @param {readonly Spot[]} spots
 * @returns {number}
 */
export const planExtent = (spots) =>
  Math.max(HEAD + 20, ...spots.map((p) => Math.max(Math.abs(p.x) + 26, Math.abs(p.y) + 40)));
