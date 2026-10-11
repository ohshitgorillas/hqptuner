// The plate's size and scale, free of the DOM. The faceplate is laid out at an iPad's landscape size in points and
// reflows into it; it renders 1:1 and scales down only in a window smaller than the smallest size. The app has no size
// control: the window picks.

/**
 * One iPad landscape size in points. `both`: the expanded size, tall enough to open both Resampling filters and to
 * show every setting explanation in place, with nothing behind `… see more`. `meter`: how the page's
 * Source meter takes the fill, `full` or `slim`.
 *
 * @typedef {object} PlateSize
 * @property {string} id
 * @property {number} w
 * @property {number} h
 * @property {boolean} both
 * @property {"slim" | "full"} meter
 */

/**
 * The size the plate is laid out at, and the scale that fits it to the window.
 *
 * @typedef {PlateSize & { scale: number }} PlateFit
 */

/** The three sizes, smallest first: 10.2″, 11″ and 13″. @type {PlateSize[]} */
const SIZES = [
  { id: "10.2", w: 1080, h: 810, both: false, meter: "slim" },
  { id: "11", w: 1180, h: 820, both: false, meter: "slim" },
  { id: "13", w: 1366, h: 1024, both: true, meter: "full" },
];

/**
 * The plate for a window: the largest size the window holds whole, else the smallest, scaled down to fit and never up.
 *
 * @param {{ w: number, h: number }} win  the window's inner size, CSS px
 * @returns {PlateFit}
 */
export function plateFit(win) {
  const held = SIZES.filter((z) => z.w <= win.w && z.h <= win.h);
  const size = held[held.length - 1] ?? SIZES[0];
  return { ...size, scale: Math.min(win.w / size.w, win.h / size.h, 1) };
}
