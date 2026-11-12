PLAN COMPLETE

Plan: .planning/phases/8/PLAN-1.md

Tasks: 8 of 8

Final suite (the `make test` steps except the wall-time gate, skipped on the owner's ruling; `workflow.test_command` is null): `pytest -m "not live and not e2e"` 3120 passed, 180 deselected, 2 warnings in 96.55s, total coverage 97%; `check_coverage_floor.py` `[ok] all 124 files cover at least 90%`; `check_idle.py` and `check_clock_waits.py` exit 0. The wall-time gate (`check_suite_time.py`) was skipped on the owner's ruling, with or without `--accept`, not run.

| Task | Commit | Note |
|---|---|---|
| 1 - Attribute values are escaped on write and unescaped on read | 2665a322 | Staged work from the prior dispatch, committed with the full hook green. Owner-delegated changelog bullet landed verbatim. |
| 2 - The fixed-volume line escapes its level | 87f967e0 | A parked level whose escaped form holds `--` carries every `-` as `&#45;`, decoded in `fixed_level_of` before the generic unescape. No bullet added (Notes: one phase bullet). |
| 3 - The five whitespace-leading patterns start on a literal | 135c4c1d | Characterization (exemption stated in the commit message). New helpers `xmledit.lead_start` and `strip_with_lead`; `_profile_re` became `_profile_span`. Mutation check turned 4 cases red (lead walk) and 1 (`drop_attr`). |
| 4 - Staged values carry a length and a key-count ceiling | 6feb6195 | Value ceiling 262144 characters, key ceiling 256, both in `pending.py`. `docs/openapi.json` description line edited by hand (the gate's `--write` reformats the whole file, so it was reverted). |
| 5 - One decision says whether a staged value is among its page's choices | 5721909e | `presetconf.check_choices` and `ChoiceCheck`. Static schema options all among the 6.0.4 `/config` choices except `volume_fixed` 2 (Q1, accepted). Null stub fails 9 cases. `filepawl accept` on `presetconf.py` (421 lines). |
| 6 - The stage route refuses a value its page does not offer | 60611f4f | Fixtures step needed no change (see open items). `docs/architecture.md` 4.7 added; `docs/openapi.json` description line edited by hand. `presetconf.MATRIX_PAGE_NAME` made public to stay inside the 421-line allowance. |
| 7 - The LIVE route refuses a value its page does not offer | 8eb3e576 | Existing test pinning an unlisted ID on the loaded chain: `tests/live/test_live_chain.py::test_a_value_in_no_list_the_loaded_chain_offers_is_refused`. Held-chain case red before, green after. |
| 8 - A 401 after a normal answer in the same apply is an engine fault | f1bcc93c | Knowledge of a 2xx: new `HttpConfigClient.answered` counter. `retract_refusal` on the client and the readings value restored (a refresh in the restart had already copied the 401 into the readings). `filepawl accept` on `restore.py` (410 lines). No fake knob needed: `_on_restore` sets `_refuse_auth`. `forms.py` and `fake_http.py` unchanged. |
| Fix pass (risk_surface high, xmledit.py:179) - a staged `http` value with a control character is refused at stage | 35c6a137 | `refuse_control_chars` in `pending.py` (code `invalid_input`, below U+0020, tab/LF/CR included; `live` args unchecked, they go to the Control API); `tests/api/surface/test_staged_control_chars.py` red 8 failed/1 passed before, green after; `docs/architecture.md` 4.7 and the `docs/openapi.json` stage description updated, `check_openapi.py` ok. `make check`: lint ok, 3098 passed, then wall-time gate refused (`suite 103.9s, last green 97.7s: +6.1s, escalate to owner (--accept)`, host load ~11 on 18 cores). Committed as `fix(8-1): a staged value with a control character is refused`. Medium and low findings untouched. New string: `pending.py` `StagedValueControlCharsError` "the value of {field} has a control character" (422). |
| Fix pass round 2 (risk_surface re-arm: U+FFFE/U+FFFF and lone surrogates still passed) | 1c9453b2 | Fixed by hand by the coordinator on the owner's word: new `xmledit.attr_cannot_carry`, used by `pending.py` and `matrixpayload.py`. Commit `fix(8-1): a value holding a surrogate or U+FFFE/U+FFFF is refused`. Risk step settled, no review fired. |

Deviations:

- [deviation] Task 2 Verify expected `fixed_volume` = `1-->` parked to be non-well-formed under expat; observed well-formed (the comment simply ends at the first `-->`, leaving `"/>-->` as text) though the level is corrupted. The well-formedness test uses `1--2` instead (red before, green after); `1-->` stays as the read-back test (red before: the open tag has no closing quote).

Open items:

- Damage report (8.1): while running a local check I ran `pytest tests/live`, which includes `live`-marked canary tests against the production hqplayerd. They made read-only GETs with the stock credential pair (answered 401 Authentication rejected); nothing was written. Nothing of mine is left running. Not repeated; later runs used `-m "not live"` or `make check`. A separate `pytest -m "not live"` run (no `not e2e`) also hit browser tests that errored; it wrote nothing.
- The first commit attempt of Task 7 failed in the hook because the not-yet-implemented Task 8 test file sat untracked in `tests/` and the offline suite collected it; it was moved aside for that commit and restored. No commit was affected.
- New user-facing strings, all `invalid_input` 422 bodies unless noted; whether the UI can display them is not verified here:
  - `hqptuner/api/routes/pending.py` `StagedValueTooLongError`: "the value of {field} is too long".
  - `hqptuner/api/routes/pending.py` `StagedBufferFullError`: "too many settings are staged".
  - `hqptuner/api/routes/pending.py` `NOT_OFFERED_REASON` "the value is not one HQPlayer offers", used by `StagedValueNotOfferedError` ("{fields}: the value is not one HQPlayer offers") at stage and as the per-field `route_refused` reason at `POST /api/config/live`.
  - `hqptuner/lanes/http/restore.py` `RestoreRefusedAfterAnswerError` (`daemon_write_failed`): "HQPlayer stopped accepting requests partway through applying the settings, as it does while it restarts. Check that HQPlayer is running, then apply again."
- Task 4 declined: the key ceiling counts `http` fields plus `live` keys as the plan says, not the argument count inside one live bucket; a bucket with very many short arguments is bounded only by the request body size.
- Task 4: stage checks the ceilings before the unknown-live-key check (the plan names the ceiling the first refusal); `config_live` checks them after the unknown-field check (Task 7's stated order).
- Task 1: `matrixscope` no longer uses `attr_unescape`, and a re-export would need a `noqa`, so `matrixconf.py` and `matrixprofiles.py` import `attr_escape` and `attr_unescape` from `xmledit` directly (two import lines, both in the lease) instead of the plan's one-line delta. Declined: no double-unescape guard on readers that use their own patterns, per the plan.
- Task 6 fixtures step: `http_client` already runs a fake 4321 beside its fake 8088 and `live_app` already holds a fake 8088 and the credential pair (both ready before the test body), so no fixture change, no deleted test and no suite run on a fixture-only change.
- Task 6: no `docs/openapi.json` `--write` (it reformats the whole file); the description line was edited by hand and `check_openapi.py` passes.
- Task 8: `Readings.credentials_ok` is restored to its value at the start of the apply, not only left alone, because a refresh during the restart wrote the 401 into it first. An apply whose only 401s are swallowed by the settle polls (ending unconverged, never raising `AuthRefused`) still leaves the client verdict False; out of this plan's scope.
- Uncommitted by this plan and left alone: the pre-existing modified and untracked `.planning/` files and `.idle-last.*.json` files.
