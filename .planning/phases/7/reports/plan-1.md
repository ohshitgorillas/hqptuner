PLAN COMPLETE

Plan: .planning/phases/7/PLAN-1.md

Tasks: 2 of 2

| Task | Commit | Note |
|---|---|---|
| 1 - The fake 8088 /config page is the captured 6.0.4 page | 537bc34d | `_http_render` serves `tests/support/fixtures/config-form-6.0.4.html` whole; only current values move in; `net_device` still lists `_net_endpoints`. New `tests/engine/http/test_fake_config_page.py` (bite proof: red 33 failed against the old fake in the prior dispatch). Rebuilt on the page's values: `tests/apply/test_http_apply.py` (parametrize case "offered, not running": old endpoint `S30/hw:CARD=Other,DEV=0` replaced by the page's `naa-7bdbb6cb/hw:CARD=RED,DEV=0`), `tests/engine/test_devicecaps.py` (`OTHER_LOG`, `OTHER`, same endpoint swap). `make check` exit=0 (suite 45.5 s vs baseline 46.4 s, [ok]); `make test-e2e` exit=0 (106 passed). |
| 2 - The fake 4321 enumerates the page's IDs | 1a27b1aa | `_PCM_FILTERS`, `_SDM_FILTERS`, `_PCM_SHAPERS`, `_SDM_SHAPERS` in `tests/support/fake_control.py` are literal tables of the page's `filter` (67), `oversampling` (77), `dither` (10) and `modulator` (36) selects; the enumeration comment rewritten on the page's IDs (enum 0 `none`/`poly-sinc-lp`, enum 57 `IIR2`/`poly-sinc-hb-s-2s`; gauss-long 37 PCM, 40 SDM). Added `test_fake_control_enumerates_the_pages_ids` x4 to the Task 1 file; bite proof: 4 failed against the old tables, passed after. `make check` exit=0, `make test-e2e` exit=0 (106 passed). Final `make check` after the commits: exit=0. |

Rebuilt tests (Task 2 fallout), behavior kept, values moved to the page's:
- tests/api/test_api_routes.py: `test_a_filter_value_is_translated_from_the_config_domain` (sinc-M enum 23 now SDM index 64).
- tests/apply/test_live_routed_batches.py: dither enum 5 is TPDF at PCM index 7 (`..._sends_no_setshaping_but_alone_it_does`, `..._reports_the_restored_dither`, `..._round_trip_ends_on_the_applied_shaper_index`, module docstring).
- tests/apply/test_live_routing_refusals.py: enum 25 sinc-M at PCM index 54 (`..._reasserts_a_filter_only_while_state_carries_the_other_half` and the siblings using the same value).
- tests/apply/test_manager_apply.py: dormant-chain values 40 (SDM) and 37 (PCM) for gauss-long, comment fixed.
- tests/engine/test_control_stall.py: `CLOSING_VALUE` 25, `CLOSING_STATE_VALUE` 54.
- tests/live/test_live_presets.py: filter index 54 / enum 25 / name `sinc-M`; other-chain preset test on sinc-M 64 (SDM) and 54 (PCM); apply test on 54 with live write 37.
- tests/live/test_live_chain.py: docstring IDs (37 PCM, 40 SDM), held-filter test on sinc-M 54/64, held-shaper comment (enum 5 is TPDF PCM index 7 and ASDM5 SDM index 4).
- tests/presets/test_rescan_replay.py: engine held filter index 54, shaper index 7, restored IDs 25 and 5.
- tests/presets/test_restore_carries_the_engine.py: modulator enum 11 (ASDM7EC) landing at SDM index 19.
- tests/test_cover_floor.py: `DITHER_NS9` renamed `DITHER_TPDF`, index 7.
- tests/presets/test_preset_names.py: `RECORD` filter ID 37.
- tests/e2e/test_shell.py: `PCM_FILTER_NAMES` read from the capture's `filter` select labels (parsed by `parse_config_form`); engine-change case uses filterNx 54.
- tests/e2e/test_combotip.py: `SHORT_MP` is enum 9 (page's `poly-sinc-short-mp`).

Deviations: none new. (The prior dispatch's suite-time deviation was resolved by the owner raising the baseline to 46.4 s; no `--accept` was needed, `check_suite_time` printed `[ok]` every run.)

Open items:
- Task 1 named `tests/engine/test_httpconf_form_types.py` and `tests/api/test_api_health.py` for rewrite on the page's select and number types. Neither asserts the old `text` types in this checkout, so nothing there changed; the types are pinned by `test_fake_page_field_has_the_captures_wire_type`.
- `tests/live/test_live_chain.py::_live_app` still builds a 4321-only app (no credentials). That is the 4321-only mode this phase removes; left for the later plans, outside this plan's goal.
- Declined: no per-test cache of the parsed capture in the new test file (about 0.5 s).
- `make test-e2e` needs `HQPTUNER_CHROMIUM` from `hqpcreds`; a first run without it errored on the missing Playwright browser (environment, not code); re-run with `hqpcreds` sourced passed.
- Process notes: Task 2 commit was first made with scope `7-2` by mistake and amended to `7-1` before anything else (unpushed). Two non-gate edits in `_matrix_render` that an earlier formatter pass had made in the Task 1 working tree were reverted before the Task 1 commit; `_matrix_render` and `_speakers_render` are untouched.
- Uncommitted and not mine: `.planning/**` modifications and untracked review files, `.idle-last.*.json`, `bug.png`.
