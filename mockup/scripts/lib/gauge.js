// What every SVG gauge shares (the response plots, lib/plot-frame.js; the range bars, lib/range-bar.js): the 1:1 paint
// at the box's size. Their signed dB numbers are model/format.js signed.

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
