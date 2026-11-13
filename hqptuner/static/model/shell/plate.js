// The plate's layout and size, free of the DOM. The faceplate is laid out at one of three tablet landscape formats in
// CSS px and is never scaled. The display-format choice names the format, which the plate then takes at its exact size
// in any window, or leaves it to the window: under Auto the plate stretches to the window, each direction on its own,
// from Compact's size up to Expanded's, and takes Compact's layout until the window is at least Normal's size, Normal's
// from there, and Expanded's from 916 tall at Normal's width or wider.

/**
 * One tablet landscape format in CSS px. `both`: the Expanded format, tall enough to open both Resampling filters and
 * to show every setting explanation in place, with nothing behind `… see more`. `meter`: how the page's Source meter
 * takes the fill, `full` or `slim`.
 *
 * @typedef {object} PlateFormat
 * @property {string} id
 * @property {number} w
 * @property {number} h
 * @property {boolean} both
 * @property {"slim" | "full"} meter
 */

/**
 * The layout the plate takes, and its size in CSS px: the format's own size for a chosen format, the window's size
 * held between Compact's and Expanded's under Auto.
 *
 * @typedef {PlateFormat} PlateFit
 */

/** The three formats, smallest first: Compact, Normal and Expanded. @type {PlateFormat[]} */
const FORMATS = [
  { id: "compact", w: 1133, h: 744, both: false, meter: "slim" },
  { id: "normal", w: 1180, h: 820, both: false, meter: "slim" },
  { id: "expanded", w: 1366, h: 1024, both: true, meter: "full" },
];

/** The Compact format, the smallest. */
export const COMPACT = FORMATS[0];

const [, NORMAL, EXPANDED] = FORMATS;

/** The window height, CSS px, from which Auto takes Expanded's layout in a window at least Normal's width. */
const EXPANDED_FROM_H = 916;

/** The display-format choices: Auto, then each format's id, largest first. */
export const DISPLAY_FORMATS = ["auto", ...FORMATS.map((f) => f.id).reverse()];

/**
 * Auto's layout for a window: Compact's below Normal's size in either direction, Expanded's from 916 tall at Normal's
 * width or wider, and Normal's between.
 *
 * @param {{ w: number, h: number }} win
 * @returns {PlateFormat}
 */
function autoFormat(win) {
  if (win.w < NORMAL.w) return COMPACT;
  if (win.h >= EXPANDED_FROM_H) return EXPANDED;
  return win.h < NORMAL.h ? COMPACT : NORMAL;
}

/**
 * `v` held between `lo` and `hi`.
 *
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 */
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * The plate for a window and a display-format choice: the chosen format at its own size, or under `auto` Auto's layout
 * at the window's size, each direction held between Compact's and Expanded's.
 *
 * @param {{ w: number, h: number }} win  the window's inner size, CSS px
 * @param {string} [choice]  one of DISPLAY_FORMATS; `auto` where omitted
 * @returns {PlateFit}
 */
export function plateFit(win, choice = "auto") {
  const chosen = FORMATS.find((f) => f.id === choice);
  if (chosen) return { ...chosen };
  return {
    ...autoFormat(win),
    w: clamp(win.w, COMPACT.w, EXPANDED.w),
    h: clamp(win.h, COMPACT.h, EXPANDED.h),
  };
}
