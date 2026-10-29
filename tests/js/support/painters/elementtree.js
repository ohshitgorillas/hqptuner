// A fake element tree built from rendered markup, for painters that are created on a rendered root and then write
// to the elements they found there. No test() and no assert lives here.
//
// `elementTree(markup)` parses the markup with tests/js/support/markup.js and returns a host element, `root`, whose
// children are the fragment's top-level elements. Each element answers the reads a painter may make at creation:
// `querySelector`, `querySelectorAll` (simple selectors: tag, `*`, `#id`, `.class`, `[a]`, `[a=v]`, `[a="v"]`,
// `[a~=v]`, `[a^=v]`, `[a$=v]`, `[a*=v]`, compounds of those, descendant and `>` combinators, `,` lists),
// `matches`, `closest`, `getAttribute`, `hasAttribute`, `dataset`, `classList.contains`, `children`,
// `firstElementChild`, `parentElement`, `tagName`, `localName`. An unsupported selector throws, so a painter asking
// for one fails loudly instead of finding nothing.
//
// Every write is kept: `setAttribute`, `removeAttribute`, any assignment to an element property, and any assignment
// to or `setProperty` on its `style`. `writes()` returns the elements written since the last `mark()`.
//
// `darken()` makes every read answer as if the tree were empty: queries find nothing, attributes read absent, the
// tree has no children. Writes still land. A painter that found its elements and read its geometry at creation keeps
// working after `darken()`; one that reads on a paint does not.
//
// `rotation(el)` is the angle an element was last turned to, in degrees clockwise from upright: the first argument of
// `rotate(...)` in its `transform` attribute or, failing that, its style's `transform`, with a unit of deg, rad,
// grad or turn (none means degrees). NaN when it carries no rotation.
//
// Selector parsing and matching live in tests/js/support/painters/elementtree/selector.js, the elements in
// tests/js/support/painters/elementtree/element.js.

import { elements } from "../markup.js";
import { rotateOf } from "../page.js";
import { node } from "./elementtree/element.js";

/** @typedef {import("../markup.js").MarkupElement} MarkupElement */
/** @typedef {import("./elementtree/element.js").Node} Node */
/** @typedef {import("./elementtree/element.js").Ctx} Ctx */

/**
 * @typedef {object} FakeElement
 * @property {string} tagName
 * @property {string} localName
 * @property {FakeElement[]} children
 * @property {FakeElement | null} firstElementChild
 * @property {FakeElement | null} parentElement
 * @property {Record<string, string | undefined>} dataset
 * @property {{ contains(name: string): boolean }} classList
 * @property {Record<string, unknown> & { setProperty(name: string, value: string): void }} style
 * @property {(name: string) => string | null} getAttribute
 * @property {(name: string) => boolean} hasAttribute
 * @property {(name: string, value: string) => void} setAttribute
 * @property {(name: string) => void} removeAttribute
 * @property {(selector: string) => FakeElement | null} querySelector
 * @property {(selector: string) => FakeElement[]} querySelectorAll
 * @property {(selector: string) => boolean} matches
 * @property {(selector: string) => FakeElement | null} closest
 */

/**
 * @typedef {object} ElementTree
 * @property {FakeElement} root  the host the markup was rendered into
 * @property {FakeElement[]} all  every element of the markup, in document order, the host excluded
 * @property {() => void} mark  forget the writes made so far
 * @property {() => FakeElement[]} writes  the elements written since the last mark, each once, in document order
 * @property {() => void} darken  make every read find nothing from now on
 * @property {(el: FakeElement) => number} rotation  degrees clockwise from upright, NaN when not rotated
 * @property {(el: FakeElement, inside: FakeElement) => boolean} within  whether `el` is `inside` or under it
 */

const ENTITIES = /** @type {Record<string, string>} */ ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" });

/**
 * @param {string} s
 * @returns {string}
 */
const decode = (s) =>
  s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, name) => {
    if (name[0] !== "#") return ENTITIES[name] ?? whole;
    return String.fromCodePoint(
      name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1)),
    );
  });

/**
 * @param {string} run
 * @returns {Map<string, string>}
 */
function parseAttrs(run) {
  /** @type {Map<string, string>} */
  const out = new Map();
  const attr = /([^\s=/]+)(?:\s*=\s*"([^"]*)")?/g;
  let m;
  while ((m = attr.exec(run)) !== null) out.set(m[1], decode(m[2] ?? ""));
  return out;
}

/**
 * The node `n` stands directly in: the smallest node whose span holds its span and is longer, the host when none.
 *
 * @param {Node} n
 * @param {Node[]} nodes
 * @param {Node} host
 * @returns {Node}
 */
function parentOf(n, nodes, host) {
  let parent = host;
  for (const m of nodes) {
    if (m !== n && m.start <= n.start && n.end <= m.end && m.end - m.start > n.end - n.start) {
      if (parent === host || m.end - m.start < parent.end - parent.start) parent = m;
    }
  }
  return parent;
}

/**
 * Builds the tree.
 *
 * @param {string} markup
 * @returns {ElementTree}
 */
export function elementTree(markup) {
  const found = elements(markup).sort((a, b) => a.start - b.start);
  const ctx = /** @type {Ctx} */ ({ dark: false, written: new Set() });
  const host = node(ctx, { name: "div", attrs: new Map(), start: -1, end: Infinity });
  ctx.host = host;
  const nodes = found.map((e) =>
    node(ctx, { name: e.name, attrs: parseAttrs(e.attrs), start: e.start, end: e.start + e.html.length }),
  );
  for (const n of nodes) {
    const parent = parentOf(n, nodes, host);
    n.parent = parent;
    parent.kids.push(n);
  }
  /** @type {Map<FakeElement, Node>} */
  const byElement = new Map([host, ...nodes].map((n) => [n.el, n]));

  return {
    root: host.el,
    all: nodes.map((n) => n.el),
    mark: () => {
      ctx.written = new Set();
    },
    writes: () => nodes.filter((n) => ctx.written.has(n)).map((n) => n.el),
    darken: () => {
      ctx.dark = true;
    },
    rotation: (el) => {
      const n = byElement.get(el);
      if (n === undefined) return NaN;
      const fromAttr = rotateOf(n.attrs.get("transform"));
      return Number.isNaN(fromAttr) ? rotateOf(n.style.get("transform")) : fromAttr;
    },
    within: (el, inside) => {
      const target = byElement.get(inside);
      for (let n = byElement.get(el) ?? null; n !== null; n = n.parent) if (n === target) return true;
      return false;
    },
  };
}
