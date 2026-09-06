---
name: hand-back
description: HQPTuner hand-back protocol: when task-check and a rebuild are owed, the three unbriefed reviewer agents and their brief rules, reading captures element by element, and snap.py for screenshots and measurement. Load before any hand-back of a visual change.
---

# Hand-back

## When a rebuild is owed

After any edit to `hqptuner/`, static assets or dependencies, run `/task-check` (`bash .claude/task-check.sh`) before reporting done: `make check`, then (green only) rebuild the `hqptuner:dev` container from the working tree and health-check `:8090`. Work counts as done once the gate is green, the container is rebuilt, and the hand-back URL task-check prints on PASS is handed to the user, who views and tests every change in the browser.

A `CHANGELOG.md`, `docs/`, `scripts/` or `.claude/` edit does not warrant task-check and gets no hand-back URL: the container serves nothing from any of them, and `pair.sh merge` already ran the full gate. Run just the relevant free gate (`make lint`, `check_changelog.py`, the soft-wrap check, the script's own tests). A tooling change's proof is running the tool, not a rebuild.

## The user's eyes are final

Not `make check`, not a green measurement table, not your own screenshot reading. Gates catch what they were pointed at; shipped defects are the ones nobody pointed at. Every visual change goes in front of the user at the hand-back URL before it is called done.

## Independent visual check

An orchestrator can only confirm that the wrong thing is correctly implemented. Every major visual change gets `user-reviewer` on the rebuilt container before hand-back, inside the same `scripts/abuse.sh` bracket as the abuser, sweeping the LIVE view there; its list is relayed in full and your own capture read never substitutes for it. The brief may carry the area the owner's spec names (a tab, URL fragment, card or pane title) and never the expected result.

## The three reviewer agents

All three are unbriefed. A brief that names a change, a file, a check or an expected result is refused on sight with `REJECTED: STEERING`, and the refusal is reported to the user like a spec-reviewer `ANOTHER PASS`; the bare brief then goes to a fresh agent. Each returns a severity-sorted list under seven fixed categories and no verdict; the list is your input to verify and relay, never a grade to report.

- **`user-reviewer`**: bare URL plus optional area, viewports, drivers (`scripts/snap.py`, `scripts/primerdrive.py` with a state file), recipes for reaching states, and known bugs to skip (location plus symptom). An area bounds where the sweep goes, never what it finds: a container a user can name from the screen or address bar; a thing inside one (a fill, a marker, a column, a label) is steering. No area means every tab; with one, that area at every accent, MODE position and viewport. `seen:` complaints are unverified and every one goes in front of your eyes and then the user's.
- **`abuser-reviewer`**: attacks the running app from outside. Same brief rule. Runs only inside a bracket: `scripts/abuse.sh open` before spawning and `scripts/abuse.sh close` after, one metered action each; the agent reads `state/abuse/current` and stops without it. Findings (`lands`, `stages`, `crashes`, `stumbles`) each carry a repro; reproduce a finding before relaying it. The bracket also puts live writes back.
- **`pedant-reviewer`**: fact-checks one topic against authority. Brief is a topic, a claim surface (tab, route, doc path) and known wrongs to skip; a brief supplying an answer, a citation or a fix is refused. Claims come from rendered copy and docs, never `hqptuner/`; authority is a capped ladder (`manual-facts.txt`, then the manual and readme by index, then `/api/enumerations` for names, then the web for standard mathematics only). Silence in the manual is `undocumented`. Findings (`contradicts`, `unsupported`, `imprecise`) quote claim and authority with a citation; check a citation before relaying. Served modules under `/components/`, `/store/`, `/lib/` are source and hook-denied for every reviewer.

## Reading a capture

Read every screenshot with your own eyes, element by element: for each fill, edge, trace, mark and legend row, does it start and end where the rule says, and is it readable as what its legend row calls it. Any vertical run of an edge, any fill thinner than a line, any layer that only shows as a tone change is a defect to name. A full-page capture at 1152 px makes a pane 40 px tall and hides all of this; a closer look is a 2400 px `snap.py` shot with the pane scrolled to the top of the viewport. No PIL or ImageMagick on the host. Subagent measurements (computed styles, box geometry, gap arithmetic, error counts) are trustworthy; a subagent's visual verdict is not.

## snap.py

`scripts/snap.py` is screenshot plus geometry and computed-style measurement in one CLI (`.venv/bin/python scripts/snap.py --help`); no scratchpad playwright boilerplate. Browser binary comes from `HQPTUNER_CHROMIUM` (set in `hqpcreds`; source it first). Drop to raw playwright in `.venv` only for interaction flows snap.py cannot express, passing the host chromium to `p.chromium.launch(executable_path=…)`; it is the only browser available, so skip `playwright install`.

## Probing the container

Before a browser probe writes anything, read and record the current value of every field it will touch, and clean up by restoring exactly those fields. Never click Discard, Apply, Apply & Save or Save as New: the staging buffer is server-side state shared with the user, who usually has their own edits staged. See `live-daemon`.
