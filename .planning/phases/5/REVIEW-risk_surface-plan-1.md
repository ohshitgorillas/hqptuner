{
  "findings": [
    {
      "file": "hqptuner/engine/junkadvisor.py",
      "line": 143,
      "severity": "low",
      "claim": "The `# noqa: PLR0913` directives on `classify` and `verdicts` were removed. The 'Owner-approved for this site' comments that justified them were kept, at lines 143-144 and the matching comment above `verdicts`. They now justify an exemption that no longer exists.",
      "failure_scenario": "A reader or the triviajudge comment screen meets 'Owner-approved for this site: the junk run is a sixth argument...' above a plain `def classify(` with no noqa. The comment states a gate exemption that is absent, so it is now stale decision archaeology."
    }
  ]
}