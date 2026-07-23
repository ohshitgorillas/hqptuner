// Node loader hook: teach `node --test` the browser importmap.
//
// WHY THIS EXISTS
// ---------------
// The frontend is no-build-step browser ES modules. Bare specifiers (`preact`,
// `preact/hooks`, `@preact/signals`, `@preact/signals-core`, `htm`) are resolved
// at runtime by the importmap in hqptuner/static/index.html, which points each
// one at a vendored bundle under hqptuner/static/vendor/. Node has no importmap
// support, so `import { signal } from "@preact/signals"` inside e.g.
// store/state.js is an unresolvable specifier under `node --test` and the module
// cannot be loaded at all. That blocks unit-testing the whole store layer.
//
// This hook installs a synchronous `resolve` customization (node:module's
// registerHooks(), Node >= 22.15) that performs exactly the substitution the
// browser's importmap would: bare specifier -> vendored file URL. Nothing else
// is intercepted; every other specifier falls through to Node's own resolver.
//
// The mapping is READ FROM index.html at startup, not copied here. A second
// hardcoded copy would silently rot the moment the importmap changes (a bumped
// vendor filename, a new specifier) and the tests would keep passing against a
// bundle the browser no longer loads. The point of these tests is to exercise
// the ACTUAL SHIPPED BUNDLES, so the shipped mapping is the only source of truth.
//
// Scope/limits, deliberately: only "imports" is honoured (index.html has no
// "scopes"), and trailing-slash prefix mappings are not implemented because the
// importmap has none — such an entry raises rather than resolving wrongly.
//
// USAGE
//   node --import ./tests/js/vendor-resolve.js --test tests/js/*.test.js
// or equivalently `make test-js`. NODE_OPTIONS is not required: `node --test`
// forwards the parent's execArgv to the per-file child processes, so --import
// takes effect inside each test file too.
//
// The file list is explicit because `node --test tests/js/` fails on this Node
// (v22.22) with ERR_UNSUPPORTED_DIR_IMPORT — a directory argument is resolved as
// a module specifier. That is pre-existing and independent of this hook (`node
// --test docs` fails identically); the older per-suite header comments still
// document the directory form.
//
// This file is not itself a test and is excluded by the *.test.js glob.

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

// Repo layout: <repo>/tests/js/vendor-resolve.js -> <repo>/hqptuner/static/
const STATIC_ROOT = new URL("../../hqptuner/static/", import.meta.url);
const INDEX_HTML = new URL("index.html", STATIC_ROOT);

const IMPORTMAP_RE = /<script[^>]*\btype=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i;

// Pull the importmap JSON out of index.html and turn each entry into an
// absolute file URL. Importmap values are site-root-relative ("/vendor/x.js"),
// and the site root is the static dir; anything else is resolved relative to
// index.html, matching how a browser would treat it.
function readImportmap() {
  const html = readFileSync(INDEX_HTML, "utf8");
  const match = IMPORTMAP_RE.exec(html);
  if (!match) {
    throw new Error(`no <script type="importmap"> found in ${INDEX_HTML.pathname}`);
  }
  const { imports } = JSON.parse(match[1]);
  return new Map(
    Object.entries(imports ?? {}).map(([specifier, target]) => {
      if (specifier.endsWith("/")) {
        throw new Error(`importmap prefix mapping "${specifier}" is not supported by ${import.meta.url}`);
      }
      const path = target.startsWith("/") ? target.slice(1) : target;
      return [specifier, new URL(path, STATIC_ROOT).href];
    }),
  );
}

const MAPPING = readImportmap();

registerHooks({
  resolve(specifier, context, nextResolve) {
    const mapped = MAPPING.get(specifier);
    return mapped ? { url: mapped, format: "module", shortCircuit: true } : nextResolve(specifier, context);
  },
});

// Exported so a caller can assert what was picked up (and to keep the parsed
// mapping inspectable without re-reading the HTML).
export const importmap = MAPPING;
