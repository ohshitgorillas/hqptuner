{
  "findings": [
    {
      "file": "tests/js/components/faceplate-alerts/plate-unread.test.js",
      "line": 60,
      "severity": "low",
      "claim": "The diff removed the `dropped_settings` key from the shared HEALTHY fixtures, but the doc comments over them still describe a health reading 'which lists no dropped setting'. The same stale wording is at plate-unread.test.js:10, plate-unread-saves.test.js:52, alerts-unread.test.js:51 and alerts-unread-saves.test.js:32. PLAN.md Task 1 orders comments that name the excised feature rewritten or cut.",
      "failure_scenario": "Run `grep -rn -i 'dropped setting' tests` after 85fd14fb: it prints these 5 comment lines. They describe a health field that no longer exists. The plan's verify grep misses them because it matches only `dropped_settings`/`dropped-settings`, not the phrase 'dropped setting'."
    }
  ]
}