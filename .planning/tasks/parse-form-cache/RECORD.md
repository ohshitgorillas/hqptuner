# Task: parse-form-cache

## What shipped

- Parse each 8088 form page once per page text (bounded lru_cache) and hand callers a deep copy; /matrix builds its tree once. Offline suite 112.7 s -> 55.4 s.

## Commits

| Task | Commit | Description |
| --- | --- | --- |
| 1 | 5bab6bfdf5e27c4c0be3598f761f960504c5b404 | perf(conf): parse each 8088 form page once and hand callers a copy |

## Files

### Task 1: parse-form-cache

- **Files:** hqptuner/conf/formparse.py, tests/apply/test_form_parse.py
