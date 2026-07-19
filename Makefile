VENV := .venv/bin

.PHONY: lint test test-live check

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

check: lint test
