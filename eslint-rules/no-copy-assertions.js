// Gate: a test never asserts a string it did not put on the wire itself
// (docs/testing.md rule 9). The JS peer of scripts/gates/check_no_copy_assertions.py,
// with the same semantics:
//
//   a literal of two or more words inside an assert.*(...) call is copy unless
//   the same literal appears somewhere in the file OUTSIDE an assertion — a
//   fixture, a faked fetch reply, a signal the test assigned. Copy is
//   owner-owned data, reworded at will; a test pinning it goes red on a
//   rewording and green on a broken behavior.
//
// XML frames, key=value pairs and JSON bodies contain spaces too and are wire
// shapes, not prose; they are skipped by the same character test the Python
// gate uses. Template literals are not inspected.
const PROSE = /[A-Za-z]{2,} [A-Za-z]{2,}/;
const WIRE = /[<=>{}]/;

function isProse(value) {
  return typeof value === "string" && PROSE.test(value) && !WIRE.test(value);
}

// `assert(...)` or `assert.<anything>(...)` — node:assert/strict in either form.
function isAssertion(node) {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee;
  if (callee.type === "Identifier") return callee.name === "assert";
  return callee.type === "MemberExpression" && callee.object.type === "Identifier" && callee.object.name === "assert";
}

function insideAssertion(node) {
  for (let cur = node.parent; cur; cur = cur.parent) if (isAssertion(cur)) return true;
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: { description: "never assert a string the test did not seed itself (docs/testing.md rule 9)" },
    schema: [],
    messages: {
      copy: "asserts copy {{text}} — assert a wire identifier, a data-* state or a number, never a sentence",
    },
  },
  create(context) {
    const seeded = new Set();
    const asserted = [];
    return {
      Literal(node) {
        if (!isProse(node.value)) return;
        if (insideAssertion(node)) asserted.push(node);
        else seeded.add(node.value);
      },
      "Program:exit"() {
        for (const node of asserted) {
          if (seeded.has(node.value)) continue;
          context.report({ node, messageId: "copy", data: { text: JSON.stringify(node.value) } });
        }
      },
    };
  },
};
