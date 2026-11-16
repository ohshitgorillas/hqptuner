{ "findings": [
    { "file": "scripts/gates/check_supply_chain.py",
      "line": 336,
      "severity": "low",
      "claim": "permission_failures only recognizes the literal block spelling `packages: write`, so the gate misses workflow-level or job-level grants that also give packages: write, like `permissions: write-all` or a quoted `packages: \"write\"`.",
      "failure_scenario": "I took HEAD docker.yml and replaced its top-level `permissions:\\n  contents: read` with `permissions: write-all`. Then I added `packages: \"write\"` under the top-level permissions. In both cases permission_failures('docker.yml', ...) returned [] (checked by running it). The token gets packages: write in every job, including the reusable check job, which installs an unpinned triviajudge. The gate that exists to confine that grant to build-push passes anyway." }
  ] }
