// The plate's format and scale, free of the DOM. The faceplate is laid out at one of three tablet landscape formats in
// CSS px and reflows into it; it scales down to fit the window and never up. The display-format choice names the
// format, or leaves it to the window: Auto gives the window the largest format that still renders at a scale of 0.95 or
// above, and Compact when none does.

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
 * The format the plate is laid out at, and the scale that fits it to the window.
 *
 * @typedef {PlateFormat & { scale: number }} PlateFit
 */

/** The three formats, smallest first: Compact, Normal and Expanded. @type {PlateFormat[]} */
const FORMATS = [
  { id: "compact", w: 1133, h: 744, both: false, meter: "slim" },
  { id: "normal", w: 1180, h: 820, both: false, meter: "slim" },
  { id: "expanded", w: 1366, h: 1024, both: true, meter: "full" },
];

/** The Compact format, the smallest. */
export const COMPACT = FORMATS[0];

/** The lowest scale at which Auto still gives the window a format. */
const AUTO_FLOOR = 0.95;

/** The display-format choices: Auto, then each format's id, largest first. */
export const DISPLAY_FORMATS = ["auto", ...FORMATS.map((f) => f.id).reverse()];

/**
 * The scale that fits `format` to the window, never above 1.
 *
 * @param {{ w: number, h: number }} win
 * @param {PlateFormat} format
 * @returns {number}
 */
function fitScale(win, format) {
  return Math.min(win.w / format.w, win.h / format.h, 1);
}

/**
 * Auto's format for a window: the largest whose scale-to-fit is 0.95 or above, else Compact.
 *
 * @param {{ w: number, h: number }} win
 * @returns {PlateFormat}
 */
function autoFormat(win) {
  const held = FORMATS.filter((f) => fitScale(win, f) >= AUTO_FLOOR);
  return held[held.length - 1] ?? FORMATS[0];
}

/**
 * The plate for a window and a display-format choice: the chosen format, or Auto's pick where the choice is `auto`,
 * scaled down to fit and never up.
 *
 * @param {{ w: number, h: number }} win  the window's inner size, CSS px
 * @param {string} [choice]  one of DISPLAY_FORMATS; `auto` where omitted
 * @returns {PlateFit}
 */
export function plateFit(win, choice = "auto") {
  const format = FORMATS.find((f) => f.id === choice) ?? autoFormat(win);
  return { ...format, scale: fitScale(win, format) };
}
