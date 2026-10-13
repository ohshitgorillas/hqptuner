// Behavioral suite for eslint-rules/no-copy-assertions.js, the frontend peer of
// scripts/gates/testing/check_no_copy_assertions.py.
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

/** @type {import("eslint").Linter.Config[]} */
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

const inTestsImport = 'import { SLOPE } from "./support/harness.js";';
const composed = '  assert.equal(a, "A gentle slope. Rarely useful.");';
const extraWord = '  assert.equal(b, "A gentle slope. Rarely useful indeed.");';
const outsideSeed = '  assert.equal(c, "Beyond the fence.");';

/**
 * A suite root holding a seed module under tests and one outside it, and the lint input twice: `seeded` imports the
 * seed under tests, `unseeded` drops that import.
 * @returns {{ root: string, seeded: string[], unseeded: string[] }}
 */
function seedFixture() {
  const root = suiteRoot();
  mkdirSync(join(root, "outside"), { recursive: true });
  writeFileSync(
    join(root, "tests", "js", "support", "harness.js"),
    'export const SLOPE = "A gentle slope.";\nexport const RARE = "Rarely useful.";\n',
  );
  writeFileSync(join(root, "outside", "seed.js"), 'export const FAR = "Beyond the fence.";\n');
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
  return { root, seeded, unseeded };
}

test("a literal adding a word to the imported seeds is reported once", () => {
  const { root, seeded } = seedFixture();
  assert.equal(reportedLines(seeded, root).filter((line) => line === lineOf(seeded, extraWord)).length, 1);
});

test("a seed imported from outside tests does not cover its literal, which is reported once", () => {
  const { root, seeded } = seedFixture();
  assert.equal(reportedLines(seeded, root).filter((line) => line === lineOf(seeded, outsideSeed)).length, 1);
});

test("without the seed import a literal composed of the seeds is reported once", () => {
  const { root, unseeded } = seedFixture();
  assert.equal(reportedLines(unseeded, root).filter((line) => line === lineOf(unseeded, composed)).length, 1);
});

test("without the seed import a literal adding a word to the seeds is reported once", () => {
  const { root, unseeded } = seedFixture();
  assert.equal(reportedLines(unseeded, root).filter((line) => line === lineOf(unseeded, extraWord)).length, 1);
});

test("without the seed import a literal matching the outside seed is reported once", () => {
  const { root, unseeded } = seedFixture();
  assert.equal(reportedLines(unseeded, root).filter((line) => line === lineOf(unseeded, outsideSeed)).length, 1);
});
