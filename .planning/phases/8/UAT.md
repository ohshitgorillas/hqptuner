---
status: testing
phase: 8
fields_version: 1
started: 2026-11-24
updated: 2026-11-24
---

## Items

### 1. Live capture off port 4322 is saved with its report
expected: A read-only capture that starts before a track starts and covers a same-rate track change and a rate change at two sample rates is saved under `tests/support/fixtures/`, holding per-frame arrival times, stamps, geometry events and sampled Status position, track serial and `output_delay`; its report states whether the stamps run ahead of wall time after a start, for how long at each rate, and whether each kind of track change restarts the stream (human-verify: needs owner starting tracks on live hqplayerd)
criterion: AC1
status: pass
first_pass: pass
source: verifier
evidence: tests/support/fixtures/meter_start_capture.json holds frames with t_ms, status samples with track_serial, position and output_delay, and geometry/frame events; .planning/phases/8/CAPTURE.md:69-81 says per kind of change whether the stream restarts, :118-121 gives the rush size and length at 44100 and 96000, :278 confirms the rush at a rate change.

### 2. Timing spec states the owner-approved rule for the lag after a start
expected: `docs/spec/timing.md` states the owner-approved rule for how the lag is set after a start. CONTEXT marks this criterion superseded by D-08 (owner decision 2026-11-14: AC2's decision step is dropped)
criterion: AC2
status: pass
first_pass: pass
source: verifier
evidence: docs/spec/timing.md:27-31 and :41, landed by 4cbb8b56 (owner-approved spec text); implemented at hqptuner/static/model/gauges/playhead.js:118-126,199-234.

### 3. Smoothness tests were red against the code before the fix
expected: The playhead table tests for steady lag, steady motion and steady scroll (`tests/js/model/gauges/playhead-lag.test.js`, `playhead-motion.test.js`, `playhead-scroll.test.js`, `playhead-line.test.js`) fail against the tree before the fix commit `82453398`
criterion: AC8
status: pass
first_pass: pass
source: verifier
evidence: Four table files against playhead.js from a9e8374d: exit=1 log=/tmp/gate-node-aMd8nyBe.log, 41 tests, 29 pass, 12 fail by AssertionError (8 lag, 3 motion, 1 scroll; playhead-line green since its functions predate the fix).

### 4. Smoothness tests pass unedited after the fix
expected: At HEAD the four playhead table files pass with zero failures, and `git diff 63af5055 HEAD` over those four files prints nothing
criterion: AC9
status: pass
first_pass: pass
source: verifier
evidence: git diff --quiet 63af5055 HEAD over the four files rc=0; /tmp/gate-make-3uBIqmij.log `# pass 5515 / # fail 0`.

### 5. Lag after a start equals the lag later in the track
expected: A test asserts that on the paints after a start the playhead stands exactly one delay behind the line the stamps set, the same place it stands later in the track (exact equality per D-14), and it passes
criterion: AC3
status: pass
first_pass: pass
source: verifier
evidence: playhead-lag.test.js start, opening and later-track cases assert exact playheads with assert.equal; pass in /tmp/gate-make-3uBIqmij.log (ok 2208-2221).

### 6. Lag is the same at every sample rate
expected: A test asserts that inputs identical but for the source rate give identical playheads (exact equality per D-12 (1) and D-14), and it passes
criterion: AC4
status: pass
first_pass: pass
source: verifier
evidence: feed.test.js:341-355 holds 44100 and 48000 feeds of the same music to one SAME_MUSIC_READ table (ok 4969-4971); pacePaint takes no rate input (playhead.js:38-55); samplesToMs gives identical ms at both rates.

### 7. Lag does not depend on where the reader connected
expected: A test asserts that the playhead after a start is the same wherever the reader began counting stamps (exact equality per D-14), and it passes
criterion: AC5
status: pass
first_pass: pass
source: verifier
evidence: playhead-lag.test.js:87-97 and :215-230, reader origin 200 s and 3000 s before, exact playheads; pass (ok 2211, ok 2212).

### 8. On the dev build the visuals hold the same lag after a start at two rates
expected: At the hand-back URL, with tracks at two sample rates, the visuals hold the same lag behind the sound right after a track starts as later in the track (human-verify: needs owner's eyes and ears)
criterion: AC6
status: skipped
first_pass: pass
source: model
evidence: Owner verbatim in .planning/phases/8/records/reports/plan-2.md:11: "yes, 48k and 192k both work at the same delay, pass.", answering the check posed in plan-2.2.md (start from stopped, same-rate change, rate change; right after start against later; across rates).
reported: Make it optional
severity: minor
cause: No automated check exists: AC6 asks whether the visuals hold the same lag behind the sound on the dev build, and no check hears the sound or paints the hand-back URL against it. Under the testing policy a person's verdict does not certify a required item. On record, not counted as the pass: the owner's words in .planning/phases/8/records/reports/plan-2.md:11, "yes, 48k and 192k both work at the same delay, pass." The model-level halves are held by automated checks: items 5, 6 and 7 (playhead-lag.test.js exact cases, feed.test.js same-music cases at 44100 and 48000).
reason: Owner decision 2026-11-24 at /cad-verify 8: item made optional. No automated check can hear the sound; the owner's verdict on the rebuilt dev build is on record in .planning/phases/8/records/reports/plan-2.md:11: "yes, 48k and 192k both work at the same delay, pass."

### 9. `scripts/gate.sh make check` is green
expected: `scripts/gate.sh make check` prints `exit=0`
criterion: AC7
status: pass
first_pass: pass
source: verifier
evidence: exit=0 log=/tmp/gate-make-3uBIqmij.log at HEAD 870a9a99.

## Summary

total: 9
passed: 8
failed: 0
pending: 0
skipped: 1
blocked: 0
reworked: 0
