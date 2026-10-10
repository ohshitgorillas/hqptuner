// DOM-free geometry for a knockout: the patch of background painted under a label and over every mark beneath it, so no
// mark is drawn across the label's letters.

/**
 * A drawn text's box in its drawing's units, as the text's own bounding box reports it.
 *
 * @typedef {object} TextBox
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

const PAD = 4; // how far a knockout reaches past each side of its label, in drawing units

/**
 * The knockout under a label: the label's box, widened by PAD on each side. Its height is the box's own, the font's
 * line, which already clears the letters above and below.
 *
 * @param {TextBox} box
 * @returns {TextBox}
 */
export function knockout(box) {
  return { x: box.x - PAD, y: box.y, width: box.width + 2 * PAD, height: box.height };
}
