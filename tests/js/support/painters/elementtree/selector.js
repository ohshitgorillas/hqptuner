// The selectors the fake page of tests/js/support/page.js answers: parsing a selector list into chains of compounds,
// and matching a node against them. No test() and no assert lives here.
//
// A selector list is split at `,`; each selector is split into compounds at whitespace and at `>`, which stands as a
// combinator of its own wherever it appears. A compound is a run of parts: a tag or `*`, `#id`, `.class`, or an
// attribute test `[a]`, `[a=v]`, `[a="v"]`, `[a='v']`, `[a~=v]`, `[a^=v]`, `[a$=v]`, `[a*=v]`, or `:not(compound)`,
// which passes a node the compound inside it does not match. An unsupported part or an empty selector throws.

/**
 * @typedef {{ name: string, op: string, value: string }} AttrTest
 * @typedef {{ tag: string | null, id: string | null, classes: string[], attrs: AttrTest[], nots: Compound[] }} Compound
 * @typedef {{ compound: Compound, combinator: string }[]} Chain
 */

/**
 * What matching reads of a node: its tag name, its attributes and its parent.
 *
 * @typedef {object} SelectorNode
 * @property {string} name
 * @property {Map<string, string>} attrs
 * @property {SelectorNode | null} parent
 */

/**
 * One kind of compound part: the pattern that reads it off the front of a compound, and where it puts what it read.
 *
 * @typedef {{ pattern: RegExp, put: (c: Compound, m: RegExpExecArray) => void }} Part
 */

/** @type {Part[]} */
const PARTS = [
  {
    pattern: /^(\*|[a-zA-Z][\w-]*)/,
    put: (c, m) => {
      c.tag = m[1] === "*" ? null : m[1].toLowerCase();
    },
  },
  {
    pattern: /^#([\w-]+)/,
    put: (c, m) => {
      c.id = m[1];
    },
  },
  {
    pattern: /^\.([\w-]+)/,
    put: (c, m) => {
      c.classes.push(m[1]);
    },
  },
  {
    pattern: /^\[\s*([\w:-]+)\s*(?:([~^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*)?\]/,
    put: (c, m) => {
      c.attrs.push({ name: m[1], op: m[2] ?? "", value: m[3] ?? m[4] ?? m[5] ?? "" });
    },
  },
  {
    pattern: /^:not\(([^()]+)\)/,
    put: (c, m) => {
      c.nots.push(parseCompound(m[1]));
    },
  },
];

/**
 * The part at the front of `rest`, and what its pattern read; null when no part starts there.
 *
 * @param {string} rest
 * @returns {{ part: Part, m: RegExpExecArray } | null}
 */
function frontPart(rest) {
  for (const part of PARTS) {
    const m = part.pattern.exec(rest);
    if (m) return { part, m };
  }
  return null;
}

/**
 * @param {string} text
 * @returns {Compound}
 */
function parseCompound(text) {
  /** @type {Compound} */
  const c = { tag: null, id: null, classes: [], attrs: [], nots: [] };
  let rest = text;
  while (rest.length > 0) {
    const front = frontPart(rest);
    if (front === null) throw new Error(`elementtree: unsupported selector part "${rest}" in "${text}"`);
    front.part.put(c, front.m);
    rest = rest.slice(front.m[0].length);
  }
  return c;
}

/**
 * One selector's tokens: each run of characters that are neither whitespace nor `>`, and each `>` on its own.
 *
 * @param {string} one
 * @returns {string[]}
 */
function tokenize(one) {
  /** @type {string[]} */
  const out = [];
  let word = "";
  const flush = () => {
    if (word !== "") out.push(word);
    word = "";
  };
  for (const ch of one) {
    if (ch === ">") {
      flush();
      out.push(">");
    } else if (/\s/.test(ch)) {
      flush();
    } else {
      word += ch;
    }
  }
  flush();
  return out;
}

/**
 * Parses a selector list, one chain per selector.
 *
 * @param {string} selector
 * @returns {Chain[]}
 */
export function parseSelector(selector) {
  return selector.split(",").map((one) => {
    /** @type {Chain} */
    const chain = [];
    let combinator = " ";
    for (const token of tokenize(one)) {
      if (token === ">") {
        combinator = ">";
        continue;
      }
      chain.push({ compound: parseCompound(token), combinator });
      combinator = " ";
    }
    if (chain.length === 0) throw new Error(`elementtree: empty selector "${selector}"`);
    return chain;
  });
}

/**
 * The classes a node's `class` attribute lists.
 *
 * @param {Map<string, string>} attrs
 * @returns {string[]}
 */
const classesOf = (attrs) => (attrs.get("class") ?? "").split(/\s+/);

/**
 * @param {string | undefined} have
 * @param {string} op
 * @param {string} want
 * @returns {boolean}
 */
function attrMatches(have, op, want) {
  if (have === undefined) return false;
  if (op === "") return true;
  if (op === "=") return have === want;
  if (op === "~=") return have.split(/\s+/).includes(want);
  if (op === "^=") return want !== "" && have.startsWith(want);
  if (op === "$=") return want !== "" && have.endsWith(want);
  return want !== "" && have.includes(want);
}

/**
 * One matcher per kind of compound part, each passing a compound that carries no part of its kind.
 *
 * @type {((n: SelectorNode, c: Compound) => boolean)[]}
 */
const PART_MATCHERS = [
  (n, c) => c.tag === null || n.name.toLowerCase() === c.tag,
  (n, c) => c.id === null || n.attrs.get("id") === c.id,
  (n, c) => {
    const cls = classesOf(n.attrs);
    return c.classes.every((k) => cls.includes(k));
  },
  (n, c) => c.attrs.every((a) => attrMatches(n.attrs.get(a.name), a.op, a.value)),
  (n, c) => c.nots.every((not) => !compoundMatches(n, not)),
];

/**
 * @param {SelectorNode} n
 * @param {Compound} c
 * @returns {boolean}
 */
function compoundMatches(n, c) {
  return PART_MATCHERS.every((matcher) => matcher(n, c));
}

/**
 * Whether `n` matches the chain up to and including link `at`, its ancestors looked for no higher than `scope`.
 *
 * @param {SelectorNode} n
 * @param {Chain} chain
 * @param {number} at
 * @param {SelectorNode} scope
 * @returns {boolean}
 */
function chainMatches(n, chain, at, scope) {
  const link = chain[at];
  if (!compoundMatches(n, link.compound)) return false;
  if (at === 0) return true;
  let up = n.parent;
  while (up !== null && up !== scope.parent) {
    if (chainMatches(up, chain, at - 1, scope)) return true;
    if (link.combinator === ">") return false;
    up = up.parent;
  }
  return false;
}

/**
 * Whether `n` matches any of the chains, its ancestors looked for no higher than `scope`.
 *
 * @param {SelectorNode} n
 * @param {Chain[]} chains
 * @param {SelectorNode} scope
 * @returns {boolean}
 */
export const matchesAny = (n, chains, scope) => chains.some((c) => chainMatches(n, c, c.length - 1, scope));
