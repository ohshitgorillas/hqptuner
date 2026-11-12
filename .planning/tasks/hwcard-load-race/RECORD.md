# Task: hwcard-load-race

## What shipped

- A hardware setting changed before the card's engine read lands keeps the user's choice and marks the apply button; the e2e precondition waits for the read's answer instead of a box the defaults fill.

## Commits

| Task | Commit | Description |
| --- | --- | --- |
| 1 | 3409315b4e1e8cae750be8d86d001ee2dedf3056 | test(e2e): the hardware card waits for its engine read before a case edits it |
| 1 | 4e6ccb4fba7209827e75d1918ec32c04b0f664e5 | fix: a hardware setting changed before the card's read lands keeps the user's choice |
| 1 | 60c0fc384d654cdd65215ce8dba4100b37d7edbf | docs: task plan hwcard-load-race |

## Files

### Task 1: hwcard-load-race

- **Files:** .planning/tasks/hwcard-load-race/PLAN.md, CHANGELOG.md, hqptuner/static/components/system/SystemHardware.js, hqptuner/static/lib/keepedits.js, tests/e2e/support/hwcard.py, tests/e2e/test_hwapply.py, tests/e2e/test_hwload.py, tests/js/lib/keepedits.test.js
