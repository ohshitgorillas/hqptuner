VENV := .venv/bin

.PHONY: lint lint-js test test-live test-js check

lint:
	$(VENV)/ruff check hqptuner tests scripts
	$(VENV)/black --check hqptuner tests scripts
	$(VENV)/xenon --max-absolute B --max-average A --max-modules A hqptuner
	$(VENV)/vulture
	$(VENV)/mypy
	$(VENV)/python scripts/check_file_length.py $$(git ls-files '*.py' 2>/dev/null || find hqptuner tests scripts -name '*.py')
	$(VENV)/python scripts/check_test_assertions.py tests/*.py
	$(VENV)/python scripts/check_doc_refs.py $$(git ls-files '*.py' '*.js' '*.md' | grep -v 'static/vendor/')

# Frontend gates, one-for-one with the Python ones above: eslint (ruff),
# prettier (black), tsc --checkJs (mypy), knip (vulture). The complexity ceiling
# lives in eslint.config.js and matches xenon --max-absolute B. The length gate
# also covers CSS: the stylesheet is split by concern under static/css/ and the
# `<link>` order in index.html is the cascade order.
#
# store/schema.js is exempt from the length gate: it is a one-entry-per-line
# control table rather than logic, and prettier at printWidth 120 is what pushed
# it past 500. vendor/ is upstream and exempt from every gate.
lint-js:
	npx eslint .
	npx prettier --check "hqptuner/static/**/*.js" "tests/js/*.js" "eslint-rules/*.js" eslint.config.js jsconfig.json knip.json types/vendor.d.ts
	npx tsc -p jsconfig.json
	npx knip
	$(VENV)/python scripts/check_file_length.py $$(git ls-files '*.js' | grep -v 'static/vendor/' | grep -v 'store/schema.js') $$(git ls-files '*.css')
	$(VENV)/python scripts/check_css_tokens.py $$(git ls-files 'hqptuner/static/css/*.css')
	$(VENV)/python scripts/check_css_classes.py
	$(VENV)/python scripts/check_control_catalog.py

test:
	$(VENV)/pytest -m "not live" -q

test-live:
	$(VENV)/pytest -q

# --import installs tests/js/vendor-resolve.js, which reads the importmap out of
# hqptuner/static/index.html and resolves the bare specifiers (preact, htm,
# @preact/signals, ...) to the vendored bundles — the same files the browser
# loads. Without it any module importing them fails to resolve.
# Explicit file list, not `tests/js/`: node's test runner rejects a bare
# directory argument here (ERR_UNSUPPORTED_DIR_IMPORT), hook or no hook.
test-js:
	node --import ./tests/js/vendor-resolve.js --test tests/js/*.test.js

check: lint lint-js test test-js
