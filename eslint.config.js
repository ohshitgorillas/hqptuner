// Flat config. Mirrors the Python lint gate (pyproject [tool.ruff.lint]) as
// closely as the language allows: recommended correctness rules + an explicit
// complexity ceiling matching xenon's --max-absolute B (radon B = CC 6-10).
//
// The frontend is browser ES modules with no build step; the vendored preact /
// htm / signals bundles are upstream and excluded everywhere.
import js from "@eslint/js";
import globals from "globals";
import jsdoc from "eslint-plugin-jsdoc";
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

// Docstring presence, the frontend peer of the ruff `D` gate in pyproject.toml
// ([tool.ruff.lint] select includes "D"). Every exported function and class
// carries a block saying what it does, and the block has to say something --
// an empty /** */ fails require-description just as an empty Python docstring
// fails ruff.
//
// Type-carrying rules stay off on purpose. tsc --checkJs already reads the
// @param/@returns types it finds and checks the call sites against them, so a
// second gate demanding prose copies of the same types would only give the two
// a way to disagree.
//
// tests/js is exempt, matching the Python side's `tests/**` ignore: the
// one-assertion rule and docs/testing.md already require a test's name to state
// its behavior in plain words, and a block above it restates the name.
//
// require-jsdoc takes `publicOnly`, which scopes it to the exported surface.
// require-description has no such option and defaults to every function that
// carries a block, exported or not, which would put the two rules on different
// surfaces: an internal helper with a bare `@param` block would fail the second
// gate while the first never asked it for a block at all. The `contexts` list
// spells out the export shapes so both rules police exactly the same symbols.
const JSDOC_RULES = {
  "jsdoc/require-jsdoc": [
    "error",
    {
      publicOnly: true,
      require: {
        FunctionDeclaration: true,
        ClassDeclaration: true,
        MethodDefinition: true,
        ArrowFunctionExpression: true,
        FunctionExpression: true,
      },
    },
  ],
  "jsdoc/require-description": [
    "error",
    {
      contexts: [
        "ExportNamedDeclaration > FunctionDeclaration",
        "ExportDefaultDeclaration > FunctionDeclaration",
        "ExportNamedDeclaration > ClassDeclaration",
        "ExportDefaultDeclaration > ClassDeclaration",
        "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression",
        "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > FunctionExpression",
        "ExportDefaultDeclaration > ArrowFunctionExpression",
        "ExportDefaultDeclaration > FunctionExpression",
        "ExportNamedDeclaration > ClassDeclaration MethodDefinition",
        "ExportDefaultDeclaration > ClassDeclaration MethodDefinition",
      ],
    },
  ],
};

// Import layering, the frontend peer of the Python contract in pyproject.toml
// under [tool.importlinter]. Highest first:
//
//   app.js + components/App.js   the shell
//   components/tabs
//   components
//   components/controls
//   store
//   lib
//
// A layer imports below it and never above. App.js is the shell rather than a
// component: static/app.js renders it, it assembles the header, the tab bar and
// the pending bar, and it is the only module under components/ that may reach
// into tabs/.
//
// The node CLIs form their own chain on the same base — eqstage > eqlab >
// static/lib — and reach into neither store/ nor components/.
//
// Patterns match the import SPECIFIER, not a resolved path, so each rule lists
// the shapes a relative specifier can take from the depths that layer occupies.
// `**` matches a leading `..` the same as any other segment.
const ABOVE = {
  app: "**/app.js",
  components: ["**/components/*.js", "**/components/**/*.js"],
  tabs: ["**/tabs/*.js", "**/tabs/**/*.js"],
  store: ["**/store/*.js", "**/store/**/*.js"],
  eqstage: "**/eqstage/**/*.js",
};

/**
 * @param {string[]} group
 * @param {string} message
 */
const noUp = (group, message) => ({
  "no-restricted-imports": ["error", { patterns: [{ group, message }] }],
});

const LAYER_MSG = "import layering: a layer imports below it, never above (see the contract in eslint.config.js)";

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
    files: ["hqptuner/static/components/common.js"],
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
    // Production JS: the served frontend, the two node CLIs and the local
    // eslint rules. tests/js is deliberately absent.
    files: ["hqptuner/static/**/*.js", "scripts/eqlab/**/*.js", "scripts/eqstage/**/*.js", "eslint-rules/**/*.js"],
    plugins: { jsdoc },
    rules: JSDOC_RULES,
  },
  // --- the layering contract ---------------------------------------------
  {
    files: ["hqptuner/static/lib/**/*.js"],
    rules: noUp([ABOVE.app, ...ABOVE.components, ...ABOVE.store], LAYER_MSG),
  },
  {
    files: ["hqptuner/static/store/**/*.js"],
    rules: noUp([ABOVE.app, ...ABOVE.components], LAYER_MSG),
  },
  {
    // Controls sit under the components that compose them. `../*.js` is a flat
    // sibling of components/, one level up from here, and `../*/*.js` is one
    // inside a concern directory (matrix/, xfeed/, live/, …) — both are
    // components. `../../lib/…` is deeper and unaffected, and `*` does not
    // match a `/`, so neither pattern reaches it.
    files: ["hqptuner/static/components/controls/**/*.js"],
    rules: noUp([ABOVE.app, ...ABOVE.tabs, "../*.js", "../*/*.js"], LAYER_MSG),
  },
  {
    files: ["hqptuner/static/components/**/*.js"],
    ignores: [
      "hqptuner/static/components/App.js",
      "hqptuner/static/components/tabs/**",
      "hqptuner/static/components/controls/**",
    ],
    rules: noUp([ABOVE.app, ...ABOVE.tabs], LAYER_MSG),
  },
  {
    files: ["hqptuner/static/components/tabs/**/*.js"],
    rules: noUp([ABOVE.app], LAYER_MSG),
  },
  {
    // The node CLIs share static/lib and nothing above it. eqstage imports
    // eqlab; eqlab must not import back.
    files: ["scripts/eqlab/**/*.js"],
    rules: noUp([ABOVE.app, ...ABOVE.components, ...ABOVE.store, ABOVE.eqstage], LAYER_MSG),
  },
  {
    files: ["scripts/eqstage/**/*.js"],
    rules: noUp([ABOVE.app, ...ABOVE.components, ...ABOVE.store], LAYER_MSG),
  },
  {
    // The config and its local rules run in node.
    files: ["eslint.config.js", "eslint-rules/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals.node },
  },
];
