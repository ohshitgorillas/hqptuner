{
  "findings": [
    {
      "file": "hqptuner/core/loader.py",
      "line": 228,
      "severity": "low",
      "claim": "_report_drops trusts mgr.phase.outcome(), but `ended` stays FOREIGN_DEPARTURE across later downs HQPTuner causes itself when the generation does not move. The diff clears the held reading only on retarget (manager.py:163), not on the loop-fault close in _closed_on_fault (loader.py:363-369, SOCKET_CLOSED, which is _taken with no generation bump).",
      "failure_scenario": "The daemon restarts on its own once, so ended=FOREIGN_DEPARTURE, and the report is made and the held reading consumed. Later loader.run raises (wire fault or a bug of ours), and _closed_on_fault calls break_engine, which holds the current reading. During the supervisor's reconnect_delay another client (HQPlayer Desktop, Roon) changes filter_junk. The next dial succeeds with no refusal, so the generation stays put and ended is still FOREIGN_DEPARTURE. _report_drops then records the old filter as dropped, although no departure happened. That breaks api.md: 'lists the live settings the Engine ran before a departure no request of HQPTuner's explains'. The test suite's retarget case (test_only_a_restart_lists_what_the_engine_read_before_it_is_gone) covers this stale-outcome hazard for retarget only."
    },
    {
      "file": "hqptuner/core/loader.py",
      "line": 240,
      "severity": "low",
      "claim": "The drop report runs only on _fill's success path. A CommandError from any fill read (get_license, get_status, get_all_enumerations, get_volume_range, get_active_config) is caught in _stand with the connection kept, and _report_drops never runs. The held reading then waits until the next break_engine overwrites it, so that departure's drops are lost for good.",
      "failure_scenario": "A foreign restart drops filter_junk=1. On the first connection after it, GetVolumeRange (or any other unsuppressed fill command) answers Error. _stand logs 'reading command answered Error, connection kept' and the heartbeats keep reading the Engine on that connection, but none of them calls _report_drops. dropped_settings stays [] although the Engine no longer runs filter_junk=1. The next break_engine replaces `held` with a newer snapshot, so the entry can never surface. That breaks api.md: 'The server compares the last Engine reading before the departure with the first one after it'."
    }
  ]
}