// Behavioral suite for eslint-rules/no-hand-rolled-card.js, the gate that keeps
// the card frame written once.
//
// The rule is driven through ESLint's Linter on invented source text, never
// RuleTester: RuleTester's assertions are internal, and the one-assertion gate
// would count a case using it as making none. Each case asserts the messageId
// and line of every report, so a site this file wrote is pinned by where it
// sits and a site it did not write shows up as an extra entry; the rule's own
// wording is never read. Every input below is invented here.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/no-hand-rolled-card-rule.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { Linter } from "eslint";

import rule from "../../../eslint-rules/no-hand-rolled-card.js";

/**
 * Lint `lines` as one module under the rule with `options`, and return each
 * report as its messageId beside its line.
 * @param {string[]} lines
 * @param {unknown[]} options
 * @returns {[string | null | undefined, number][]}
 */
function lint(lines, options) {
  /** @type {import("eslint").Linter.Config[]} */
  const config = [
    {
      files: ["**/*.js"],
      plugins: { hqptuner: { rules: { "no-hand-rolled-card": rule } } },
      languageOptions: { ecmaVersion: 2022, sourceType: "module" },
      rules: {
        "hqptuner/no-hand-rolled-card": /** @type {import("eslint").Linter.RuleEntry} */ (["error", ...options]),
      },
    },
  ];
  const linter = new Linter({ configType: "flat", cwd: "/suite" });
  const messages = linter.verify(lines.join("\n") + "\n", config, { filename: "/suite/x.js" });
  return messages.map((m) => [m.messageId, m.line]);
}

const V2 = [{ v2: true }];

test("without an option a template's card frame classes are reported and its layout classes are not", () => {
  const reported = lint(
    [
      'const a = `<div class="card">`;',
      'const b = `<div class="card-grid">`;',
      'const c = `<header class="card-head">`;',
      'const d = `<div class="pack">`;',
      'const e = `<section class="card-body">`;',
    ],
    [],
  );
  assert.deepEqual(reported, [
    ["handRolled", 1],
    ["handRolled", 3],
    ["handRolled", 5],
  ]);
});

test("under v2 a template class attribute reports a frame token in any position and not a layout token", () => {
  const reported = lint(
    [
      'const a = `<div class="card">`;',
      'const b = `<div class="card-grid">`;',
      'const c = `<header class="row card-head">`;',
      'const d = `<div class="packed">`;',
      'const e = `<section class="card-body wide">`;',
      'const f = `<div class="${tone} pack ${size}">`;',
      "const g = `<p>an SD card in a pack</p>`;",
    ],
    V2,
  );
  assert.deepEqual(reported, [
    ["v2Card", 1],
    ["v2Card", 3],
    ["v2Card", 5],
    ["v2Card", 6],
  ]);
});

test("under v2 an object property keyed class or className reports a frame token in a string, template or call argument", () => {
  const reported = lint(
    [
      'const a = { class: "card" };',
      'const b = { class: "card-grid" };',
      "const c = { className: `row ${tone} card-head` };",
      'const d = { className: "packed" };',
      'const e = { class: classNames("a", cond && "card-body") };',
      'const f = { tip: "SD card" };',
      'const g = { "className": "wide pack" };',
    ],
    V2,
  );
  assert.deepEqual(reported, [
    ["v2Card", 1],
    ["v2Card", 3],
    ["v2Card", 5],
    ["v2Card", 7],
  ]);
});

test("under v2 an assignment to className reports a frame token and an assignment to another property does not", () => {
  const reported = lint(
    ['el.className = "card";', 'el.title = "card";', "el.className = `pack ${tone}`;", 'el.className = "card-grid";'],
    V2,
  );
  assert.deepEqual(reported, [
    ["v2Card", 1],
    ["v2Card", 3],
  ]);
});

test("under v2 a classList add, toggle, remove or contains reports a frame token and another receiver does not", () => {
  const reported = lint(
    [
      'el.classList.add("card");',
      'set.add("card");',
      'el.classList.toggle("card-head", open);',
      'el.classList.add("packed");',
      'el.classList.remove("card-body");',
      'el.classList.contains("pack");',
    ],
    V2,
  );
  assert.deepEqual(reported, [
    ["v2Card", 1],
    ["v2Card", 3],
    ["v2Card", 5],
    ["v2Card", 6],
  ]);
});
