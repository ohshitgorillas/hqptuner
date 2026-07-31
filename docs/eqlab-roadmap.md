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

## S3 — continuous refinement — PLANNED

Coordinate descent + Nelder-Mead over survivors' (f, g, Q), seeded from grid winners, deterministic/seeded, warm start from a previous result. Closes the self-declared `not_modelled` line "search is exhaustive over the declared grid".

## S5 — replace_segment — PLANNED (after S3)

First-class replace change kind: N named bands out, M appended in — honest band count and process string (no g=0 workaround), fit residual (replacement response vs removed segment's contribution) reported. Full fit quality wants S3's descent; grid-only variant possible but user chose plan order over S5-lite.

## S4 — chain I/O — PLANNED

Read: daemon / preset XML / ParametricEQ.txt / saved eqlab chain JSON. Write: files only, never the daemon. Diff job between two chains; named snapshots.

## S6 — confidence annotation, headroom, extended flags — PLANNED

- Measurement-confidence annotation: the two rig statements only (~2 dB midrange reseat variance; above 8 kHz outside qualified range). Annotates how much precision narration has earned, never what the user perceives — no audibility language, no per-Q figures, never filters or ranks candidates.
- Sub-20 Hz shelf asymptote: `preamp_db_full` alongside the 20 Hz-bounded `preamp_db`; flag when they differ.
- Extended guidance flags: high-Q large step, fitting above 8 kHz. Reports, never limits — no clamps, ever.

## Pending outside the stages

- vocabulary.json:154/:227 ("a move below the floor for its own Q is inaudible, not subtle") loses to PSYCHOACOUSTICS.md:185; plus stale `_meta.clamps` bounds. Flagged twice; lands as ONE user-reviewed change, not yet green-lit.
- S1+S2 unshipped: need `CHANGELOG.md` entry under `[Unreleased]`; ship is the user's call.
