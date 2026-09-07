// Gate: the one assertion a test makes has a shape a test may take
// (docs/testing.md rules 2 and 10, and the Markers section). The JS peer of the
// shape checks in scripts/gates/check_test_assertions.py, beside the count rule
// in one-assertion-per-test.js, which stays a separate rule so the two can run
// at different severities while a sweep is in flight.
//
//   count      a logical expression (`&&` / `||`) at the root of an assertion's
//              first argument is one assertion per operand
//   existence  `x !== null`, `x !== undefined`, `assert.notEqual(x, null)`:
//              presence pinned where a value was owed
//   skip       `test.skip(...)`, `test.todo(...)`, `it.skip(...)`
//
// Root-only: a leading `!` is looked through and nothing deeper, so
// `(x || {}).k === v` passes on its comparison root. Functions nested inside a
// test body are not scanned, mirroring the count rule.
import { isAssertion } from "./one-assertion-per-test.js";

/** @typedef {import("estree").Node} Node */
/** @typedef {import("estree").CallExpression} CallExpression */

const FN = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const RUNNERS = new Set(["test", "it"]);
const SKIPS = new Set(["skip", "todo"]);
const NOT_EQUAL = new Set(["!==", "!="]);
const NOT_EQUAL_CALLS = new Set(["notEqual", "notStrictEqual", "notDeepEqual", "notDeepStrictEqual"]);

/**
 * @param {unknown} value
 * @returns {value is Node}
 */
function isNode(value) {
  return (
    typeof value === "object" && value !== null && typeof (/** @type {{ type?: unknown }} */ (value).type) === "string"
  );
}

/**
 * Every assertion call under `node`, not descending into nested functions.
 * @param {unknown} node
 * @param {CallExpression[]} acc
 */
function collectAssertions(node, acc) {
  if (!isNode(node) || FN.has(node.type)) return;
  if (isAssertion(node)) {
    acc.push(node);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    if (Array.isArray(value)) value.forEach((child) => collectAssertions(child, acc));
    else collectAssertions(value, acc);
  }
}

/**
 * The expression under any leading `!`.
 * @param {Node | undefined} expr
 * @returns {Node | undefined}
 */
function stripNot(expr) {
  let root = expr;
  while (root && root.type === "UnaryExpression" && root.operator === "!") root = root.argument;
  return root;
}

/**
 * @param {Node | undefined} expr
 * @returns {number}
 */
function operandCount(expr) {
  if (!expr || expr.type !== "LogicalExpression") return 1;
  return operandCount(expr.left) + operandCount(expr.right);
}

/**
 * @param {Node | undefined} expr
 * @returns {boolean}
 */
function isNullish(expr) {
  if (!expr) return false;
  if (expr.type === "Literal") return expr.value === null;
  return expr.type === "Identifier" && expr.name === "undefined";
}

/**
 * @param {CallExpression} call
 * @returns {string}
 */
function methodName(call) {
  const callee = call.callee;
  return callee.type === "MemberExpression" && callee.property.type === "Identifier" ? callee.property.name : "";
}

/**
 * @param {CallExpression} call
 * @returns {boolean}
 */
function isExistence(call) {
  const [first, second] = call.arguments;
  if (NOT_EQUAL_CALLS.has(methodName(call))) return isNullish(second);
  const root = stripNot(first);
  if (!root || root.type !== "BinaryExpression" || !NOT_EQUAL.has(root.operator)) return false;
  return isNullish(root.left) || isNullish(root.right);
}

/**
 * @param {CallExpression} call
 * @returns {boolean}
 */
function isSkip(call) {
  const callee = call.callee;
  return (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    RUNNERS.has(callee.object.name) &&
    callee.property.type === "Identifier" &&
    SKIPS.has(callee.property.name)
  );
}

export default /** @type {import("eslint").Rule.RuleModule} */ ({
  meta: {
    type: "problem",
    docs: { description: "require the one assertion per test to have a shape a test may take (docs/testing.md)" },
    schema: [],
    messages: {
      count: "{{count}} assertions in one call, one per operand: assert the operand that names the behavior",
      existence:
        "existence pinned where a value was owed: assert what the fixture supplied, or exempt it under rule 10",
      skip: "a skipped test is an owner-approved exemption (docs/testing.md, Markers)",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (isSkip(node)) {
          context.report({ node, messageId: "skip" });
          return;
        }
        if (node.callee.type !== "Identifier" || !RUNNERS.has(node.callee.name)) return;
        const body = node.arguments.find((arg) => FN.has(arg.type));
        if (!body || !("body" in body)) return;
        /** @type {CallExpression[]} */
        const assertions = [];
        collectAssertions(body.body, assertions);
        for (const call of assertions) {
          const count = operandCount(stripNot(call.arguments[0]));
          if (count > 1) context.report({ node: call, messageId: "count", data: { count } });
          else if (isExistence(call)) context.report({ node: call, messageId: "existence" });
        }
      },
    };
  },
});
