PLAN COMPLETE
Plan: .planning/phases/7/PLAN-4.md
Tasks: 5 of 5
| Task | Commit | Note |
|---|---|---|
| 1 world stamps frames through the time base | 39e3649f | frames also carry `end` (samplesToMs of at+n), as the feed store stamps; span via secondsToMs |
| 2 schedules convert through the time base | 159b81bb | generated pools written by hand in whole samples at 44.1 kHz (767/851/948, 1019/979/900 = the old Math.round results); PAINT_MS = secondsToMs(1)/60; column suite's half slice written as 0.0125 s |
| 3 trace probes exact | 0ab227d9 | EPS gone; speed judged as head === before + dt; 91 of 91 pass |
| 4 playhead suite converts nothing itself | 4bb30ac1 | endOf helper, MS_PER_S, US_PER_MS gone; capture breaks from hand-written CAPTURE_BREAKS = [0]; capture frames carry `end` |
| 5 playhead suite exact | 31b36134 | EPS and 1e-9 gone; moves stated as position left = before + dt; 305 of 305 pass |
Deviations: none
Open items: full suite (make test-js, once, nice 19): 5647 tests, 5635 pass, 12 fail, identical to the AC7 baseline at 2fab7ba8. The 12 are all in tests/js/model/gauges/playhead-lag.test.js (e.g. test_a_start_stands_one_delay_behind_the_line_when_the_paint_ran_9_ms_after_the_arrival), a file outside this plan's lease; no test in this plan's files fails.
