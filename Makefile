VENV := .venv/bin

.PHONY: lint lint-js test test-live test-e2e test-js check manual mutate

lint:
	$(VENV)/ruff check hqptuner tests scripts
	$(VENV)/black --check hqptuner tests scripts
	$(VENV)/xenon --max-absolute B --max-average A --max-modules A hqptuner
	$(VENV)/vulture
	$(VENV)/mypy
	$(VENV)/lint-imports
	$(VENV)/python scripts/gates/check_file_length.py $$(git ls-files '*.py' 2>/dev/null || find hqptuner tests scripts -name '*.py')
	$(VENV)/python scripts/gates/check_test_assertions.py $$(git ls-files 'tests/*.py')
	$(VENV)/python scripts/gates/check_doc_refs.py $$(git ls-files '*.py' '*.js' '*.md' | grep -v 'static/vendor/')
	$(VENV)/python scripts/gates/check_archaeology.py $$(git ls-files '*.py' '*.js' '*.css' | grep -v 'static/vendor/' | grep -v '^tests/' | grep -v '^scripts/probes/')
	$(VENV)/python scripts/gates/check_gates_wired.py
	$(VENV)/python scripts/gates/check_binaural.py
	$(VENV)/python scripts/gates/check_xfeed.py

# Frontend gates, one-for-one with the Python ones above: eslint (ruff),
# prettier (black), tsc --checkJs (mypy), knip (vulture). The complexity ceiling
# lives in eslint.config.js and matches xenon --max-absolute B. The length gate
# also covers CSS: the stylesheet is split by concern under static/css/ and the
# `<link>` order in index.html is the cascade order.
#
# There are two tsc invocations because the trees run in different places.
# jsconfig.json covers the browser tree: DOM libs, no node types. tsconfig.node.json
# covers the CLI tools under scripts/, which need @types/node and would otherwise
# resolve `process`, `Buffer` and `node:*` imports to nothing. Same compiler
# options otherwise, strict included — neither tree gets a weaker standard.
#
# store/schema.js is exempt from the length gate: it is a one-entry-per-line
# control table rather than logic, and prettier at printWidth 120 is what pushed
# it past 500. vendor/ is upstream and exempt from every gate.
#
# jscpd is the one gate here that is not frontend-only: it reads Python, JS and
# CSS in a single pass. It lives in this target rather than `lint` because it is
# an npx tool, and `lint` is the venv-only half that has to stay runnable with
# no node_modules installed. Its whole configuration — paths, formats, vendor
# exclusion, threshold — is in .jscpd.json, so the recipe is a bare invocation.
lint-js:
	npx eslint .
	npx prettier --check "hqptuner/static/**/*.js" "tests/js/**/*.js" "eslint-rules/*.js" "scripts/*/*.js" eslint.config.js jsconfig.json tsconfig.node.json knip.json .jscpd.json types/vendor.d.ts
	npx tsc -p jsconfig.json
	npx tsc -p tsconfig.node.json
	npx knip
	npx jscpd
	$(VENV)/python scripts/gates/check_file_length.py $$(git ls-files '*.js' | grep -v 'static/vendor/' | grep -v 'store/schema.js') $$(git ls-files '*.css')
	$(VENV)/python scripts/gates/check_css_tokens.py $$(git ls-files 'hqptuner/static/css/*.css')
	$(VENV)/python scripts/gates/check_css_cards.py $$(git ls-files 'hqptuner/static/css/*.css')
	$(VENV)/python scripts/gates/check_css_classes.py
	$(VENV)/python scripts/gates/check_css_dead.py
	$(VENV)/python scripts/gates/check_css_dirty.py
	$(VENV)/python scripts/gates/check_control_catalog.py

# The coverage floor is per file and lives in the gate below, not in
# --cov-fail-under. Second recipe line, so a failing suite reports first.
test:
	$(VENV)/pytest -m "not live and not e2e" -q --cov=hqptuner --cov-branch --cov-report=term-missing --cov-report=json:.coverage.json
	$(VENV)/python scripts/gates/check_coverage_floor.py

test-live:
	$(VENV)/pytest -m "not e2e" -q

test-e2e:
	$(VENV)/pytest -m e2e --no-cov -q

# --import installs tests/js/vendor-resolve.js, which reads the importmap out of
# hqptuner/static/index.html and resolves the bare specifiers (preact, htm,
# @preact/signals, ...) to the vendored bundles — the same files the browser
# loads. Without it any module importing them fails to resolve.
# Explicit file list, not `tests/js/`: node's test runner rejects a bare
# directory argument here (ERR_UNSUPPORTED_DIR_IMPORT), hook or no hook.
test-js:
	node --import ./tests/js/support/vendor-resolve.js --test tests/js/*/*.test.js

check: lint lint-js test test-js

# Pre-parse the vendored Signalyst docs into docs/vendor/manual/ — one file per
# manual subsection plus an index, so an agent reads the section it needs
# instead of pdftotext'ing all 65 pages into context. Output is gitignored
# (derived from copyrighted material) and rebuilt from hqplayer6desktop-manual.pdf
# on demand; deliberately not part of `check`, which must stay runnable without
# a copy of the manual in place.
manual:
	$(VENV)/python scripts/build_manual.py

# Mutation testing — a periodic health check on the SUITE, deliberately absent
# from `check` above and from the pre-commit hooks. It breaks the code on
# purpose, one edit at a time, and reports how many of those breakages the tests
# noticed; a surviving mutant is a line no test constrains. The whole package
# takes hours, so scope it while working:
#
#     make mutate                                    # everything under hqptuner/
#     make mutate MUTATE='hqptuner.presetstore.*'    # one module
#
# MUTATE is an fnmatch pattern over mutant names (module dotted path, function,
# counter), so the trailing `.*` is load-bearing: a bare module name matches no
# mutant and mutmut asserts rather than running.
#
# `mutmut run` exits non-zero when mutants survive, which is the normal outcome
# and not a reason to skip the report — hence the leading `-`. Scope and pytest
# arguments live in pyproject.toml under [tool.mutmut]; the working copies go in
# the gitignored mutants/ directory.
mutate:
	-$(VENV)/mutmut run $(MUTATE)
	$(VENV)/mutmut results
