PLAN PARTIAL

Plan: .planning/phases/5/PLAN-2.md

Tasks: 2 of 7

| Task | Commit | Note |
|---|---|---|
| 1 - bursty capture | 7593f50f | Probe `scripts/probes/capture_meter_feed.py` and fixture `tests/support/fixtures/meter_feed_capture.json` committed. Ran once, 6 s, owner offset 0.747 s, engine `output_delay` '500682' us. 282 events, first `geometry`, 281 `frame`, 14 gaps over 100 ms, longest 211.9 ms. Effective delay 500.682 + 747 = 1247.682 ms. Probe ran foreground, exited rc=0, `ps` shows no capture process. Prettier reformatted the fixture JSON at pre-commit (content unchanged, re-read and rechecked after). |
| 2 - owner limits | none (owner decision) | Recorded below, verbatim. |

## Task 2: owner answers (verbatim)

Owner answer 1: "Uhhh well I'm a human being not a robot so I'm not sure how you expect me to answer those questions lol. In either case, the answer is "it doesn't stutter, it's smooth". that isn't a "how much stutter can we have"? it's a "how do we eliminate the possibility of stutter"?"

Owner answer 2: "...what??? the fucking delay should be goddamn irrelevant because we're usign teh output delay as a buffer right??"

### Orchestrator's reading (not the owner's words)

The orchestrator stated this reading of those answers to the owner; the owner did not object to the limits, only to treating the delay as relevant:

- Stand-still limit: 0 wall ms. While music plays through the replayed capture, the spectrogram's scroll never stands still between paints.
- Jump limit: no paint moves the scroll further than the wall time elapsed since the previous paint, rounded up to the next whole column (one column = 25 ms at the 30 s window); i.e. at most one column of quantization slack over wall speed.
- The spectrogram's scroll stands for "smooth spectrum playback".
- The delay is the buffer: the test asserts smoothness at the captured effective delay (1247.682 ms), and the limits hold whatever the delay, so long as the buffer exceeds the longest arrival gap. No limit depends on the delay value.

Deviations: none

Open items:

- Effective delay is nonzero (1247.682 ms) so Task 1's stop-and-ask does not fire. Longest gap 211.9 ms is below the delay, so by D-01 every captured gap runs at wall speed throughout and none reaches the newest frame's end.
- Fixture is 6 s (14 gaps over 100 ms, the plan needs 5); about 1.6 MB before prettier. A 2 s prefix would still hold 5 gaps. Left at full capture, not trimmed.
- Skills `live-daemon` and `opal-hqptuner` not loaded (no Skill tool); the probe is GET-only against the dev container.
- Tasks 3 to 7 not started yet; work order kept (10.1).
- Prior report rotated to `plan-2.1.md` (continuation dispatch).
