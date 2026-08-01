// Gate: every test contains exactly one assertion (docs/testing.md rule 2).
// The JS peer of scripts/gates/check_test_assertions.py, with the same semantics:
//
//   zero        — a smoke test hiding as a test
//   more than 1 — muddies failure attribution; a red test must name ONE broken
//                 behavior
//   in a loop   — an unparametrized case sweep; generate one test() per case
//                 instead (the pytest.mark.parametrize equivalent is a loop
//                 around test(), not an assert inside one)
//
// Functions nested inside a test body are not scanned, mirroring the Python
// gate. Note the consequence: a helper that performs its own assertion is
// invisible here. That is deliberate — the fix is to keep the assert at the
// call site, not to teach the gate about helpers, since a gate defeated by
// wrapping the assert in a function is not a gate.
const FN = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const LOOP = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);
const RUNNERS = new Set(["test", "it"]);

// `assert(...)` or `assert.<anything>(...)` — node:assert/strict in either form.
function isAssertion(node) {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee;
  if (callee.type === "Identifier") return callee.name === "assert";
  return callee.type === "MemberExpression" && callee.object.type === "Identifier" && callee.object.name === "assert";
}

function walk(node, inLoop, acc) {
  if (!node || typeof node.type !== "string" || FN.has(node.type)) return;
  if (isAssertion(node)) {
    acc.count += 1;
    if (inLoop) acc.looped = true;
    return;
  }
  const loop = inLoop || LOOP.has(node.type);
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach((child) => walk(child, loop, acc));
    else walk(value, loop, acc);
  }
}

export default {
  meta: {
    type: "problem",
    docs: { description: "require exactly one assertion per test (docs/testing.md)" },
    schema: [],
    messages: {
      count: "{{count}} assertions (want 1) — a failure must name exactly one broken behavior",
      looped: "assertion inside a loop — generate one test() per case instead",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || !RUNNERS.has(node.callee.name)) return;
        const body = node.arguments.find((arg) => FN.has(arg.type));
        if (!body) return;
        const acc = { count: 0, looped: false };
        walk(body.body, false, acc);
        if (acc.count !== 1) context.report({ node, messageId: "count", data: { count: acc.count } });
        else if (acc.looped) context.report({ node, messageId: "looped" });
      },
    };
  },
};
