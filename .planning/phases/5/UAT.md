---
status: testing
phase: 5
fields_version: 1
started: 2026-11-08
updated: 2026-11-08
---

## Items

### 1. Playhead closes lag after a long burst gap
expected: After a burst gap longer than the queued slack, the playhead returns to the target with no jump and no step backward; a model-lane test shows the lag goes to zero.
criterion: AC1
status: pass
first_pass: pass
source: model
evidence: `scripts/gate.sh node --test playhead.test.js loop.test.js loop-painters.test.js` -> exit=0, 185 pass 0 fail; `scripts/gate.sh make check` exit=0. test_the_playhead_at_a_0_ms_delay_stands_that_far_behind_the_newest_frames_end (every 128 ms gap exceeds the zero slack; final playhead == EDGE, lag 0) plus the never_moves_backward and never_jumps_further_than_its_speed_allows invariants over every run.

### 2. Lowered delay reached without a break
expected: After the delay is lowered mid-feed, the playhead reaches the new target without a jump and without waiting for a break.
criterion: AC2
status: pass
first_pass: pass
source: model
evidence: `scripts/gate.sh node --test playhead.test.js loop.test.js loop-painters.test.js` -> exit=0, 185 pass 0 fail; `scripts/gate.sh make check` exit=0. test_a_delay_lowered_mid_feed_leaves_the_playhead_at_the_new_target_once_the_feed_has_gone_on (playhead == EDGE), and in a_delay_lowered_mid_feed runs at 16 and 32 ms: never_moves_backward, never_jumps_further_than_its_speed_allows, no_paint_after_the_first_restarts.

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
status: pass
first_pass: pass
source: model
evidence: `scripts/gate.sh node --test playhead.test.js loop.test.js loop-painters.test.js` -> exit=0, 185 pass 0 fail; `scripts/gate.sh make check` exit=0. In every run (3 delays, lowered, raised, raised past tau; 16 and 32 ms paints): never_moves_past_the_target_from_at_or_behind_it, never_moves_backward, never_moves_past_the_newest_queued_end; restarts only where a break arrived (seek/rejoin tests).

### 5. Meters move smoothly and in time at the hand-back URL
expected: With music playing, the owner sees the meters, the spectrum and the spectrogram move smoothly and in time with the music at the hand-back URL (human-verify: hand-back URL, live playback).
criterion: AC5
status: fail
first_pass: fail
source: model
cause: No automated check exists: smoothness and sync with live music are judged by eye at the hand-back URL during live playback. The browser meter tests do not play music or judge motion. Owner chose 'Smooth, in time' at the Task 5 hand-back (SUMMARY.md), but under the testing policy a person does not certify a required item.
fix: routed to /cad-plan
reason: Owner ruling 2026-11-07: 'in time with the music' is the user's burden through the time alignment feature; smooth spectrum playback must be tested automatically (painted output in a real browser, replayed real capture, owner-set limits, red against the pre-phase-5 playhead).

## Summary

total: 5
passed: 4
failed: 1
pending: 0
skipped: 0
blocked: 0
reworked: 1
