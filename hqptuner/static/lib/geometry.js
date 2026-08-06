// Shared SVG geometry for the diagram components.

// Polar-to-cartesian around a fixed centre, in the convention both diagrams
// draw in: 0° is straight up (away from the listener) and degrees run
// clockwise, so a speaker at +30° lands front-right. Returned as [x, y] for
// direct destructuring into SVG coordinates.
//
// A factory rather than a plain polar(deg, r, cx, cy): each diagram has its own
// centre constants, and binding them once keeps all eight call sites reading as
// polar(angle, radius) instead of carrying the centre through every call.
/**
 * @param {number} cx
 * @param {number} cy
 * @returns {(deg: number, r: number) => number[]}
 */
export const polarAround = (cx, cy) => (deg, r) => {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
};
