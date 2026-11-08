# Phase 5: Meter playhead on the loop's dt - Context

Gathered: 2026-11-07

Feeds: /cad-plan 5

## Scope boundary

In: the meters, the spectrum and the spectrogram move as smoothly, as accurately and as in time with the music, less the delay, as the frames that reach the metering reader allow, while those frames arrive in bursts. The stamps stay the only authority for where the music is.

Out: probing or blaming the daemon or the network; any change to how frames are read or relayed server-side.

Deferred: None

Plan shape: one plan

## Durable decisions

- D-01 (Playhead target and cap, owner rulings 2026-11-07 and 2026-11-08): the owner's words: "I don't care how you do it (other than not taking shortcuts and doing things properly), I want the spectrum to move as smoothly and accurately and as in time with the music (pending the delay) as it can be." The delay's worth of queued, unshown music is the buffer that carries the playhead through a burst gap; no other buffer or margin is added. The playhead's target is the newest queued frame's end less the delay, and the stamps steer the playhead toward it. The playhead's only cap is the newest queued frame's end: between arrivals it keeps moving on `dt` through the queued music, never stands still while unshown music is queued, and stops only when it reaches the newest frame's end, because past that there is no data and the spectrum shows none it does not have. It never jumps and never moves backward except at a break. Through a gap the playhead moves at wall speed: the target stands still in a gap only because nothing has arrived, not because the music has stopped, so a playhead past a target that a gap froze is not ahead of the music and is not slowed for it. The stamps steer the playhead on what they show once frames land: behind the target after an arrival, it closes the lag smoothly, faster than wall time; ahead of it after an arrival, or after a delay raised mid-feed (D-03), it slows smoothly below wall speed, never moving backward. Short of those it never slows: where the queued music runs out before the next arrival, it moves at wall speed up to the newest frame's end and stands there until the next arrival, with no early slowdown. The method is the planner's to choose and to justify. This ruling supersedes the ROADMAP Approach line's cap and success criterion 2's "never passes the newest queued frame's end less the delay": the cap is the newest queued frame's end. `dt` remains the input the loop hands `pacePaint`, `pacePaint` stays pure, and no other code reads time. Evidence: `.planning/phases/5/REVIEW-plan-2.md` finding 1; `hqptuner/static/model/gauges/playhead.js` `approach`, which stops at the target from at or behind it.

## Decisions

- D-02 (Success criterion 1): criterion 1 is met in the bursty regime, not only where the target does not hold the playhead back. Where exact independence from the paint rate cannot hold, for example when the queue runs empty and the playhead stands at the newest frame's end, the difference between two paint rates goes away by the next caught-up paint, and the plan says how large it can be before that. The model-lane test checks that convergence; it does not exclude the case. Evidence: `REVIEW-plan.md` finding 2.
- D-03 (Delay grows mid-feed): the playhead does not jump back. It slows smoothly until the target catches up with it, then follows the target again. Evidence: PLAN.md Notes, criterion 2 interpretation.
- D-04 (Restart): at a break, the playhead starts at whichever position keeps the views closest to the music less the delay, which is the target, as in the current plan. Every view of playback starts again, as today. Evidence: PLAN.md Notes, criterion 3 interpretation.
- D-05 (Bite proof): the "red against HEAD" check in Task 2 covers new or changed claims only. A case whose claim is unchanged and whose setup is only repaired is listed as repaired, with the reason, and is not required to go red. Evidence: `REVIEW-plan.md` finding 3; `docs/spec/testing.md` rule 8.
- D-06 (Spec wording): the `docs/spec/timing.md` rewording in Task 1 permits the catch-up rule as well as the advance on `dt`, and states it as rule text, not history.

## Acceptance criteria

- [ ] AC1: after a burst gap longer than the queued slack, the playhead returns to the target with no jump and no step backward. A model-lane test shows the lag goes to zero.
- [ ] AC2: after the delay is lowered mid-feed, the playhead reaches the new target without a jump and without waiting for a break.
- [ ] AC3: two paint rates fed the same arrival schedule converge to the same playhead by the next caught-up paint.
- [ ] AC4: the playhead never passes the target, and never moves backward except at a break.
- [ ] AC5: with music playing, the owner sees the meters, the spectrum and the spectrogram move smoothly and in time with the music at the hand-back URL (human-verify: hand-back URL, live playback).

## Flagged assumptions

- The catch-up speed and its shape are the planner's to choose, smooth enough that no paint shows a visible jump - medium confidence; if wrong: the owner's hand-back in Task 5 shows the catch-up as a lurch, and the speed needs retuning.
