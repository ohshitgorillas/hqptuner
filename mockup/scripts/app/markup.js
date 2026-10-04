// Lookups into markup the page always holds: index.html's static regions and the parts every rail stage and switcher
// slot is built with. A missing element throws where it is used, as the untyped lookup would.

/**
 * The element `sel` names under `root` (the document by default).
 *
 * @param {string} sel
 * @param {ParentNode} [root]
 * @returns {HTMLElement}
 */
export const el = (sel, root = document) => /** @type {HTMLElement} */ (root.querySelector(sel));
