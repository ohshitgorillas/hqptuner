PLAN PARTIAL

Plan: .planning/phases/7/PLAN-3.md

Tasks: 3 of 8

| Task | Commit | Note |
|---|---|---|
| 1 - live_app, live_api, chain_api gain the 8088 lane | 7ca14657 | `apps.ready_app` (new) hands over an app once `/api/health` reads `ready`; `live_app` builds on it with credentials and its own in-process fake 8088. `lose_http_client` (new) is the no-client state mid-run. `tests/live/test_live_chain.py` lost its private `_live_app` and `chain_api` copy (the shared `chain_api` is identical). The two no-credentials cases in `test_api_error_codes.py` and the two failed-fold cases in `test_autosave.py` lose the client mid-run and keep their codes. Suite-time gate accepted (+6.2 s, owner decision). |
| 2 - api_client serves a two-lane app | 63613f8e | `api_client` is `live_app` on the threaded 4321 fake. New shared fixture `daemonless_client` (ready, then `fake_control.take_lane_down`) carries the volume, matrix-switch, live-apply, failed-apply-keeps-staging and write-with-no-control-connection cases. The snapshot-before-first-load case runs on `unloaded_client` (`unserved_login`, closed control port, neither lane answering). |
| 3 - http_client and the credential-test app gain a control lane | 75a2f11c | `http_client` and `fixtures_clients.app` run on a threaded 4321 fake and go through `ready_app`; callers of `app` that passed `closed_port` (audit wiring, volume trace, preset lifecycle, state export) pass `threaded_daemon_port`. `nocreds_client` (ready, then `lose_http_client`), `deaf_client` (ready `http_client`, then the 8088 `_take_lane_down`), `half_wired_client` (ready, forms cleared, `_fail_paths` set, one poll). `test_form_routes_before_any_fetch_are_unavailable` runs on `unloaded_client` (neither lane answering). Suite-time gate accepted (+9.7 s, owner decision); `make check` exit=0 after. |

Tests removed or rebuilt, with the 4321-only behavior each pinned:

- `tests/presets/test_restart_survival.py`: the stored value of an active preset beats the engine only where the engine cannot answer (`presetfields.carried_live_fields`: running engine is the authority, store the fallback). Removed, each pinning "the stored value boots when no engine reading exists": `test_a_stored_output_mode_is_what_the_daemon_boots_on`, the `filter1x-5`, `filter-25`, `dither-5` and `adaptive_volume-1` cases of `test_a_stored_live_routed_setting_is_what_the_daemon_boots_on`, the `filter` case of `STAGED_BEATS_STORED`, `test_an_engine_apply_boots_the_daemon_on_the_stored_mode`. The dormant-chain and rate-limit cases stay (the engine cannot answer for them). Rebuilt on a new `engine_client` factory (a control daemon with its State set): the two "running value is what boots" cases (engine runs SDM, as the config file does) and the adaptive-volume engine-apply pair (the engine runs adaptive volume 1, no preset).
- `tests/matrix/test_profile_fanout.py` (`preset_profiles` read model) and `tests/presets/test_autosave.py` (`test_an_autosaving_apply_leaves_only_the_saved_presets_on_disk`): a ready app has imported the daemon's own `Test` preset, so the expected maps and name lists carry it.
- `tests/apply/test_engine_apply.py`: one added test, `test_an_engine_apply_lands_when_the_engine_has_reported_no_state`, because the removed 4321-less cases were the only cover of the empty-carry branch of `engineattrs._with_carried_live_fields`; `scripts/gates/testing/check_coverage_floor.py` read `engineattrs.py` at 89.29% (floor 90%) without it.

Deviations: none

Open items: none
