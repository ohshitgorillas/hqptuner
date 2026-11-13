{ "findings": [
  { "file": ".planning/phases/5/PLAN-2.md",
    "line": 47,
    "severity": "high",
    "claim": "Task 2 tells the owner that the playhead catches up after a gap, which bears on the jump limit. It never says that the locked design (D-01, D-02) parks the playhead at the target for the rest of any gap longer than the catch-up time. The freeze limit as worded ('stand still while music it has not yet shown has arrived') is then likely to be one the current code fails by design, and the plan has no task that can fix it.",
    "failure_scenario": "playhead.js approach() stops at the target from behind ('Math.min(moved, lag >= 0 ? target : newest)'). After a burst of G ms, catching up takes 500*ln(1+G/500) ms, so the playhead then stands still for G minus that while the delay's worth of music sits queued and unshown. That is about 19 ms (one paint) at G=150, 32 ms at G=200 and 65 ms (four paints) at G=300. If the owner answers 'never' or 'one paint', the test is red on HEAD by design. Line 32 then routes to 'fix the code', but this plan changes no production file, and D-01/D-02 lock the stop-at-target rule, so the only real route is a second trip to the owner that Task 2 could have avoided."
  },
  { "file": ".planning/phases/5/PLAN-2.md",
    "line": 53,
    "severity": "high",
    "claim": "Task 3 leaves 'the delay the page runs at' to the test writer, and for the freeze limit that choice alone decides whether the test can pass or bite.",
    "failure_scenario": "At delay 0 the target is the newest frame's end. Neither the old playhead nor the new one ever stands still while unshown music is queued, so the freeze test is green on both and proves nothing. At any delay above 0, the new playhead stands still at the target in every gap longer than its catch-up time. So the writer chooses green or red by choosing the delay, and nothing ties that delay to the engine output_delay plus offset (store/meter/delay.js effectiveDelay) that the owner actually watches."
  },
  { "file": ".planning/phases/5/PLAN-2.md",
    "line": 47,
    "severity": "high",
    "claim": "The plan lets the owner set limits in time units (paints, playback ms, multiples of paint wall time). Task 3 allows only painted pixels or geometry as readings and forbids reading the playhead or changing the capture. Painted output does not carry playback position, and the painter's dt-driven ballistics move pixels while the playhead is frozen.",
    "failure_scenario": "sourcepaint.js paints kept.spectrum.disp and .ghost, and steps.js advances both on dt every paint: disp falls on a short time constant and ghost on GHOST_TAU_S = 1 s. When the old playhead freezes after a loud frame, the trace path keeps falling for many paints, so a pixel-diff freeze reading sees motion and the old code can pass. A 'playback ms per paint' jump limit cannot be read from the path without re-deriving fold plus ballistics plus column mapping in the test, which is a second implementation (testing.md rule 13), or without reading the playhead (rule 1, banned on line 53). The plan names neither the reading nor the view layer that tracks the playhead, so Task 3 cannot honor the units Task 2 offers."
  },
  { "file": ".planning/phases/5/PLAN-2.md",
    "line": 31,
    "severity": "low",
    "claim": "The plan says the capture 'never contacts hqplayerd'. But subscribing to /api/meter/feed wakes the dev container's metering reader, which then dials the production daemon's metering stream.",
    "failure_scenario": "engine/meterfeed.py: 'a subscriber attaching tells the reader at once, so a reader idling for want of one dials without waiting out its recheck'. If no page is open on :8090 when Task 1 runs, the probe's GET opens a metering connection to the live hqplayerd. That connection is read-only, but the plan's host-safety statement is wrong, and Task 1 does not have the executor load the host or live-daemon skill before it touches host state."
  }
] }
