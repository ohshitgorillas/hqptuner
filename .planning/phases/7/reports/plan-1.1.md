PLAN CHECKPOINT: structural

Plan: .planning/phases/7/PLAN-1.md

Tasks: 0 of 2

| Task | Commit | Note |
|---|---|---|
| 1 - The fake 8088 /config page is the captured 6.0.4 page | none | Built and green on its own tests and the offline suite, NOT committed: `scripts/gate.sh make check` fails the suite-time gate (see Deviations). Working tree holds: tests/support/fake_http.py (`_http_render` serves the capture), tests/engine/http/test_fake_config_page.py (new, 32 cases, red 33 failed against the old fake, green after), tests/apply/test_http_apply.py and tests/engine/test_devicecaps.py (rebuilt: the old second endpoint `S30/hw:CARD=Other,DEV=0` is gone, replaced by the page's `naa-7bdbb6cb/hw:CARD=RED,DEV=0`; same behavior asserted). |
| 2 - The fake 4321 enumerates the page's IDs | none | Not started. The four AC5 ID-list tests are written (saved at /tmp/ctl_full_test.py, red against the old tables) but held out of the Task 1 file so Task 1 carries no failing test. |

Deviations:
- [deviation] Task 1 `Verify:` says `scripts/gate.sh make check` prints `exit=0`. Observed: lint (ruff, black, xenon, vulture, mypy, lint-imports, filepawl at 797 of 800 lines for fake_http.py) all pass; the `test` step aborts in `suite_deadline` ("still running 46.8s after session start, aborted"). Cause measured, not guessed: serving the page whole (D-12) makes every `parse_config_form` read cost 9.7 ms instead of about 0.3 ms. A counting plugin over the offline suite: 1893 calls, 11.80 s in `parse_config_form`. Same host, same load: 34.9 s with the old fake, 46.4 s with the new one (+11.5 s; no coverage plugins). Baseline `.suite-time.dev.json` is 36.821 s, and `scripts/gates/testing/check_suite_time.py` refuses a run 10 s or more over it, with or without `--accept` ("the way past is a faster suite"). The plan assumed the whole-page fake was free; it is not, and the lease (tests only, no change under `hqptuner/`) holds no faster suite.

Open items:
- Options for the owner, none taken: (a) a faster form parse in `hqptuner/conf/formparse.py` (bs4 `html.parser` is the cost; a different parser would be a dependency install, a human call; a `SoupStrainer` is a code change outside this lease); (b) fewer parses per test in the suite's manager fixtures (not obviously possible without changing behavior); (c) the owner resets the suite-time baseline (not mine to do); (d) keep D-12 but serve fewer sections (contradicts "copy the real page whole").
- Task 1 `test-e2e` not run (blocked behind `make check`).
- Task 1 also named `tests/engine/test_httpconf_form_types.py` and `tests/api/test_api_health.py` for rewrite to the page's select and number types. Neither asserts the old `text` types for filter, samplerate, bitrate or channels in this checkout (the first reads only the capture's first field; the second has no field-type assertion), so nothing there was rebuilt; the types are pinned by the new file's `test_fake_page_field_has_the_captures_wire_type`.
- Process slip: one `scripts/gate.sh` pytest run was piped into `tail` once (rule in project CLAUDE.md); its verdict was not relied on, the gate was re-run unpiped. Timing probes (`time pytest`, a counting plugin under /tmp/pcount) were not gates.
- Declined fuller shape: no per-test cache of the parsed capture in the new test file; it would save about 0.5 s and not change the conclusion.
