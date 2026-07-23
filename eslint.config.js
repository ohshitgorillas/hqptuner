// Flat config. Mirrors the Python lint gate (pyproject [tool.ruff.lint]) as
// closely as the language allows: recommended correctness rules + an explicit
// complexity ceiling matching xenon's --max-absolute B (radon B = CC 6-10).
//
// The frontend is browser ES modules with no build step; the vendored preact /
// htm / signals bundles are upstream and excluded everywhere.
import js from "@eslint/js";
import globals from "globals";
import oneAssertionPerTest from "./eslint-rules/one-assertion-per-test.js";

const RULES = {
  // xenon --max-absolute B => cyclomatic complexity <= 10 (ruff C901 uses the
  // same ceiling via [tool.ruff.lint.mccabe] max-complexity = 10).
  complexity: ["error", 10],
  "max-depth": ["error", 4],
  "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  eqeqeq: ["error", "always", { null: "ignore" }],
  "no-var": "error",
  "prefer-const": "error",
  "no-console": ["error", { allow: ["warn", "error"] }],
};

export default [
  { ignores: ["hqptuner/static/vendor/**", "node_modules/**", ".venv/**"] },
  js.configs.recommended,
  {
    files: ["hqptuner/static/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals.browser },
    rules: RULES,
  },
  {
    // Test suite runs under node's built-in runner, not in the browser. The
    // one-assertion gate is the JS peer of scripts/check_test_assertions.py.
    files: ["tests/js/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals.node },
    plugins: { hqptuner: { rules: { "one-assertion-per-test": oneAssertionPerTest } } },
    rules: { ...RULES, "hqptuner/one-assertion-per-test": "error" },
  },
  {
    // The config and its local rules run in node.
    files: ["eslint.config.js", "eslint-rules/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals.node },
  },
];
