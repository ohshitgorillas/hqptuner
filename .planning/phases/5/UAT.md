---
status: testing
phase: 5
fields_version: 1
started: 2026-11-08
updated: 2026-11-09
---

## Items

### 1. Playhead closes lag after a long burst gap
expected: After a burst gap longer than the queued slack, the playhead returns to the target with no jump and no step backward; a model-lane test shows the lag goes to zero.
criterion: AC1
status: skipped
first_pass: pass
source: model
evidence: `scripts/gate.sh node --test playhead.test.js loop.test.js loop-painters.test.js` -> exit=0, 185 pass 0 fail; `scripts/gate.sh make check` exit=0. test_the_playhead_at_a_0_ms_delay_stands_that_far_behind_the_newest_frames_end (every 128 ms gap exceeds the zero slack; final playhead == EDGE, lag 0) plus the never_moves_backward and never_jumps_further_than_its_speed_allows invariants over every run.
reason: Owner decision 2026-11-08: superseded by the D-01 revision; AC2 and AC4 are now held by items 6 and 7 in the current wording, and AC1 was removed from CONTEXT.md.

### 2. Lowered delay reached without a break
expected: After the delay is lowered mid-feed, the playhead reaches the new target without a jump and without waiting for a break.
criterion: AC2
status: skipped
first_pass: pass
source: model
evidence: `scripts/gate.sh node --test playhead.test.js loop.test.js loop-painters.test.js` -> exit=0, 185 pass 0 fail; `scripts/gate.sh make check` exit=0. test_a_delay_lowered_mid_feed_leaves_the_playhead_at_the_new_target_once_the_feed_has_gone_on (playhead == EDGE), and in a_delay_lowered_mid_feed runs at 16 and 32 ms: never_moves_backward, never_jumps_further_than_its_speed_allows, no_paint_after_the_first_restarts.
reason: Owner decision 2026-11-08: superseded by the D-01 revision; AC2 and AC4 are now held by items 6 and 7 in the current wording, and AC1 was removed from CONTEXT.md.

### 3. Two paint rates converge
expected: Two paint rates fed the same arrival schedule converge to the same playhead by the next caught-up paint.
criterion: AC3
status: pass
first_pass: pass
source: model
evidence: `scripts/gate.sh node --test playhead.test.js loop.test.js loop-painters.test.js` -> exit=0, 185 pass 0 fail; `scripts/gate.sh make check` exit=0. test_two_paint_rates_at_a_{0,SPLIT,250}_ms_delay_stand_at_the_same_playhead_at_the_end_of_every_gap (16 vs 32 ms paints, deepEqual at every gap end) and ..._never_differ_by_more_than_the_slower_ones_interval_of_movement.

### 4. Playhead never passes target or moves backward
expected: The playhead never passes the target, and never moves backward except at a break.
criterion: AC4
status: skipped
first_pass: pass
source: model
evidence: `scripts/gate.sh node --test playhead.test.js loop.test.js loop-painters.test.js` -> exit=0, 185 pass 0 fail; `scripts/gate.sh make check` exit=0. In every run (3 delays, lowered, raised, raised past tau; 16 and 32 ms paints): never_moves_past_the_target_from_at_or_behind_it, never_moves_backward, never_moves_past_the_newest_queued_end; restarts only where a break arrived (seek/rejoin tests).
reason: Owner decision 2026-11-08: superseded by the D-01 revision; AC2 and AC4 are now held by items 6 and 7 in the current wording, and AC1 was removed from CONTEXT.md.

