{
  "findings": [
    {
      "file": "hqptuner/api/routes/config.py",
      "line": 294,
      "severity": "medium",
      "claim": "POST /api/restore, re-added in this range, reads the whole untrusted upload into memory with `await cfgfile.read()` and has no size cap. It then hands the bytes to `presetzip.take_descriptions`, which decompresses every zip member with `zin.read` and no size limit. The sibling `/api/state-import` route in the same file does bound its input, through `stateimport.read_upload(..., cfg.state_max_bytes)` (64 MiB by default).",
      "failure_scenario": "Any browser that can reach HQPTuner's port (the connection route's own docstring says this surface is reachable that way) posts a multi-GB `cfgfile`. Or it posts a small zip with a member named DESCRIPTIONS_MEMBER plus a highly compressed bomb member. The bytes are buffered in full, then every member is inflated in memory. The process fills RAM on the production host that also runs hqplayerd. The size cap never applies because this route never consults `state_max_bytes`."
    }
  ]
}