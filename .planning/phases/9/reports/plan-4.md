PLAN COMPLETE
Plan: .planning/phases/9/PLAN-4.md
Tasks: 4 of 4
| Task | Commit | Note |
|---|---|---|
| 1 - Each JSON store serializes its read-modify-write | 51d22885 | Locks in live, favorites, descriptions, matrixmode, autopilot, narrowing; test file (5 JSON cases); CHANGELOG `### Security` bullet verbatim. |
| 2 - The preset store takes one lock for its directory | 21f1e1e2 | PresetStore lock, unlocked `_save` and `_set_active`; autosave-vs-first-save case. |
| 3 - Park, safety copy and connection store locks | 1f8dcaae | FilterPark (capacity and collision check through write, release, clear), PresetOps safety copy, ConnectionStore.write; same-name upload case. |
| 4 - Architecture records the store write rules | 7c63f140 | One paragraph in docs/architecture.md section 5.6. softwrap check rc=0. |

Full suite: `scripts/gate.sh make check` (the Makefile gate, workflow.test_command is null) printed `exit=0`, log /tmp/gate-make-auJY6VVS.log.

Bite proof (docs/testing.md rule 8), owner-ruled route (null stub first):
- Run 1, null stub: every touched store accepted `lock=` and ignored it (`self._lock` was `contextlib.nullcontext()`), so no store serialized. `scripts/gate.sh .venv/bin/pytest tests/presets/integrity/test_store_locks.py`: `7 failed`, log /tmp/gate-pytest-G1G1Hzuv.log. Failures by assertion, zero TypeError: five JSON cases `AssertionError: assert {'alpha'} == {'alpha', 'bravo'}`; autosave case `assert False is True`; park case `AssertionError: assert {b'first\n'} == {b'first\n', b'second\n'}`.
- Run 2, lock wired (`self._lock = threading.Lock() if lock is None else lock`): the file plus the pins (tests/presets/integrity, test_favorites, test_live_preset_store, test_description_store, test_matrix_mode_store, test_narrowing_store, test_autosave, test_filter_upload, test_connection_file_mode): `370 passed`, log /tmp/gate-pytest-Ld3OzSvt.log. `scripts/gate.sh make check` printed `exit=0` (/tmp/gate-make-qG8l9dWA.log); `filepawl check` rc=0. Every commit ran every pre-commit hook, none skipped.

Deviations:
- [owner-approved deviation] The plan carries no constructor seam. Owner ruling at the checkpoint: no `patches` exemption; each store whose lock a test observes takes an optional keyword-only `lock` (default None, the store makes its own `threading.Lock()`), typed `AbstractContextManager[object] | None`. Stores that gained it: LivePresetStore, FavoriteStore, DescriptionStore, AutopilotStore, MatrixModeStore, PresetStore, FilterPark. Not given it (no test observes their lock): NarrowingStore, PresetOps, ConnectionStore. Production call sites pass nothing and did not change. The `threading.Lock` monkeypatch in the test helper `built` is gone.
Open items:
- NarrowingStore.write replaces the whole document (last-wins is its contract), so it has no case of its own; its lock is held by the Action. Plan 5's disposition names it, with the PresetOps safety-copy lock and the ConnectionStore lock (two whole-file replaces end last-wins either way, so no test can bite).
- FilterPark's capacity check also sits inside the park lock (a superset of the planned hold), since two concurrent uploads could otherwise both pass it.
- Flagged by the plan, not engineered: PresetStore writes from event-loop code now wait on the lock for one small file write.
- The three feature commits split one test file by cases: commit 1 holds the five JSON cases, commit 2 adds the autosave case, commit 3 adds the park case.
