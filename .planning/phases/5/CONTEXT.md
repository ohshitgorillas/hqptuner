# Phase 5: Meter playhead on the loop's dt - Context

Gathered: 2026-11-07

Feeds: /cad-plan 5

## Scope boundary

In: the meters, the spectrum and the spectrogram move as smoothly, as accurately and as in time with the music, less the delay, as the frames that reach the metering reader allow, while those frames arrive in bursts. The stamps stay the only authority for where the music is.

Out: probing or blaming the daemon or the network; any change to how frames are read or relayed server-side.

Deferred: None

Plan shape: one plan

## Durable decisions

- D-01 (Playhead law, owner rulings 2026-11-07, revised 2026-11-07 on evidence): the owner's words: "I don't care how you do it (other than not taking shortcuts and doing things properly), I want the spectrum to move as smoothly and accurately and as in time with the music (pending the delay) as it can be." The rule, owner-approved: "The playhead moves at wall speed. When the delay changes, it jumps by the change: back for a raised delay, forward for a lowered one. It never passes the newest queued frame's end, and if it reaches it, it stands there until the next arrival. At a break it restarts one delay behind the newest frame's end." The delay's worth of queued, unshown music is the buffer that carries the playhead through a burst gap; no other buffer, margin, window or tuning constant is added. Arrivals do not steer the playhead: a burst landing early or late changes nothing about its speed. Drift and stall handling are added only if a measurement shows them needed. This ruling supersedes the ROADMAP Approach line's cap and success criterion 2's "never passes the newest queued frame's end less the delay": the cap is the newest queued frame's end. `dt` remains the input the loop hands `pacePaint`, `pacePaint` stays pure, and no other code reads time. Evidence: on `tests/support/fixtures/meter_feed_capture.json` at its 1247.682 ms delay and 60 Hz paints, wall speed capped at the newest end moves at exactly 1.000 of wall speed on all 363 paints and never reaches the cap; steering toward the newest end less the delay with `CATCH_UP_MS` 500 swings between 0.72 and 1.21.

## Decisions

- D-02 (Success criterion 1): criterion 1 is met in the bursty regime, not only where the target does not hold the playhead back. Where exact independence from the paint rate cannot hold, for example when the queue runs empty and the playhead stands at the newest frame's end, the difference between two paint rates goes away by the next caught-up paint, and the plan says how large it can be before that. The model-lane test checks that convergence; it does not exclude the case. Evidence: `REVIEW-plan.md` finding 2.
- D-03 (Delay grows mid-feed): the playhead jumps back by the growth, then moves at wall speed. Evidence: owner ruling 2026-11-07, a delay change is the one exception to smooth, in-time motion.
- D-04 (Restart): at a break, the playhead restarts one delay behind the newest frame's end. Every view of playback starts again, as today. Evidence: owner ruling 2026-11-07.
- D-05 (Bite proof): the "red against HEAD" check in Task 2 covers new or changed claims only. A case whose claim is unchanged and whose setup is only repaired is listed as repaired, with the reason, and is not required to go red. Evidence: `REVIEW-plan.md` finding 3; `docs/spec/testing.md` rule 8.
- D-06 (Spec wording): the `docs/spec/timing.md` rewording in Task 1 permits the jump on a delay change as well as the advance on `dt`, and states it as rule text, not history.

## Acceptance criteria

- [ ] AC2: when the delay changes mid-feed, the playhead jumps by the change at once, without waiting for a break, then moves at wall speed.
- [ ] AC3: two paint rates fed the same arrival schedule converge to the same playhead by the next caught-up paint.
- [ ] AC4: the playhead never passes the newest queued frame's end, and never moves backward except at a break or a raised delay.
- [ ] AC5: with music playing, the owner sees the meters, the spectrum and the spectrogram move smoothly and in time with the music at the hand-back URL (human-verify: hand-back URL, live playback).
