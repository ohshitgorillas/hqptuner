# eqlab v2 — staged plan and status

Working plan for the eqlab v2 expansion (targets, Pareto, refinement, chain I/O, replace_segment, confidence). Source brief: scalar objectives are the bug — both proxies tried bought their score by wrecking unconstrained regions; fixes are target-relative fitting and Pareto fronts. Update this file as stages land; delete it when the roadmap is done.

Order (user-approved): S1 → S2 → S3 → S5 → S4 → S6, adjustable between stages.

## S1 — targets, target-relative metrics, multi-spec search spaces — DONE

Landed on working tree (unshipped, no changelog entry yet):

- `target.js`: target declaration — sources `current` / `flat` / `points` / `chain` / `parametric_eq`; transforms in fixed order smooth → tilt → override (`interpolate_edges` / `smooth` / `fit_trend`) → align (`mean` default / `none` / `{at}`). Resolved once from the base chain; meta + preview echoed in output.
- Target-relative metric kinds: `rmse`, `maxdev`, `maxdev_signed`, `mean_signed`, each with `domain: "log" | "erb"`. ERB weighting up-weights treble / down-weights bass relative to log-uniform (brief had the direction backwards; verified during test adjudication).
- Shape kinds: `prominence`, `ripple`, `slope`, `note_spread`. `"metrics": "standard"` preset carries the standing 8-metric panel.
- Search spaces: `amend` / `append` each take a list of change specs, crossed independently; `select` stays a literal per spec.
- 60 tests via the blind chain (writer → adjudicate → bite → reviewer → tightenings).

## S2 — Pareto + explainability — DONE

Landed on working tree:

- `"pareto": ["minimize dev", "maximize bass"]` replaces `objective` (mutually exclusive; two or more required) — returns the non-dominated `front` (sorted by first objective) with per-entry `scores` keyed by expr, `front_size`, `returned`.
- Every survivor carries `binding` when constraints exist: the constraint closest to its bound, with slack.
- Scalar mode adds `margin` (winner vs runner-up, null when fewer than two survive) and `sensitivity`: per constraint bound, the best candidate rejected by that bound alone — relaxation needed, its score, gain over winner; entries that would not beat the winner are dropped; no `gain` field when nothing survived.
- `rejected_top` (both modes): best `REJECTS_KEPT` (5) rejects ranked by first objective, each with every violated bound and by how much. `rejected_by` now counts every violated constraint per candidate, not just the first checked.

Status: done on working tree (unshipped). 53 tests via the blind chain: 49 green first run, bite check red (weak form — import error on the new `REJECTS_KEPT` export), reviewer returned 2 MAJOR + 4 MINOR, all six tightenings applied on user go. Full gate green, task-check PASS.

## S3 — continuous refinement — DONE

Landed on working tree:

- `refine.js`: deterministic optimizers on the unit box — fixed-pattern coordinate descent then Nelder-Mead polish (`refinePoint`), no randomness anywhere, same seed always walks the same path.
- Search job takes `"refine": true | {survivors, max_evals, tol}`: refines grid winners over every parameter the space declared more than one value for, bounded by that parameter's declared min/max (f and Q in log space). Scalar mode refines top-N then re-ranks; pareto mode refines each returned front member under no-worsening caps on the other objectives, then prunes. Constraints enforced by penalty; the refined point replaces the grid winner only when feasible and strictly better. Every refined entry carries `refined: {from_score, score, evals, converged, improved}`.
- Standalone `{"kind":"refine","seed":{...},"space":{...},"objective":...}`: warm start from a previous result's `changes`, no grid sweep, scalar objective only.
- Closed the `not_modelled` line "search is exhaustive over the declared grid".

Status: done on working tree. 39 tests via the blind chain: green first run, bite check red (weak form — import error, pre-change search.js lacks the new exports), reviewer returned 1 BLOCKER + 2 MAJOR + 3 MINOR; BLOCKER (vacuous non-domination fixture) and one MAJOR (re-rank unpinned) fixed by writer re-run with tightened spec, two MINORs applied, one MAJOR and one MINOR adjudicated non-issues (spec omissions, not test defects). Full gate green, task-check PASS.

