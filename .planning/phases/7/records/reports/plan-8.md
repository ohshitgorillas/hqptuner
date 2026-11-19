PLAN COMPLETE

Plan: /home/atom/dev/hqptuner2/.planning/phases/7/PLAN-8.md

Tasks: 4 of 4

| Task | Commit | Note |
|---|---|---|
| 1 - The junk-burst feature helpers live once | b715dc29 | Earlier executor's staged work applied from the worktree patch; jscpd: all Task 1 pairs gone, only jbcurves~blockstats (kept, Engine port) left; make lint pass, tests/test_jbderived.py 3 passed; 13 report files byte-identical via /tmp/cad-lYHDYC/h harness (synthetic corpus, /srv corpus absent). |
| 2 - One burst loader and one scorer serve the junk-burst views | 72d23a04 | `jbderived.read_burst`, `jbcurves.per_hz_level`; junkburst_print calls `jbcandidates.fold_step`. jscpd: no Task 2 pair left (jbcandidates~blockstats stays, Engine port); make lint pass; 3 passed; 13 files byte-identical. |
| 3 - The two corpus runners share their tallies and report | c67d62f1 | `jbframeonlyscore.graded_steady/score_each/blocks_by_burst/tally_verdict/graded_report_lines`, `jbpolicy.burst_engages`, `jbderived.write_lines`, `jbrunning._split_outcomes`. jscpd: no scripts/junkburst clone left but the blockstats mirror; make lint pass; 13 files byte-identical. |
| 4 - The junkcal evaluators share their fill reading | d22f5c80 | `junkcal_seq.full_curve` is `junkcal_eval.full_curve`; jscpd: junkcal_eval~junkcal_seq gone; only junkburst_blocks~junkburst_print (sys.path entry point) and the blockstats mirror remain; make lint pass; tests/core/test_junkcal.py 2 passed (same as before). |

Deviations: none

Open items:

- Full suite (`scripts/gate.sh make -k check`, log /tmp/gate-make-UfvsSACc.log): pytest 3676 passed; test-js red on exactly the 12 baseline tests in `playhead-lag.test.js`, `playhead-motion.test.js` and `playhead-scroll.test.js`, which phase 8 rewrites; no other failure.
- Corpus absent at `/srv/hqptuner/state/junkburst/`; byte-identity uses the synthetic harness `/tmp/cad-lYHDYC/h/compare.sh <tag>`.
- `jbpolicyyield._yield_veto_forces_real` repeats `veto_forces_real`; outside the lease.
- `junkcal_why.py` (outside the lease) calls `seq.full_curve`; `junkcal_seq.py` keeps the alias `full_curve = junkcal_eval.full_curve` for it. Importing from `junkcal_eval` in `junkcal_why.py` would let the alias go.
- Shared graded-run helpers went into `jbframeonlyscore.py`, not `jbpolicy.py`, so `jbpolicy.py` stays under the filepawl watch line (400) with no `.filepawl.toml` entry, which is outside the lease.
- Previous run's report rotated to `plan-8.1.md`.
