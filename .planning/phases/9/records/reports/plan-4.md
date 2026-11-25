PLAN PARTIAL

Plan: .planning/phases/9/PLAN-4.md

Tasks: 0 of 1

| Task | Commit | Note |
|---|---|---|
| 1 - The owner checks every style under two color suites on the rebuilt dev build | none | Owner check done; verify not met as written for Fade. Owner's words, verbatim: "y'know what, that's my mistake... Fade does get a trace. the rest pass." No code, test or spec text changed; no commit. Own captures from the first run (see `plan-4.1.md`) stand: `hqptuner:dev` serves fd8296c8, healthy on `:8090`; under Trace the `.strace`/`.sarea`/`.shold` paths are drawn, under the other five styles all three are empty; `.sgridl` shows under every style. |

Deviations:
- [deviation] The plan asserted (Must be true when done, D-01, D-03, D-04, SPEC-02 as reworded) that Fade shows no trace line, fill or shadow, and that only Fade's own canvas line stays. The owner ruled, at the hand-back URL, that Fade does get a trace ("that's my mistake... Fade does get a trace"). Coordinator's reading, an interpretation and not the owner's words: the Fade style should show the SVG trace like Trace does, so the phase rule that Fade shows none was the owner's own mistake. What I did: nothing in code, tests or spec; per the plan, a finding at this check goes back to planning with the style named. Style named: Fade. Suite: not suite-specific (every style is withheld by style, under every color suite).

Open items:
- Fade ruling goes back to planning. Places that currently say Fade shows no trace and so would change: the style table in `hqptuner/static/store/ui/prefs.js` (around :176-178, Plan 2's one yes or no per style), Plan 2's painter in `hqptuner/static/components/faceplate/page/sourcepaint.js`, the style-table and painter tests under `tests/js/components/faceplate-page/`, the spec wording in `docs/spec/design-system.md:34-35` and `todo.txt:18`, and CONTEXT D-01, D-03, D-04 plus the phase goal wording. Spec/user-facing wording changes need owner-approved copy.
- The other styles (Bars, Ridges, Aurora, Flames) and Trace passed per the owner ("the rest pass"). The owner's reply does not name a second color suite; coordinator to decide whether that satisfies the "Borealis and one other suite" clause.
- Own captures were taken with `hqplayerd` State 0 (idle); the owner's check, with music playing, is the AC7 evidence, and Aurora's D-10 evidence is the owner's eyes ("the rest pass").
