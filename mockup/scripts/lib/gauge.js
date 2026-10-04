// What every SVG gauge shares (the response plots, lib/plot-frame.js; the range bars, lib/range-bar.js): the signed dB
// number form and the 1:1 paint at the box's size.

/** A whole dB value with its sign: +6, −6, 0. */
export const signedDb = (d) => (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d);

/**
 * Size the SVG 1:1 to W × H and replace its children with `kids`, flattened two deep and falsy skipped (native
 * replaceChildren does neither).
 *
 * @param {SVGSVGElement} svg
 * @param {number} W
 * @param {number} H
 * @param {any[]} kids
 */
export function paintSvg(svg, W, H, kids) {
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.replaceChildren(...kids.flat(2).filter(Boolean));
}
