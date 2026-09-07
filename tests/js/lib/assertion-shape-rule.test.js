// Behavioral suite for eslint-rules/assertion-shape.js, the frontend peer of
// the shape checks in scripts/gates/check_test_assertions.py (docs/testing.md
// rules 2, 10 and the Markers clause).
//
// The rule is driven through ESLint's Linter on invented source text, never
// RuleTester: RuleTester's assertions are internal, and the one-assertion gate
// would count a case using it as making none. A lint message carries a report's
// `messageId` but not its `data`, so the rule is registered behind a thin
// wrapper that records every descriptor it hands `context.report` before
// forwarding it unchanged; the assertions read `messageId` and `data.count`,
// both wire identifiers, never the rule's wording. Every sentence in the inputs
// below is invented here.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/assertion-shape-rule.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Linter } from "eslint";

import rule from "../../../eslint-rules/assertion-shape.js";

/**
 * @typedef {{ messageId: string | undefined, count: unknown }} Seen
 */

/**
 * The rule under test, wrapped so each descriptor it reports lands in `sink`
 * before ESLint sees it. Only `report` is interposed; every other property of
 * the context reaches the rule untouched.
 * @param {Seen[]} sink
 * @returns {import("eslint").Rule.RuleModule}
 */
function recording(sink) {
  return {
    meta: /** @type {import("eslint").Rule.RuleMetaData} */ (rule.meta),
    create(context) {
      // ESLint freezes the context, so a Proxy get trap may not substitute
      // `report`; an object inheriting from the context with its own `report`
      // leaves every other property to the real context.
      const seen = /** @type {import("eslint").Rule.RuleContext} */ (
        Object.create(context, {
          report: {
            value: (/** @type {import("eslint").Rule.ReportDescriptor} */ descriptor) => {
              const { messageId, data } = /** @type {{ messageId?: string, data?: { count?: unknown } }} */ (
                descriptor
              );
              sink.push({ messageId, count: data?.count });
              context.report(descriptor);
            },
          },
        })
      );
      return rule.create(seen);
    },
  };
}

/**
 * A fresh suite root under the OS temp dir with `tests/js/` inside it, so the
 * rule sees a nearest `tests` ancestor and ESLint sees the file under its cwd.
 * @returns {string}
 */
function suiteRoot() {
  const root = mkdtempSync(join(tmpdir(), "assertion-shape-"));
  mkdirSync(join(root, "tests", "js"), { recursive: true });
  return root;
}

/**
 * Lint `lines` as the module `<root>/tests/js/x.test.js` under the wrapped
 * rule and return the lint messages beside the descriptors the rule reported.
 * @param {string[]} lines
 * @returns {{ messages: import("eslint").Linter.LintMessage[], reported: Seen[] }}
 */
function lint(lines) {
  const root = suiteRoot();
  /** @type {Seen[]} */
  const reported = [];
  /** @type {import("eslint").Linter.Config[]} */
  const config = [
    {
      files: ["**/*.js"],
      plugins: { hqptuner: { rules: { "assertion-shape": recording(reported) } } },
      languageOptions: { ecmaVersion: 2022, sourceType: "module" },
      rules: { "hqptuner/assertion-shape": "error" },
    },
  ];
  const linter = new Linter({ configType: "flat", cwd: root });
  const filename = join(root, "tests", "js", "x.test.js");
  const messages = linter.verify(lines.join("\n") + "\n", config, { filename });
  return { messages, reported };
}

const PREAMBLE = ['import assert from "node:assert/strict";', 'import test from "node:test";'];

test("a root conjunction reports its operand count and a nested || is not walked", () => {
  const { reported } = lint([
    ...PREAMBLE,
    'test("one", () => {',
    "  assert.ok(a && b);",
    "});",
    'test("two", () => {',
    "  assert.ok(a && b && c);",
    "});",
    'test("three", () => {',
    "  assert.equal((x || {}).k, 1);",
    "});",
  ]);
  assert.deepEqual(
    reported.map((r) => [r.messageId, r.count]),
    [
      ["count", 2],
      ["count", 3],
    ],
  );
});

test("an inequality against null, test.skip and test.todo are reported but an equality is not", () => {
  const { messages } = lint([
    ...PREAMBLE,
    'test("one", () => {',
    "  assert.ok(x !== null);",
    "});",
    'test.skip("two", () => {',
    "  assert.ok(1);",
    "});",
    'test.todo("three");',
    'test("four", () => {',
    "  assert.equal(x, 3);",
    "});",
  ]);
  assert.deepEqual(
    messages.map((m) => m.messageId),
    ["existence", "skip", "skip"],
  );
});
