{ "findings": [
  { "file": ".planning/phases/5/PLAN.md",
    "line": 118,
    "severity": "medium",
    "claim": "The planned rule, playhead = min(last + dt, bound) with no catch-up, starting at the bound on every restart, ratchets lag permanently and so fails the goal's 'in step with the music'. The plan names the risk in Notes but routes no owner decision before the build, and no task measures the lag.",
    "failure_scenario": "Restart paint sets playhead = newest end - delay, so slack is 0. A burst gap of up to 262 ms (timing.md 'Feed arrival' row) pins it, which is a freeze at the first gap after every seek. From then on the meters run up to 262 ms behind the configured delay until the next break. A single later stall, a lowered offset, or wall-clock drift against the DAC (rAF dt summed over a long track) only raises that lag, never lowers it. Task 5's human-verify ('in step with the music', 'no freeze') can then fail, or pass while the views are visibly late, and the plan has no remedy short of a new owner decision."
  },
  { "file": ".planning/phases/5/PLAN.md",
    "line": 75,
    "severity": "medium",
    "claim": "Criterion 1 ('the same distance over the same stretch of wall time whatever the paint rate' while frames arrive in bursts) is not met by the planned rule whenever the bound holds the playhead, which is exactly the bursty regime. The testing scope tests it only 'wherever the bound does not hold the playhead back', so a 'done' truth is carved out instead of made true or put to the owner.",
    "failure_scenario": "Playhead pinned at bound B0 after a restart, and the next burst raises the bound by 100 ms at wall t=100. At 60 Hz (paints at 83.5, 100.2) the playhead reaches B0+16.7. At 30 Hz (paints at 66.7, 100) it reaches B0+33.3. With no catch-up, that 16.6 ms difference persists until the next break. The two paint rates show different distances over the same wall time, and the planned model-lane test never sees it."
  },
  { "file": ".planning/phases/5/PLAN.md",
    "line": 81,
    "severity": "low",
    "claim": "Task 2's bite-proof verify demands red against HEAD code on 'every new or restated case'. But the cases whose setups are only repaired (loop.test.js closing/reopen/stop cases, the two loop-painters cases) keep claims the old code already satisfies, so they will be green on HEAD and the verify step as written cannot pass.",
    "failure_scenario": "Pacer repairs test_closing_the_feed_leaves_the_playhead_null by dropping its feedEdge()-less-delay pin and reverts playhead.js/loop.js to HEAD. The case stays green, because the old code still nulls the playhead on close, so the recorded rule-8 check reports a non-biting case. That pushes the pacer either to report a false failure or to strengthen the repaired setup into a new claim."
  }
] }
