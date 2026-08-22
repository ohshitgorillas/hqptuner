// Clicking a collapsible card's head, shared by the disclosure suites.
//
// A card renders as a <section> carrying its own machine identity in
// `data-card`, with the head a pointer presses inside it. There is no DOM under
// `node --test` and preact-render-to-string never fires a handler, so a card is
// toggled the way a caller toggles one: by invoking the onClick the head vnode
// carries, collected through preact's own `options.vnode` creation hook — the
// renderer's public seam, third-party surface, nothing of HQPTuner's stubbed
// (docs/testing.md rule 4).
//
// The head is located INSIDE the section's own subtree, by walking
// `props.children` down from the vnode carrying the `data-card`. The flat
// creation list is no help here: preact builds a vnode's children before the
// vnode itself, so a card's own head appears in that list BEFORE its section
// and the next head after a section belongs to the following card. Containment
// is what "this card's head" means, and it holds whatever order the flat list
// happens to have.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

/** @typedef {import("./wheel.js").VNode} VNode */

/**
 * Every vnode inside one vnode's own children tree, in document order.
 *
 * @param {unknown} node
 * @param {VNode[]} [found]
 * @returns {VNode[]}
 */
function within(node, found = []) {
  if (Array.isArray(node)) {
    for (const kid of node) within(kid, found);
    return found;
  }
  if (!node || typeof node !== "object") return found;
  const v = /** @type {VNode} */ (node);
  found.push(v);
  return within(v.props && v.props.children, found);
}

/**
 * @param {VNode} v
 * @returns {boolean}
 */
const isHead = (v) =>
  v.type === "button" &&
  Boolean(v.props) &&
  typeof v.props.onClick === "function" &&
  String(v.props.class || "")
    .split(/\s+/)
    .includes("card-head");

/**
 * One click on the head of the card carrying an id, as a pointer would land on
 * it. The card is named by its `data-card` and never by the words in its head
 * (docs/testing.md rule 9); anything but a match throws rather than toggling
 * some other card.
 *
 * @param {VNode[]} seen every vnode one render built, in creation order
 * @param {string} card the card's `data-card`
 * @returns {void}
 */
export function clickCardHead(seen, card) {
  const sections = seen.filter((v) => v && v.props && v.props["data-card"] === card);
  if (sections.length !== 1) throw new Error(`expected one card marked "${card}", found ${sections.length}`);
  const [head] = within(sections[0].props.children).filter(isHead);
  if (!head) throw new Error(`no clickable head inside the "${card}" card`);
  /** @type {(event: object) => void} */ (head.props.onClick)({ preventDefault() {}, stopPropagation() {} });
}
