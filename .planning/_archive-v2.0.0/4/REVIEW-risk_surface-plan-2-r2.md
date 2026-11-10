{
  "findings": [
    {
      "file": "hqptuner/core/loader.py",
      "line": 226,
      "severity": "low",
      "claim": "Round-1 finding 2 is only partly closed. When _fill raises CommandError, the drop report moves to the first heartbeat. In [source] mode that heartbeat carries State but no enumerations. _report_drops accepts it because it checks only `after.state`. It consumes the held reading, so every enumerated field's drop is lost for good.",
      "failure_scenario": "A foreign restart drops filter (an enumerated field) on an engine in mode \"0\". On the first connection after it, GetAllEnumerations or GetVolumeRange answers Error, so _fill stops before _take, while connect() still sets cadence.polled_at=now. The next _beat sees poll_due false and mode_moved(None, \"0\") false (SOURCE_MODE), so it reads only _fast. _take stores State with enums=None. _report_drops calls take_held() and dropped.report(held, after). In report, EngineView._value_at/_item_at return None with no enums, so filter is missing from `now` and is skipped. dropped_settings omits the filter drop, and the held reading is gone, so no later reading can report it. Only unenumerated flags such as filter_junk survive. This breaks settings-truth.md rule 77 / api.md: 'compares the last Engine reading before the departure with the first one after it'."
    },
    {
      "file": "hqptuner/core/readings.py",
      "line": 238,
      "severity": "low",
      "claim": "break_engine now keeps an older held reading whenever the new snapshot has no State. _report_drops then compares that held reading with the first State-bearing reading, however many outcomes come in between. So an HQPTuner-requested restart that falls in that window folds its own changes into the foreign departure's drop report.",
      "failure_scenario": "Engine reads filter A at generation 0 and is held as H. A foreign restart moves it to generation 1, so foreign_generation=1. On the new connection State is refused (state_unless_refused returns None), so _report_drops returns early and H stays held. The user then applies filter B through a restart HQPTuner requests: stamp at generation 1, socket taken (break_engine keeps H because snapshot.state is None), dial refused, generation 2, LANDED, and foreign_generation stays 1. State answers on the generation-2 connection. The check H.stamp.generation(0) < foreign_generation(1) passes, and dropped_settings records filter A as dropped. That entry actually comes from the user's own apply of B, against api.md 'A restart HQPTuner requested lists nothing' and settings-truth.md rule 77 ('computed once, at the first verified reading after an outcome'). Before this diff, break_engine overwrote held on every break, so this hazard is new."
    }
  ]
}