## S5 — replace_segment — DONE

Landed on working tree:

- `replace` change kind everywhere a change set goes (evaluate, search space, refine seed): `{"remove":[f,...],"with":[band,...],"fit_range":[a,b]}`. `remove` frequencies literal + exact-match (same rule as `select`); removed bands genuinely deleted, `with` bands inserted at the first removed position — honest band count and process string, no g=0 workaround. `with: []` = pure removal; a band amended and replaced in one change set is an error.
- Fit residual per replace spec: replacement response minus removed segment's own contribution, `fit: [{rmse, maxdev, hz, range}]` on evaluate results and search survivors (never rejects), default range 20-20000 Hz. Reported, never gating.
- `with` band parameters sweep on the grid and refine continuously like `append`'s (nested coordinates on the replace spec's bands); guidance flags treat removal as a gain change of −g and `with` bands like appends.
- Space expansion split out of `search.js` into `space.js` (file-length gate).

Status: done, committed. 46 tests via the blind chain: green first run, bite check red (weak form — import error, pre-change tree lacks `space.js` and the new metrics exports), reviewer returned 1 BLOCKER + 1 MAJOR + 4 MINOR, all six tightenings applied by writer re-run. Full gate green, task-check PASS.

## S4 — chain I/O — DONE

Landed on working tree:

- New chain sources beside `daemon`/`bands` (`io.js` + `chain.js` dispatch): `{"from":"xml","path",row,eq_only}` reads a config-snapshot XML's `<matrix>` pipelines (channel-attribute selection, entity unescape mirroring `matrixconf.py`, `<matrix_profile>` rows never counted, tail consistency across all rows); `{"from":"parametric_eq","path"}` via shipped `parseEqText` (file preamp recorded as `file_preamp_db` provenance, never a stage; unimportable filter lines in `source.skipped`); `{"from":"snapshot","name"}` loads the store.
- `diff` job: `against` takes any chain spec; both panels + `metric_deltas` (B−A), `response_delta` (rmse, signed maxdev + hz), band pairing by exact f (`matched` with per-parameter deltas / `only_a` / `only_b`; duplicated f never matches), note deltas.
- `snapshot` job: `save` writes named JSON (process string is the single truth, plus provenance/fs/band_count/preamp_db) to `data/eqlab/` (gitignored) or job `dir`; overwrite guarded; `list` needs no chain.
- `export` job: ParametricEQ text through shipped `rowToRewText`; Preamp line computed from the summed response and flagged `preamp_source: "computed_response"`; overwrite guarded. Writes go to files only — daemon contact stays the one GET.

Status: done on working tree. 99 tests via the blind chain: 76/77 green first run, one failure adjudicated as spec defect (importer ignores non-filter lines by design — spec item corrected, writer re-run), bite check red (weak form — import error, pre-change tree lacks `io.js` exports and `diffJob`), reviewer returned 1 BLOCKER + 4 MAJOR + 6 MINOR, all applied by writer re-run under pinned spec. Full gate green, task-check PASS.

## S6 — confidence annotation, headroom, extended flags — PLANNED

- Measurement-confidence annotation: the two rig statements only (~2 dB midrange reseat variance; above 8 kHz outside qualified range). Annotates how much precision narration has earned, never what the user perceives — no audibility language, no per-Q figures, never filters or ranks candidates.
- Sub-20 Hz shelf asymptote: `preamp_db_full` alongside the 20 Hz-bounded `preamp_db`; flag when they differ.
- Extended guidance flags: high-Q large step, fitting above 8 kHz. Reports, never limits — no clamps, ever.

## Pending outside the stages

- vocabulary.json:154/:227 ("a move below the floor for its own Q is inaudible, not subtle") loses to PSYCHOACOUSTICS.md:185; plus stale `_meta.clamps` bounds. Flagged twice; lands as ONE user-reviewed change, not yet green-lit.
