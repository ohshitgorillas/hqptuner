PLAN COMPLETE
Plan: .planning/phases/7/PLAN-17.md
Tasks: 6 of 6
| Task | Commit | Note |
|---|---|---|
| 1 - engine frame read hands back header bytes | b699b638 | tests-first (red: ImportError on read_raw_frame, tests/engine/test_metering_frame.py); landed in one commit with task 2 because jscpd counts the engine's new read against the burst's old copy until both are in, and the repo pre-commit hook fails on it |
| 2 - burst capture reads through the engine | b699b638 | see task 1 |
| 3 - probe and junk-burst tools take layout from engine | 129445b4 | probe analyze output byte-identical (synthetic 5-frame stereo capture) |
| 4 - tests' metering frames packed in one place | 781e9725 | 30 frame digests identical before and after; 74 pins pass at HEAD and after (+5 new engine cases = 79); 3 e2e pass |
| 5 - one CliError and one runner | 95cafbe3 | run_cli is now synchronous; the eight probes call run_cli(lambda: asyncio.run(_run())); kaiser oracle bytes identical; all 8 probes load |
| 6 - WAVE containers built in one place | d23e5b76 | 31 container digests identical before and after; 82 tests same count; e2e upload 2 pass |
Deviations: none
Open items: none. Full suite (make test, the Makefile target, workflow.test_command is null) green, rc=0
