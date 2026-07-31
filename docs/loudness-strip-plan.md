# Loudness visual overhaul — execution plan

**Status: PHASE 1 NOT STARTED.** Executing agent: update this line and the per-phase status markers as you go. When every phase is DONE, perform the Teardown section and delete this file in the same commit as the final docs update. This file is a working scratchpad, not documentation — nothing may cite it.

## Goal (user-approved design)

Replace the Loudness card's two side-by-side Bass/Treble clusters with a Matrix-band-strip-style control strip, buying back vertical space while keeping every feature. Final card order, top to bottom:

1. Enable checkbox (unchanged).
2. Range row: Lower bound / Upper bound (unchanged fields, moved to top of body).
3. `[BASS|TREBLE]` segment switch + Type dropdown for the selected side.
4. Knob trio for the selected side: **Frequency | Level | Steepness/Q** — keep the existing schema labels verbatim; do NOT rename to Matrix's freq/gain/Q.
5. Response plot (unchanged position, bottom).

Scale decisions (user delegated, decided): Frequency knob `scale: "log"`, Steepness/Q knob `scale: "log"` (matches Matrix Q knob precedent, `MatrixPlot.js` `BAND_ARGS`), Level stays linear dB. Exact-value entry preserved automatically — `Knob` renders an editable box in real units.

## Load-bearing facts (verified 2026-07-31, re-verify only if files changed)

- Current card: `hqptuner/static/components/tabs/VolumeTab.js:14-54` (`LoudnessCard`).
- Pattern source: `hqptuner/static/components/MatrixPlot.js:266-284` (`BandStrip`, `.band-strip`/`.band-slots`/`.band-arg` CSS in `hqptuner/static/css/knobs.css`).
- Segment control: `hqptuner/static/components/controls/index.js:16` — same component as the Speakers/Headphones switcher.
- `Knob` (`hqptuner/static/components/Knob.js`): props `value/min/max/step/def/size/slider/disabled/unit/label/scale/onLive/onCommit`; `scale="log"` requires min > 0.
- `Field` (`hqptuner/static/components/Field.js:142-180`) binds schema key to store: bounds via `cfgConstraint` (daemon form is authority, schema min/max is fallback), graying via `grayReason`, dirty highlight, `setLive`/`edit` streaming. **Field currently does not forward a `scale` prop to Knob — must add.**
- Schema entries: `hqptuner/static/store/schema.js:638-767`. Per side: `loudness_{low,high}_level` (widget knob, linear), `_freq` (widget number), `_steep` (widget slidernum, schema fallback 0.1–10), `_type` (dropdown, options from daemon). Plus `loudness_range_{low,high}` (number) and `loudness_enabled`.
- Graying: `loudnessOff`/`loudnessGated` already on every field; rides Field automatically.
- Plot: `LoudnessPlot` (`hqptuner/static/components/plots.js:254+`) already streams via `setLive`/`edit` and has draggable freq/level corner dots per side.
- Side switch is client-only UI state — a Preact signal local to the card; never touches schema, store trees, or server.

## Rules that bind every phase

- Read `docs/design-system.md` before any CSS/layout edit; read `docs/testing.md` before any test work. Both are binding.
- After any code edit, run `/task-check` (`bash .claude/task-check.sh`) before reporting; hand the printed URL to the user. User's eyes are the final gate on every visual change.
- Tests for new/changed behavior go through the `/tests` chain (blind `test-writer` from a spec block), never authored by the implementing agent.
- Update the Status line and the phase marker below when starting/finishing a phase. Record deviations and discoveries in the phase's Notes line — the next agent starts from those.
- Markdown soft-wrap enforced; changelog entry required (Phase 4).

## Phase 1 — control strip rebuild [NOT STARTED]

Scope: `VolumeTab.js`, `schema.js`, `Field.js` (one-line scale forward), CSS.

1. Schema: change `loudness_low_freq`/`loudness_high_freq` widget `number` → `knob` with `slider: true`, `scale: "log"`; change `loudness_low_steep`/`loudness_high_steep` widget `slidernum` → `knob` with `slider: true`, `scale: "log"` (keep the 0.1–10 fallback bounds). Add `scale` passthrough in `Field.js` (`cfgConstraint` bounds win as today; freq bounds come from the daemon form — verify they are > 0 for log, else fall back linear and note it).
2. `LoudnessCard`: add local `side` signal (`"low"` default). Render new order (Goal §). Strip = `Segment` (`[{value:"low",label:"Bass"},{value:"high",label:"Treble"}]`) + Type `Field` for the active side, then three `Field`s (`loudness_${side}_freq`, `_level`, `_steep`) laid out band-strip style with `.col-rule` separators. Both sides' fields stay mounted-or-remounted per render — Preact re-render on signal flip is fine; dirty/gray state lives in the store, not the component.
3. CSS: reuse `.band-strip`/`.band-slots`/`.band-arg` geometry where possible; if Field's label-grid fights the compact strip layout, add a scoped modifier (e.g. `.loudness-strip .field-knob`) rather than forking the band classes. Follow design-system two-track/hairline rules. Range row keeps `.range-row`.
4. Kill now-dead CSS if the cluster classes lose their last user (`grep` before deleting — Matrix and crossfeed cards share cluster classes).
5. `/task-check`, hand back URL. Note vertical-space delta if measurable.

Notes: —

## Phase 2 — plot/strip sync enhancements [NOT STARTED]

User-approved enhancements; small, all client-side:

1. Dragging or grabbing a plot corner dot flips the `side` signal to that dot's side (mirrors Matrix dot-selects-band flow). Wire in `LoudnessPlot`'s handle `onDrag`/`onEnd` or an `onSelect` analog — plot and strip must point at the same side.
2. Inactive segment button shows a dirty indicator when the hidden side has staged edits (`isDirty` over that side's four keys) — staged edits must never be invisible. Small accent dot per design-system dirty conventions.
3. Judgment call (optional, skip if it fights the design system): visual tie between active segment and its plot dot.

`/task-check`, hand back URL.

Notes: —

## Phase 3 — tests [NOT STARTED]

Run `/tests` with a spec block covering new behavior only (behavior, public API, one assertion per test — `docs/testing.md`). Candidate behaviors: schema widget/scale changes visible through the public schema export; side-flip-on-dot-interaction; dirty indicator predicate. UI geometry is not testable policy — don't spec it. Orchestrator adjudicates failures; bite check required.

Notes: —

## Phase 4 — docs, changelog, teardown [NOT STARTED]

1. `CHANGELOG.md` under `[Unreleased]`: 2–4 plain sentences, user-visible change only (new Loudness strip layout, Bass/Treble switch, knob entry for freq/steepness).
2. `docs/design-system.md`: only if Phase 1/2 minted a reusable pattern or token (e.g. the strip-with-segment pattern or a Field-in-strip modifier) — record the pattern, not the history.
3. `README.md`: touch only if it describes the old Loudness layout.
4. Teardown: confirm every load-bearing fact from this file that future agents need lives in a permanent doc or the code itself; then `git rm docs/loudness-strip-plan.md` in the final commit. No trivia transfers — decisions go in commit messages.

Notes: —
