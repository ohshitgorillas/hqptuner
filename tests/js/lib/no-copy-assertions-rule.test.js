// Behavioral suite for eslint-rules/no-copy-assertions.js, the frontend peer of
// scripts/gates/check_no_copy_assertions.py (docs/testing.md rule 9).
//
// The rule is driven through ESLint's Linter on invented source text, never
// RuleTester: RuleTester's assertions are internal, and the one-assertion gate
// would count a case using it as making none. Each case asserts the line
// numbers of the sites this file wrote, never the rule's own wording. Every
// sentence in the inputs below is invented here.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/no-copy-assertions-rule.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Linter } from "eslint";

import rule from "../../../eslint-rules/no-copy-assertions.js";

const CONFIG = [
  {
    files: ["**/*.js"],
    plugins: { hqptuner: { rules: { "no-copy-assertions": rule } } },
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
    rules: { "hqptuner/no-copy-assertions": "error" },
  },
];

/**
 * A fresh suite root under the OS temp dir with `tests/js/` inside it, so the
 * rule sees a nearest `tests` ancestor and ESLint sees the file under its cwd.
 * @returns {string}
 */
function suiteRoot() {
  const root = mkdtempSync(join(tmpdir(), "no-copy-assertions-"));
  mkdirSync(join(root, "tests", "js", "support"), { recursive: true });
  return root;
}

/**
 * Lint `lines` as the module `<root>/tests/js/x.test.js` and return the
 * 1-based line of every report. Flat-config Linter matches files only under
 * its cwd, so the Linter is rooted at the suite root.
 * @param {string[]} lines
 * @param {string} root
 * @returns {number[]}
 */
function reportedLines(lines, root) {
  const linter = new Linter({ configType: "flat", cwd: root });
  const filename = join(root, "tests", "js", "x.test.js");
  const messages = linter.verify(lines.join("\n") + "\n", CONFIG, { filename });
  return messages.map((m) => m.line);
}

const PREAMBLE = ['import assert from "node:assert/strict";', 'import test from "node:test";'];

/**
 * @param {string[]} body
 * @param {string} at
 * @returns {number}
 */
function lineOf(body, at) {
  return body.indexOf(at) + 1;
}

test("the failure-message argument is never a finding, but a literal in an operand slot still is", () => {
  const body = [
    ...PREAMBLE,
    'test("t", () => {',
    '  assert.ok(x, "two words");',
    '  assert.equal(a, b, "two words");',
    '  assert.equal(a, "two words");',
    "});",
  ];
  assert.deepEqual(reportedLines(body, suiteRoot()), [lineOf(body, '  assert.equal(a, "two words");')]);
});

test("a literal handed to a plain-identifier call is input, one handed to a member call on a value is reported", () => {
  const body = [
    ...PREAMBLE,
    'test("t", () => {',
    '  assert.equal(describe({ tooltip: "Idle prose." }), x);',
    '  assert.ok(String(out.error).includes("two words"));',
    "});",
  ];
  assert.deepEqual(reportedLines(body, suiteRoot()), [
    lineOf(body, '  assert.ok(String(out.error).includes("two words"));'),
  ]);
});

test("seeds imported from under tests cover a literal composed of them, and nothing else covers it", () => {
  const root = suiteRoot();
  mkdirSync(join(root, "outside"), { recursive: true });
  writeFileSync(
    join(root, "tests", "js", "support", "harness.js"),
    'export const SLOPE = "A gentle slope.";\nexport const RARE = "Rarely useful.";\n',
  );
  writeFileSync(join(root, "outside", "seed.js"), 'export const FAR = "Beyond the fence.";\n');
  const inTestsImport = 'import { SLOPE } from "./support/harness.js";';
  const composed = '  assert.equal(a, "A gentle slope. Rarely useful.");';
  const extraWord = '  assert.equal(b, "A gentle slope. Rarely useful indeed.");';
  const outsideSeed = '  assert.equal(c, "Beyond the fence.");';
  const seeded = [
    ...PREAMBLE,
    inTestsImport,
    'import { FAR } from "../../outside/seed.js";',
    'test("t", () => {',
    composed,
    extraWord,
    outsideSeed,
    "});",
  ];
  const unseeded = seeded.filter((line) => line !== inTestsImport);
  assert.deepEqual(
    [reportedLines(seeded, root), reportedLines(unseeded, root)],
    [
      [lineOf(seeded, extraWord), lineOf(seeded, outsideSeed)],
      [lineOf(unseeded, composed), lineOf(unseeded, extraWord), lineOf(unseeded, outsideSeed)],
    ],
  );
});