### 5. Meters move smoothly and in time at the hand-back URL
expected: With music playing, the owner sees the meters, the spectrum and the spectrogram move smoothly and in time with the music at the hand-back URL (human-verify: hand-back URL, live playback).
criterion: AC5
status: pass
first_pass: fail
source: model
evidence: Owner ruling 2026-11-07 on this item: 'in time with the music' is the user's burden through the time alignment feature; smooth playback is tested automatically. `HQPTUNER_CHROMIUM=/usr/lib64/chromium-browser/headless_shell scripts/gate.sh .venv/bin/pytest -m e2e --no-cov -q tests/e2e/test_spectrogram_scrolls_smoothly_through_bursty_feeds.py tests/e2e/test_playing_readings_keep_flowing.py tests/e2e/test_spectrogram_header_no_scroll_bar_at_quarter_span.py tests/e2e/test_stop_and_restart.py` at 645320e9 -> exit=0, `13 passed in 68.64s` (painted spectrogram in headless chromium, replayed real capture plus generated bursty feeds: never stands still, never steps more than one column, no paint scrolls past its wall time; red against both earlier playheads in plan 3 task 4: `192 <= 25.0` at 6438e843). Meters and spectrum: `scripts/gate.sh make check` -> exit=0, `# pass 5346 # fail 0`, including tests/js/contracts/ (Safari paint capture, long paint stall, slow-paint runs, spectrum-motion, render-cost) and tests/js/store/meter/loop-painters.test.js.
cause: No automated check exists: smoothness and sync with live music are judged by eye at the hand-back URL during live playback. The browser meter tests do not play music or judge motion. Owner chose 'Smooth, in time' at the Task 5 hand-back (SUMMARY.md), but under the testing policy a person does not certify a required item.
fix: plan 3 (899128d2, 3df4d8cf, 12b42740, c395ce9f, 8fc34281), retest
reason: Owner ruling 2026-11-07: 'in time with the music' is the user's burden through the time alignment feature; smooth spectrum playback must be tested automatically (painted output in a real browser, replayed real capture, owner-set limits, red against the pre-phase-5 playhead).

### 6. A delay change mid-feed jumps the playhead by the change, then wall speed
expected: When the delay changes mid-feed, the playhead jumps by the change at once (back for a raised delay, forward for a lowered one), without waiting for a break, then moves at wall speed.
criterion: AC2
status: pass
first_pass: pass
source: model
evidence: `scripts/gate.sh make check` at 645320e9 -> exit=0, JS `# tests 5346 # pass 5346 # fail 0`, pytest `3655 passed`. tests/js/model/gauges/playhead.test.js: test_at_the_first_paint_at_a_lowered_delay_the_playhead_jumps_forward_by_the_drop_or_stands_at_the_newest_end and test_at_the_first_paint_at_a_raised_delay_the_playhead_jumps_back_by_the_raise (each asserts some such moves exist and every after == before + dt + jump, capped at the newest end for a drop); test_in_<run>_the_playhead_never_moves_other_than_its_wall_time_at_an_unchanged_delay_short_of_the_newest_end over every run, including a_long_delay_raised_mid_feed; test_in_<run>_no_paint_after_the_first_restarts (the jump does not wait for a break).

### 7. Playhead never passes the newest queued end, backward only at a break or raised delay
expected: The playhead never passes the newest queued frame's end, and never moves backward except at a break or a raised delay.
criterion: AC4
status: pass
first_pass: pass
source: model
evidence: `scripts/gate.sh make check` at 645320e9 -> exit=0, JS `# pass 5346 # fail 0`. tests/js/model/gauges/playhead.test.js BREACHES swept over every run (three delays, lowered, raised, long delay raised, Safari capture at its own paints, dev capture at 60 Hz, 16 and 32 ms paints): never_moves_past_the_newest_queued_end, never_moves_other_than_its_wall_time_at_an_unchanged_delay_short_of_the_newest_end and never_jumps_further_than_its_wall_time_at_an_unchanged_delay (so at an unchanged delay a move is +dt or a stand at the newest end, never backward); backward moves only at a raised delay (jumps_back_by_the_raise) or a break (test_at_a_seek_to_*_the_paints_restart_exactly_where_a_break_arrived, no_paint_after_the_first_restarts).

## Summary

total: 7
passed: 4
failed: 0
pending: 0
skipped: 3
blocked: 0
reworked: 1
