PLAN CHECKPOINT: decision

- Plan: .planning/phases/7/PLAN-16.md
- Tasks: 0 of 1

| Task | Commit | Note |
|---|---|---|
| 1 - The jscpd threshold is what the repository measures | none | stopped before any change; `.jscpd.json` untouched |

- Deviations: none
- Open items:
- Measured (`scripts/gate.sh npx jscpd`, log /tmp/gate-npx-5aAK6T7Y.log, all formats): 34 clones (<= 43). css 0 clones; javascript 11 clones, 116 lines (0.10%), 605 tokens (0.11%); python 23 clones, 293 lines (0.34%), 1623 tokens (0.27%); total 409 lines of 202873 (0.2016%, printed 0.20%), 2228 tokens (0.17%).
- The figure `threshold` is compared against is the LINES percentage, not tokens (the brief's token reading does not hold on this tree). Probes with CLI `--threshold` (no file change): combined passes at 0.21, fails at 0.20 and 0.19; python alone fails at 0.30 and 0.20 (0.34% lines).
- Clone #19 is of no justified kind: tests/fields/test_field_at_location.py 9-20 and tests/fields/test_field_kept_at_codec.py 9-20, the 7-row `CODEC_HOLDS` table repeated verbatim.
- Borderline (import-led, with a fixture constant in the tail): #25 tests/js/components/faceplate-settings/hardware-stale.test.js 36-46 vs tests/js/store/faceplate-settings/hardware.test.js 28-40 (imports plus `const ENGINE`); #16 tests/apply/test_pipeline_apply.py 15-21 vs tests/matrix/test_matrix_profiles.py 22-28 (imports plus `ROW0`); #17 tests/core/test_lifecycle_retarget.py 8-20 vs test_lifecycle_transitions.py 6-18 (imports plus `NOW`); #20 tests/gates/test_check_field_structure_enumerations.py 13-24 vs test_check_lifecycle_names.py 14-25 (imports plus `GATE_PATH`).
- The other 29 are justified kinds: blockstats mirror (#1, #2), dataclass/TypedDict field lists (#3, #4, #5), script sys.path bootstrap and main() entry (#6-#14), import lists and module docstrings in test files (rest).
