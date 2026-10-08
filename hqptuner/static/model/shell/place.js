// Popover placement on the plate, free of the DOM: where a plate-level panel lands against the element that opened it,
// and how the plate's side and foot margins pull it back inside. A test drives it from a
// table.

/**
 * An anchor's box in screen px, measured from the plate's top-left corner (the scale has not been divided out).
 *
 * @typedef {object} Rect
 * @property {number} left
 * @property {number} top
 * @property {number} width
 * @property {number} height
 */

/**
 * A size in layout px.
 *
 * @typedef {object} Size
 * @property {number} w
 * @property {number} h
 */

/**
 * Where the panel goes against its anchor.
 * x: 'start' shares the anchor's left edge; 'before' ends `gap` px short of it (the panel sits to its left).
 * y: 'top' shares the anchor's top edge; 'below' drops `gap` px under it; 'flip' drops under it, or opens `gap` px above
 * it when below would cross the foot (no clamp after: the flip is how it stays inside).
 *
 * @typedef {object} Place
 * @property {'start' | 'before'} x
 * @property {'top' | 'below' | 'flip'} y
 * @property {number} gap
 */

/** Least room kept between the panel and a plate edge, in layout px; null leaves that edge open. @typedef {number | null} Margin */

/** Both side margins, or [left, right]. @typedef {Margin | [Margin, Margin]} Side */

/** @param {Margin} m */
const room = (m) => m ?? -Infinity;

/** The top-left corner of the panel's containing block on the plate, in layout px. @typedef {{x: number, y: number}} Origin */

/** A panel positioned against the plate itself. @type {Origin} */
const ON_PLATE = { x: 0, y: 0 };

/**
 * The panel's top-left corner, in layout px from its containing block's corner (`origin`, the plate's own by default).
 * The margins and the clamp are the plate's whatever box the panel sits in. A panel wider than the room between the
 * side margins keeps its left edge at the left margin.
 *
 * @param {{anchor: Rect, panel: Size, plate: Size, scale: number, side: Side, foot: Margin, at: Place, origin?: Origin}} o
 * @returns {{left: number, top: number}}
 */
export function clampToPlate({ anchor, panel, plate, scale, side, foot, at, origin = ON_PLATE }) {
  const [l, r] = Array.isArray(side) ? side : [side, side];
  const x = anchor.left / scale,
    y = anchor.top / scale;
  const x0 = at.x === "before" ? x - panel.w - at.gap : x;
  const left = Math.max(room(l), Math.min(x0, plate.w - room(r) - panel.w)) - origin.x;
  const floor = plate.h - room(foot);
  if (at.y === "top") return { left, top: Math.min(y, floor - panel.h) - origin.y };
  const below = y + anchor.height / scale + at.gap;
  if (at.y === "below") return { left, top: Math.min(below, floor - panel.h) - origin.y };
  return { left, top: (below + panel.h > floor ? y - panel.h - at.gap : below) - origin.y };
}
