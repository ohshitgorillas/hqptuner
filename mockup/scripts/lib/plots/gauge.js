// What every SVG gauge shares (the response plots, lib/plot-frame.js; the range bars, lib/range-bar.js): the 1:1 paint
// at the box's size. Their signed dB numbers are model/format.js signed.

/**
 * One child a gauge paints: a node or text, or a falsy value that is skipped.
 *
 * @typedef {Node | string | false | null | undefined} Paint
 */

/**
 * Whether a child is painted (not falsy).
 *
 * @param {Paint} k
 * @returns {k is Node | string}
 */
const painted = (k) => Boolean(k);

/**
 * Size the SVG 1:1 to W × H and replace its children with `kids`, flattened two deep and falsy skipped (native
 * replaceChildren does neither).
 *
 * @param {SVGSVGElement} svg
 * @param {number} W
 * @param {number} H
 * @param {(Paint | (Paint | Paint[])[])[]} kids
 */
export function paintSvg(svg, W, H, kids) {
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", String(W));
  svg.setAttribute("height", String(H));
  svg.replaceChildren(...kids.flat(2).filter(painted));
}
