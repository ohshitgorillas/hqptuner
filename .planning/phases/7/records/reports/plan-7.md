PLAN COMPLETE

Plan: /home/atom/dev/hqptuner2/.planning/phases/7/PLAN-7.md

Tasks: 5 of 5

| Task | Commit | Note |
|---|---|---|
| 1 - One relay serves both server-sent event streams | 0772cc8d | The earlier executor's staged diff (worktree wf_c7309df7-1ab-3) applied clean on 45eabf35 and was committed unchanged. `relay(feed)` plus a `Feed` Protocol live once in `api/push.py`; both routes call it. jscpd: no `push.py` / `routes/meter.py` clone. `tests/api` 340 passed. `make lint` exit 0. |
| 2 - The lane readings' file fields are declared once | none | No change. `LaneReadings` (the larger type) is a `Protocol` of settable attributes, `LaneFileFields` a `total=False` `TypedDict`; neither can inherit the other, and totality and meaning differ. The self-clone at `hqptuner/lanes/__init__.py` 55-63 / 159-167 stays as a type declaration that cannot share a field list, and commit 28aefc3d names it. |
| 3 - One too-new-store error serves both preset stores | 28aefc3d | `StoreTooNewError` in `jsonfile.py` holds the code, constructor and message shape once over a per-store `store_name`; `PresetSchemaError`, `LivePresetSchemaError` and (same cause, in the lease) `NarrowingSchemaError` mix it in ahead of their own bases, so every message reads as before. jscpd: no `live.py` / `presets.py` clone (111 to 110 clones). `tests/presets tests/api` 1052 passed, same as collected. `make lint` exit 0. |
| 4 - The narrowing facets' field lists | none | No change. `FacetsFile` against `Facets` is a TypedDict against a dataclass. `FacetsFile` against `FacetInput` differs in totality (`FacetInput` is `total=False`, `FacetsFile` whole) and a TypedDict cannot flip its base's totality. Both clones stay as type declarations; commit 72f881fb names each with its kind. |
| 5 - Scripts that copied engine code import it | 72f881fb | `capture_meter_start.py` imports `read_frame` from `engine/metering.py` (renamed from `_read_frame`, body unchanged, docstring added). `junkcal_view.py` takes the median filter from `junkcurve`. jscpd: no clone between `hqptuner/engine/` and either script (108 clones total). `tests/core/test_junkcal.py tests/engine` 436 passed. `make lint` exit 0. Neither script was run against the daemon. |

Final suite: `scripts/gate.sh make -k check` (workflow.test_command is null, so the Makefile's `check` target) at 72f881fb: lint green, pytest 3676 passed, red only in `test-js` on exactly the 12 baseline tests (playhead-lag 8, playhead-motion 3, playhead-scroll 1; log /tmp/gate-make-IuxwH9CN.log). Those are phase 8's tables, named in the dispatch as the baseline, not a regression of this plan.

Deviations: [deviation] Verify (4) `bash .claude/task-check.sh` passes (tasks 1, 3, 5): run once for task 1, it exits 1 at `make check` on the 12 baseline playhead tests, so it never requests the rebuild. Not rerun for tasks 3 and 5 (same deterministic red; the Python half was run by `make lint`, the subset suites and the final `make -k check`). No dev container rebuild and no hand-back URL were produced for any task of this plan.

Open items:

- `junkcal_view.py` keeps `median_smooth = junkcurve.median_smooth` only because `scripts/junkcal/junkcal_cli.py` (outside this plan's lease) imports `median_smooth` from the view and strict mypy refuses an implicit re-export. Importing it from `hqptuner.engine.junkcurve` in the cli would let the alias go.
- Behavior edge in `median_smooth`: the view's old copy returned a copy for any width at or below 1; the engine's function does the same for widths 0 and 1 but raises `StatisticsError` for a negative width. Only reachable through a negative `--smooth` on the junkcal CLI.
- `hqptuner/presets/store/narrowingjson.py` `FacetInput` docstring says every value is typed `object` on purpose, while the fields are typed concretely. Left as is.
- `scripts/junkcal/junkcal_burst.py` has its own raw-bytes `_read_frame` and docstring references to `MeteringReader._read_frame`; not a jscpd clone and outside the lease.
- Task 1 evidence from the earlier executor's run (14 mypy `has-type` errors and the `doc-refs` failure) were worktree-environment artifacts and did not occur in this tree.
