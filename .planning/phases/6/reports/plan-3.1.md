PLAN CHECKPOINT: decision

Plan: .planning/phases/6/PLAN-3.md

Tasks: 4 of 7 (Tasks 5 and 6 struck by owner ruling; Task 7 half done, copy pending)

| Task | Commit | Note |
|---|---|---|
| 1 - saved host the validator refuses reads as corrupt | 8f108525 | ConnectionStore.read runs check_host inside its existing except; held_record drops its now-dead InvalidHostError arm; routes `remembered` goes through held_record (corrupt and invalid alike read as no choice). Bite: start health and login red against the previous src (InvalidURL, then 500). |
| 2 - corrupt or invalid record counts as a chosen host | 31a88dcc | _adopt_alias returns when read raises. One parametrized test over no-record (alias asked), invalid-host and unparseable (not asked), because the filepawl claims gate refuses a test that asserts only an absent value. Both unusable cases red against the previous src. |
| 3 - image marker, only a marked start probes the alias | ffad0a0b | `HQPTUNER_IN_IMAGE=1` in the Dockerfile ENV block, `Config.in_image`, `_adopt_alias` returns first where it is off. Before replacing tests, the run was red on exactly: the alias case of test_a_start_dials_the_record_then_the_variable_and_falls_back_to_the_host_alias, both cases of test_a_start_with_no_host_adopts_the_alias_served_in_process (renamed ..._in_the_image_...), plus my own no-record case in test_startup_bad_host.py (unmarked). Replacements add `in_image=True`. Corrupt-record return removed by hand: both unusable-record cases red; restored. Marker-on bite of test_alias_marker.py is a TypeError against the previous src (new field); the marker-off case is an assertion failure. |
| 4 - discovery fallback asks the alias only in the image | f10726bc | Route builds Search(alias=None) outside the image; `Search.alias` is `str or None`; discover skips the probe on None. Before the replacement, the three discovery test files were red on only the alias-listening case. Replacement is a three-case parametrization (image and listening, image and not listening, outside the image and listening); the last is red against the previous src. The outside-image case counts nothing: a daemon is listening at the alias and is not listed, which a probe would have listed. |
| 5 - struck (D-04 offer half) | none | Struck by owner ruling, not skipped. |
| 6 - struck (D-04 offer half) | none | Struck by owner ruling, not skipped. |
| 7 - docs | d4a7bd2e (comments only) | `ALIAS` comment in engine/discovery.py and the `Config.container_host_alias`/`in_image` comments (the latter in ffad0a0b) say the alias is asked only in the image. NOT DONE: README.md `HQPTUNER_CONTAINER_HOST_ALIAS` row (line 244) and a new row for HQPTUNER_IN_IMAGE, the compose.yaml header comment, and a CHANGELOG bullet. Owner-approved wording for these is not in hand (searched the plan, CONTEXT, PLAN-1..5, CHANGELOG, README, compose.yaml); the approved Security entries in CHANGELOG do not cover the alias change. |

Deviations: none

Open items:

- Task 7 copy pending (see above): README row text for HQPTUNER_CONTAINER_HOST_ALIAS, README row text for HQPTUNER_IN_IMAGE, whether compose.yaml's "HQPTuner finds it there on first start" stays, and whether a CHANGELOG `### Security` bullet is wanted for the alias change.
- Assumed, not verified in hand: the owner's confirmation (Plan 1 Notes, items 9 and 10) for replacing `test_a_start_with_no_host_adopts_the_alias_served_in_process` and the alias-listening case of `test_a_zero_search_window_still_serves_the_daemon_the_host_alias_names`. The replacements keep each claim and add the marker; revert ffad0a0b and f10726bc if the owner did not confirm.
- The full suite was not run as a separate step; pre-commit's offline pytest, coverage floor and `make lint` passed at each commit. Task 7's `make check` run and the final full-suite run follow the copy.
- Declined fuller shapes: none.
- The unstaged owner edits under `.planning/` were left uncommitted.
