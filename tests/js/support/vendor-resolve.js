// Node loader hook: teach `node --test` the browser importmap.
//
// WHY THIS EXISTS
// ---------------
// The frontend is no-build-step browser ES modules. Bare specifiers (`preact`,
// `preact/hooks`, `@preact/signals`, `@preact/signals-core`, `htm`) are resolved
// at runtime by the importmap in hqptuner/static/index.html, which points each
// one at a vendored bundle under hqptuner/static/vendor/. Node has no importmap
// support, so `import { signal } from "@preact/signals"` inside e.g.
// store/signals.js is an unresolvable specifier under `node --test` and the module
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
//
// SECOND HOOK: fresh module instances that don't alias coverage
// ---------------------------------------------------------------
// A few suites need a second, independently-loaded instance of a store module
// (to observe load-time behaviour: what a module does on its own import, not
// after another test has already mutated its live signals). Node caches a
// module per URL, so getting a second instance means importing under a URL
// that differs from the one the suite's main import used. The old approach
// was a cache-busting query string (`favorites.js?nofetch2`). That works for
// loading, but `--experimental-test-coverage` groups coverage by file path
// after stripping the query, and keeps only the LAST entry recorded for that
// path — so the load-only instance's near-zero coverage silently overwrote
// the real, thoroughly-exercised instance's numbers. Measured on
// store/narrow/favorites.js: the real instance recorded `toggleFavorite` count 39,
// the `?nofetch2` instance recorded 0, and the coverage report printed 0.00%
// functions for the whole file despite it being well tested.
//
// The fix: resolve `<name>.fresh-<tag>.js` to a URL that exists nowhere on
// disk, and load it with the source of `<name>.js`. The URL sits in the same
// directory as the real module, so relative imports inside the loaded source
// (e.g. `../lib/api.js`) still resolve correctly. Because the URL differs
// from the real module's path, node cannot alias its coverage onto it; and
// because no file backs that URL, node omits it from the coverage report
// entirely, so no coverage-exclude glob is needed for it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";

// Repo layout: <repo>/tests/js/vendor-resolve.js -> <repo>/hqptuner/static/
const STATIC_ROOT = new URL("../../../hqptuner/static/", import.meta.url);
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

// Matches `<name>.fresh-<tag>.js`, capturing `<name>` (without its `.js`) so
// the real module's source can be loaded under the fresh URL. `<tag>` may not
// contain `/` or `.`, which is enough to keep it from spilling into the next
// path segment or extension.
const FRESH = /^(.*)\.fresh-[^/.]+\.js$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!FRESH.test(specifier)) return nextResolve(specifier, context);
    const url = new URL(specifier, context.parentURL).href;
    return { url, format: "module", shortCircuit: true };
  },
  load(url, context, nextLoad) {
    const match = FRESH.exec(url);
    if (!match) return nextLoad(url, context);
    return {
      format: "module",
      source: readFileSync(fileURLToPath(`${match[1]}.js`), "utf8"),
      shortCircuit: true,
    };
  },
});

// Exported so a caller can assert what was picked up (and to keep the parsed
// mapping inspectable without re-reading the HTML).
export const importmap = MAPPING;
