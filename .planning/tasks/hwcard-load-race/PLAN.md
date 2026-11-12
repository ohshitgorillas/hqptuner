# Task: hardware card load race

Behavior the owner wants: on the System tab's Hardware acceleration card, a setting the user changes before HQPlayer's hardware settings have arrived keeps the user's choice when they arrive, and the apply button marks it as an unapplied change. Settings the user did not touch take what HQPlayer reported. No control is disabled while the read is out. The browser suite's "card loaded" precondition waits for that read to land rather than for a box the defaults already fill.

Changelog, owner-approved verbatim, under `[Unreleased]` `### Fixed`: `- **Hardware settings changed while the System tab is still loading are kept.**`

## Task 1: tests first

- Files: `tests/js/lib/keepedits.test.js` (new), `tests/e2e/test_hwapply.py`.
- Action: a pure-function test of the decision of which value each setting shows when the reading lands, and one browser case that holds the card's engine read, changes a setting, releases the read and reads the apply button.
- Verify: with `hqptuner/static/lib/keepedits.js` as a null stub (exports `keepEdits`, returns `{}`) the unit cases fail on their assertions; against the current `SystemHardware.js` the browser case fails on its assertion. Testing scope: the new unit file and `tests/e2e/test_hwapply.py` only.

## Task 2: the fix

- Files: `hqptuner/static/lib/keepedits.js` (new), `hqptuner/static/components/system/SystemHardware.js`, `tests/e2e/test_hwapply.py` (`loaded_card` precondition), `CHANGELOG.md`.
- Action: the card's load hands the settings as they stood when the read went out, as they stand now, and as reported to `keepEdits`, shows its answer and snapshots the reported values. `loaded_card` waits for the engine read's response, then two frames. Caller-side delta: one call site, in `SystemHardware.js` `load()`.
- Verify: the Task 1 tests pass; `tests/e2e/test_hwapply.py` passes 20 repeats locally; `scripts/gate.sh make check` exits 0.

## Outcome

- `3409315b`: `loaded_card` waits for the `GET /api/engine` response, then two frames; the card's browser driver moved to `tests/e2e/support/hwcard.py` because `test_hwapply.py` was at its 800-line filepawl cap.
- `4e6ccb4f`: `load()` keeps the user's value for a setting moved while the read was out (`lib/keepedits.js`) and snapshots what the daemon reported; changelog line landed verbatim.
- Bite: unit cases red against a null stub; `tests/e2e/test_hwload.py` red against the pre-fix card (`assert 'primary' in ['btn']`). Both e2e files passed 20 of 20 local repeats; `make check` exit 0.
- Deviation: the driver split, not in the plan, forced by the file cap.
