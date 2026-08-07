// Flat config. Mirrors the Python lint gate (pyproject [tool.ruff.lint]) as
// closely as the language allows: recommended correctness rules + an explicit
// complexity ceiling matching xenon's --max-absolute B (radon B = CC 6-10).
//
// The frontend is browser ES modules with no build step; the vendored preact /
// htm / signals bundles are upstream and excluded everywhere.
import js from "@eslint/js";
import globals from "globals";
import sonarjs from "eslint-plugin-sonarjs";
import oneAssertionPerTest from "./eslint-rules/one-assertion-per-test.js";
import noHandRolledCard from "./eslint-rules/no-hand-rolled-card.js";

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
  "max-params": ["error", 4],
  "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
  "no-else-return": "error",
  "consistent-return": "error",
  "no-shadow": "error",
  "no-unused-private-class-members": "error",
  // Cognitive complexity catches the deeply-nested-but-linear functions that
  // cyclomatic complexity scores as cheap.
  "sonarjs/cognitive-complexity": "error",
  "sonarjs/no-identical-functions": "error",
  // `!(a === b)` and friends: the negation reads as a claim about the whole
  // expression when it is really one about the operator.
  "sonarjs/no-inverted-boolean-check": "error",
  // `^a|b$` binds looser than it reads — the alternation splits the whole
  // pattern, so only one branch is anchored. Always a bug or a misreading.
  "sonarjs/anchor-precedence": "error",
  // A character class listing the same character twice. Usually harmless, but
  // it is the shape a case-insensitive [A-Za-z] takes, where the /i flag has
  // already merged the two halves and the second one is telling you nothing.
  "sonarjs/duplicates-in-character-class": "error",
  // Backtracking that goes super-linear on input length. Enforced everywhere,
  // tests included: a regex whose cost explodes is worth fixing wherever it
  // lives, and exempting the trees where it is merely cheap to ignore is how
  // the rule stops being a rule.
  "sonarjs/super-linear-regex": "error",
};

const PLUGINS = { sonarjs };

export default [
  // mutants/ is `make mutate`'s copy of the whole tree, static/ included. eslint
  // is invoked as `eslint .`, so without this it lints the copy — 83 no-undef
  // errors from a second, unconfigured root. knip and tsc are scoped by explicit
  // globs and are unaffected.
  // `**/*.mjs` is gitignored scratch — throwaway node scripts from tuning
  // sessions, never shipped and never a gate's business.
  {
    ignores: [
      "hqptuner/static/vendor/**",
      "node_modules/**",
      ".venv/**",
      "build/**",
      "dist/**",
      "mutants/**",
      // Agent worktrees are whole duplicate checkouts parked inside the
      // gitignored dev-tooling directory. Linting a second copy of the app can
      // only report the same files twice or, as it did, fail on a copy pinned to
      // an older commit — never a finding about this tree's source.
      ".claude/worktrees/**",
      "**/*.mjs",
    ],
  },
  js.configs.recommended,
  {
    files: ["hqptuner/static/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals.browser },
    plugins: { ...PLUGINS, hqptuner: { rules: { "no-hand-rolled-card": noHandRolledCard } } },
    rules: { ...RULES, "hqptuner/no-hand-rolled-card": "error" },
  },
  {
    // The module that OWNS the card frame is the one place allowed to write it.
    files: ["hqptuner/static/components/tabs/common.js"],
    rules: { "hqptuner/no-hand-rolled-card": "off" },
  },
  {
    // Test suite runs under node's built-in runner, not in the browser. The
    // one-assertion gate is the JS peer of scripts/gates/check_test_assertions.py.
    files: ["tests/js/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals.node },
    plugins: { ...PLUGINS, hqptuner: { rules: { "one-assertion-per-test": oneAssertionPerTest } } },
    rules: { ...RULES, "hqptuner/one-assertion-per-test": "error" },
  },
  {
    // scripts/eqlab is a node CLI, not browser code: it imports the same
    // static/lib modules the frontend does, but runs under node with stdin,
    // stdout and fetch.
    files: ["scripts/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals.node },
    plugins: PLUGINS,
    rules: RULES,
  },
  {
    // The config and its local rules run in node.
    files: ["eslint.config.js", "eslint-rules/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals.node },
  },
];
