PLAN CHECKPOINT: blocked Plan: .planning/phases/9/PLAN-4.md Tasks: 0 of 4
| Task | Commit | Note |
|---|---|---|
| 1 - Each JSON store serializes its read-modify-write | none | Locks, tests and the CHANGELOG bullet are written and uncommitted in the working tree. The commit was refused by the pre-commit `filepawl tree gate`. |
| 2 - The preset store takes one lock for its directory | none | Written, uncommitted. Same test file, same gate line. |
| 3 - Park, safety copy and connection store locks | none | Written, uncommitted. Same test file, same gate line. |
| 4 - Architecture records the store write rules | none | Not started. |

Gate line, quoted: `tests/presets/integrity/test_store_locks.py::built: patches at line 85 — fake at the wire, never a patch`

What is in the working tree (unstaged, not committed):
- `threading.Lock` per instance in LivePresetStore, FavoriteStore, DescriptionStore (write, merge), AutopilotStore (enable, disable, set_for_preset), NarrowingStore.write, MatrixModeStore (write, forget), PresetStore (save, delete, set_autosave, set_active, import_missing, with unlocked private `_save` and `_set_active`), FilterPark (park from the capacity check through the write, release, clear), PresetOps safety copy (write plus prune), ConnectionStore.write.
- `tests/presets/integrity/test_store_locks.py`: 7 cases (five JSON stores, preset store autosave vs first save, park same-name upload).
- `CHANGELOG.md` `### Security`: `- **Two saves at the same moment both land.**`
- Bite proof: against the pre-change code (locks absent) all 7 cases fail by assertion (lost update, `assert False is True` for autosave). With the locks, the file passes and the pins pass (370 passed over tests/presets/integrity, the five store test files, test_autosave, test_filter_upload, test_connection_file_mode). `scripts/gate.sh make check` printed `exit=0` before the commit, but that run saw the test file as untracked; the commit-time filepawl gate reads it and fails.

Why the seam is gated: a lost update needs the first writer parked between its read and its write while the second writer runs. With a lock, the second writer blocks until the first finishes, so the first writer can only be released by observing that the second is blocked. Seams tried:
1. Path subclass that parks the first writer at its first write (`with_name`), released when the second writer finishes. Alone it deadlocks against a real lock, because the second writer never finishes while the first holds it.
2. Same, plus a spy lock that reports contention, injected by `monkeypatch.setattr(threading, "Lock", ...)` while the stores are constructed. Deterministic, no sleep, bites (7 of 7 red without locks, 7 of 7 green with). It is a patch, so the filepawl `mocks` gate refuses it.
3. A timed wait in the park (ceiling only) would run out on every green run, which `scripts/gates/check_clock_waits.py` refuses.
4. Observing the blocked thread (`sys._current_frames`, `/proc/self/task`, `sys.setprofile`) is private reach or environment coupling and not deterministic.
5. A subclass that rebinds `self._lock` passes the gate text but reaches an internal by name (`docs/testing.md` rule 3).

Need (owner decision): one of

- (a) owner approval of a `patches` exemption at `tests/presets/integrity/test_store_locks.py::built`, patching the standard-library `threading.Lock` factory only while a store is constructed (names the gate, the site, why the code cannot satisfy it; cost: one stdlib patch in one test helper);
- (b) owner approval of a lock seam in the product constructors (an optional lock argument on the stores), which the current plan does not carry and which changes eight constructors; the pre-change code would then fail by TypeError, not by assertion, so rule 8 bite would need the null-stub route;
- (c) owner ruling that the locks are held by the Action alone, with no behavioral test of mutual exclusion.

No filepawl allowance or cap issue arose (nothing printed a watch line).

Deviations: none Open items: NarrowingStore.write replaces the whole document (last-wins is its contract), so it has no red case of its own; it is locked by the Action and must be named in Plan 5's disposition as held by the Action. The safety-copy lock (PresetOps) and ConnectionStore lock are held by the Action per Task 3 (two whole-file replaces end last-wins either way). FilterPark's capacity check also sits inside the park lock (a superset of the planned collision-check-to-write hold), since two concurrent uploads could otherwise both pass it. Flagged by the plan, reported not engineered: PresetStore writes from event-loop code now wait on the lock for one small file write.
