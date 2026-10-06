// Gate: the faceplate has neither a card frame nor a `.pack` two-track grid, so
// the rule refuses the class tokens `card`, `card-head`, `card-body` and `pack`
// wherever they can reach an element's class list: a template `class="…"`
// attribute in any position among its classes, the value of an object property
// keyed `class` or `className` (a string, a template, or the string arguments of
// a call such as `classNames(…)`), an assignment to `.className`, and
// `classList.add|toggle|remove|contains`. The same words in any other string are
// prose and pass.
//
// `card-grid`, `card-title`, `packed` and friends are untouched: they are other
// classes, not the card frame or the pack grid.
const V2_TOKENS = new Set(["card", "card-head", "card-body", "pack"]);
const CLASS_ATTR = /\bclass="([^"]*)"/g;
const CLASS_KEYS = new Set(["class", "className"]);
const CLASS_LIST_METHODS = new Set(["add", "toggle", "remove", "contains"]);

// Stands in for a template's `${…}` holes when its quasis are joined. It is not
// whitespace, so a token glued to a hole (`card-${size}`, `${prefix}card`) never
// reads as a bare `card`.
const HOLE = "\u0000";

/**
 * The first refused v2 token among the whitespace-separated classes in `text`.
 * @param {string} text
 * @returns {string | undefined}
 */
function refusedToken(text) {
  return text.split(/\s+/).find((token) => V2_TOKENS.has(token));
}

/**
 * A quasi's text, cooked where the escape is valid and raw where it is not.
 * @param {import("estree").TemplateElement} quasi
 * @returns {string}
 */
function quasiText(quasi) {
  return quasi.value.cooked ?? quasi.value.raw;
}

/**
 * A template's text with every hole replaced by HOLE.
 * @param {import("estree").TemplateLiteral} node
 * @returns {string}
 */
function templateText(node) {
  return node.quasis.map(quasiText).join(HOLE);
}

/**
 * The quasi of `node` holding character `index` of its templateText.
 * @param {import("estree").TemplateLiteral} node
 * @param {number} index
 * @returns {import("estree").Node}
 */
function quasiAt(node, index) {
  let end = 0;
  for (const quasi of node.quasis) {
    end += quasiText(quasi).length + HOLE.length;
    if (index < end) return quasi;
  }
  return node;
}

/**
 * The string-bearing nodes an expression in a class position can contribute to
 * the class list: string literals and templates, reached through the arguments
 * of a call, both sides of `&&` / `||` / `??`, both arms of `?:` and the
 * elements of an array.
 * @param {import("estree").Node | null} node
 * @returns {(import("estree").Literal | import("estree").TemplateLiteral)[]}
 */
function classFragments(node) {
  switch (node?.type) {
    case "Literal":
      return typeof node.value === "string" ? [node] : [];
    case "TemplateLiteral":
      return [node];
    case "CallExpression":
      return node.arguments.flatMap(classFragments);
    case "LogicalExpression":
      return [...classFragments(node.left), ...classFragments(node.right)];
    case "ConditionalExpression":
      return [...classFragments(node.consequent), ...classFragments(node.alternate)];
    case "ArrayExpression":
      return node.elements.flatMap(classFragments);
    default:
      return [];
  }
}

/**
 * The name a non-computed member property or object key spells, if it spells one.
 * @param {import("estree").Node} node
 * @returns {string | undefined}
 */
function staticName(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return undefined;
}

/**
 * Whether `node` is `<receiver>.classList.<add|toggle|remove|contains>`.
 * @param {import("estree").Node} node
 * @returns {boolean}
 */
function isClassListCall(node) {
  if (node.type !== "MemberExpression" || node.computed) return false;
  const { object } = node;
  return (
    CLASS_LIST_METHODS.has(staticName(node.property) ?? "") &&
    object.type === "MemberExpression" &&
    !object.computed &&
    staticName(object.property) === "classList"
  );
}

/**
 * Visitors for a refused token in any class position. A template
 * that is itself a class value is claimed when its position is entered, which
 * precedes the template, so it is read as a class list and never scanned again
 * for `class="…"` attributes.
 * @param {import("eslint").Rule.RuleContext} context
 * @returns {import("eslint").Rule.RuleListener}
 */
function v2Visitors(context) {
  const claimed = new WeakSet();
  /** @param {import("estree").Node | null} value */
  const checkValue = (value) => {
    for (const fragment of classFragments(value)) {
      claimed.add(fragment);
      const text = fragment.type === "Literal" ? String(fragment.value) : templateText(fragment);
      const token = refusedToken(text);
      if (token) context.report({ node: fragment, messageId: "v2Card", data: { token } });
    }
  };
  return {
    Property(node) {
      if (!node.computed && CLASS_KEYS.has(staticName(node.key) ?? "")) checkValue(node.value);
    },
    AssignmentExpression(node) {
      const { left } = node;
      if (left.type === "MemberExpression" && !left.computed && staticName(left.property) === "className") {
        checkValue(node.right);
      }
    },
    CallExpression(node) {
      if (isClassListCall(node.callee)) node.arguments.forEach(checkValue);
    },
    TemplateLiteral(node) {
      if (claimed.has(node)) return;
      const text = templateText(node);
      for (const match of text.matchAll(CLASS_ATTR)) {
        const token = refusedToken(match[1]);
        if (token) context.report({ node: quasiAt(node, match.index), messageId: "v2Card", data: { token } });
      }
    },
  };
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: "no card frame or pack grid classes (docs/design-system.md)" },
    schema: [],
    messages: {
      v2Card: "v1 class `{{token}}` in v2 code — v2 ships neither v1's card frame nor its .pack grid.",
    },
  },
  create(context) {
    return v2Visitors(context);
  },
};
