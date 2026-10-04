// SVG glyphs more than one drawing shares: the listener's head with its nose, a speaker cabinet, and the hatch fill
// for what doesn't run. Each returns plain SVG; the caller places it.

import { s } from './dom.js';

/**
 * The listener seen from above: the head circle, then the nose pointing up the page, its tip `tip` above the head.
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {number} tip
 * @returns {SVGElement[]}
 */
export const headGlyph = (cx, cy, r, tip) => [
  s('circle.head', { cx, cy, r }),
  s('path.nose', { d: `M${cx - 4},${cy - r + 1} L${cx},${cy - r - tip} L${cx + 4},${cy - r + 1}` }),
];

/**
 * A speaker seen from above at (x, y), turned deg clockwise: the cabinet with its driver, or a square box for a sub.
 * @param {number} x
 * @param {number} y
 * @param {number} deg
 * @param {boolean} [sub]
 * @returns {SVGElement}
 */
export const speakerGlyph = (x, y, deg, sub = false) => s('g', { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg})` },
  sub ? s('rect', { x: -9, y: -9, width: 18, height: 18, rx: 2 })
    : [s('rect', { x: -10, y: -8, width: 20, height: 16, rx: 2 }), s('circle.drv', { cx: 0, cy: 3.5, r: 3 })]);

/**
 * Hatch pattern defs: 45° stripes every 6 units, filled as url(#id). cls names the pattern, an optional backing square
 * and the stripe.
 * @param {string} id
 * @param {{pattern?: string, back?: string, line?: string}} [cls]
 * @returns {SVGElement}
 */
export const hatchDefs = (id, { pattern, back, line } = {}) => s('defs', {},
  s(`pattern#${id}`, { class: pattern, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
    back && s('rect', { class: back, width: 6, height: 6 }),
    s('line', { class: line, x1: 0, y1: 0, x2: 0, y2: 6 })));
