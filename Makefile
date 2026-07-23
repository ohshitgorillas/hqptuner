VENV := .venv/bin

.PHONY: lint test test-live test-js check

lint:
	$(VENV)/ruff check hqptuner tests scripts
	$(VENV)/black --check hqptuner tests scripts
	$(VENV)/xenon --max-absolute B --max-average A --max-modules A hqptuner
	$(VENV)/vulture
	$(VENV)/mypy
	$(VENV)/python scripts/check_file_length.py $$(git ls-files '*.py' 2>/dev/null || find hqptuner tests scripts -name '*.py')
	$(VENV)/python scripts/check_test_assertions.py tests/*.py

test:
	$(VENV)/pytest -m "not live" -q

test-live:
	$(VENV)/pytest -q

# Frontend suite. --import installs tests/js/vendor-resolve.js, which reads the
# importmap out of hqptuner/static/index.html and resolves the bare specifiers
# (preact, htm, @preact/signals, …) to the vendored bundles — the same files the
# browser loads. Without it any module importing them fails to resolve.
# Explicit file list, not `tests/js/`: node's test runner rejects a bare
# directory argument here (ERR_UNSUPPORTED_DIR_IMPORT), hook or no hook.
test-js:
	node --import ./tests/js/vendor-resolve.js --test tests/js/*.test.js

check: lint test
