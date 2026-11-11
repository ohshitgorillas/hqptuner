---
phase: 3
plan: 1
requirements: [BUG-03]
files:
  - hqptuner/static/model/shell/hf-reach.js
  - tests/js/model/shell/hf-reach.test.js
  - hqptuner/static/store/faceplate/chain.js
  - tests/js/store/faceplate/chain.test.js
  - tests/js/components/faceplate/rail.test.js
  - hqptuner/static/store/faceplate/hf.js
  - tests/js/store/faceplate/hf.test.js
  - hqptuner/static/components/faceplate/HfFilter.js
  - hqptuner/static/css/header.css
  - tests/js/components/faceplate/hf-filter.test.js
  - docs/spec/faceplate.md
---

# Phase 3: HF filter lamp follows the content - Plan 1: HF lamp and menu follow the content

## Goal

The HF filter lamp is lit only while the playing content is content the selected HF filter acts on, and the engine-row HF menu grays every option that does nothing on that content.

## Must be true when done

- On a 44.1 kHz source, and on a DSD64 source played through PCM conversion, the rail's HF filter lamp is unlit whatever filter is engaged, prints no value, and every HF menu option except none is grayed.
- On an 88.2 kHz source the lamp is unlit with 50k or 2x engaged and lit with 20k, 30k or 40k engaged; the menu grays 50k, 2x, 4x and 8x.
- On a 176.4 kHz source the lamp is lit with 50k or 2x engaged; the menu grays 4x and 8x only.
- On a DSD128 source played through PCM conversion the lamp is lit with 30k engaged and unlit with 50k engaged; under Direct SDM the HF stage still reads bypassed.
- A tap on a grayed HF menu option sends no write and leaves the running filter as it was; none is never grayed.
- `scripts/gate.sh make check` prints `exit=0`.

## Context

- Locked: D-01 content rate is `metadata.samplerate`, never `Status.active_rate`; D-02 nothing acts below 50 kHz; D-03 Nx filters act above N times the 44.1/48 kHz base; D-04 DSD counts at rate / 64, Direct SDM stays bypassed; D-05 fixed corners act when Nyquist exceeds the corner; D-06 keyed by engine option name; D-07 non-acting shows `off`, not `byp`, no value; D-08 grayed rows carry no badge, no text, no write, none never grayed; D-09 old tests rewritten tests-first, spec gains the rule.
- Patterns: the rail picture is plain data decided by `railStages` (`hqptuner/static/store/faceplate/chain.js`); DOM-free derivations live in `hqptuner/static/model/shell/` (`conversion.js` `rateStage` is the precedent); grayed menu rows in this tree use `disabled` on a `.pmrow` button (`bottom/Switcher.js` `SlotMenu`, `drawer/Head.js` `modeMenu`); dead-state ink is `--ink-3` per `docs/spec/design-system.md` (precedent `sheets.css` `.orow[aria-disabled="true"] .nm`).
- Out: the HF autopilot, the engine-row HF readout text, any new copy or badge, the HF drawer's `junk_filter` row, and any measurement of a filter's corner, slope or reach.
- No user-facing text changes. No `CHANGELOG.md` entry (owner's alone).

## Tasks

### Task 1: The acts-on rule as a pure derivation

- **Files:** hqptuner/static/model/shell/hf-reach.js, tests/js/model/shell/hf-reach.test.js
- **Reads:** hqptuner/static/model/shell/conversion.js#rateStage, hqptuner/static/store/live/derive.js#NX_FLOOR, hqptuner/static/model/family.js#isDsdRate, hqptuner/engine/junkcurve.py#CORNER_KHZ, hqptuner/engine/junkadvisor.py#RAMP_MIN_RATE, hqptuner/data/engine-enums.json
- **Decisions:** D-02, D-03, D-04, D-05, D-06
- **Action:** Create a DOM-free, signal-free module in `hqptuner/static/model/shell/` that answers, from plain inputs, two separate decisions, each in its own function returning one type (`docs/spec/testing.md` rule 17). First, the content rate a filter is judged against: the source rate in Hz, divided by 64 when the source is a DSD bitstream (D-04: DSD64 counts as 44100, DSD128 as 88200), and an explicit "no rate known" result when the rate is missing, zero or not a number. Second, whether an HF filter, given by its engine option name (`20k`, `30k`, `40k`, `50k`, `2x`, `4x`, `8x`; D-06, never a list index), acts on content at a given content rate. The rule: below 50000 Hz nothing acts (D-02; reuse the 50 kHz floor's meaning from `derive.js` `NX_FLOOR`, so a 48 kHz source is dark for 20k even though its Nyquist clears 20 kHz); a fixed-corner filter acts only when the content's Nyquist (rate / 2) is above its corner (D-05: 20, 30, 40, 50 kHz, as `junkcurve.py` `CORNER_KHZ` names them); an Nx filter acts only when the content rate is above N times its base rate, the base being 44100 for the 44.1 kHz family and 48000 for the 48 kHz family (D-03; so 2x acts on 176.4/192 kHz and up, 4x on 352.8/384 and up, 8x on 705.6/768 and up). Your discretion, recorded here: `none` is never judged as non-acting (the menu never grays it; the rail already treats it as off); a name the rule does not know, and any filter while no rate is known, counts as acting, so a filter the running engine adds later is never grayed or darkened on a guess (the engine is the enumeration authority, and its reach is undocumented). Keep the corner and multiple tables in this one module so the rail and the menu cannot disagree. Avoid importing any store or signal module: both callers hand it plain values.
- **Verify:** Tests-first: write the suite in `tests/js/model/shell/hf-reach.test.js`, run it red before the module exists, then green with `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/model/shell/hf-reach.test.js` printing `exit=0`. Testing scope: pure lane only. Outcomes to pin: every named filter dark at 44100 and at 48000; at 88200, 20k/30k/40k act and 50k/2x/4x/8x do not; at 176400, 50k and 2x act and 4x/8x do not; one 48 kHz-family point (96000: 50k and 2x dark; 192000: 2x acts, 4x dark); one point each where 4x and 8x first act (352800, 705600); DSD rates 2822400 and 5644800 give content rates 44100 and 88200; a missing or zero rate gives no rate and judges every filter acting; `none` and an unknown name never read non-acting. Nothing already covers this module. Stop there: no exhaustive rate-by-filter grid beyond these points.

### Task 2: The rail's HF stage follows the content

- **Files:** hqptuner/static/store/faceplate/chain.js, tests/js/store/faceplate/chain.test.js, tests/js/components/faceplate/rail.test.js
- **Reads:** hqptuner/static/store/faceplate/chain.js#READ, hqptuner/static/store/faceplate/chain.js#railStages, hqptuner/static/store/faceplate/chain.js#railLamp, hqptuner/static/store/faceplate/path.js#playbackPath, tests/js/store/faceplate/chain.test.js#running, tests/js/components/faceplate/rail.test.js#playing
- **Decisions:** D-01, D-04, D-07, D-09
- **Pins:** tests/js/store/faceplate/chain.test.js, tests/js/components/faceplate/rail.test.js, tests/js/store/faceplate/rail-now.test.js, tests/js/components/faceplate-drawers/drawers-rate-title.test.js
- **Action:** Make the `hf` entry of `READ` in `chain.js` light the stage only while the engaged filter (not `""`, not `none`) acts on the content per Task 1's rule, judged against `r.metadata.samplerate` (D-01, never `r.status.active_rate`), counted at rate / 64 when `r.path` is a DSD-source path (`dsd-pcm`, `sdm-sdm`, `direct`; D-04 and its flagged assumption cover `sdm-sdm`). A non-acting engaged filter reads `on: false` with an empty value, exactly as an unengaged one does (D-07), and is never marked `byp`; Direct SDM keeps its existing `BYPASSED_BY_DIRECT` bypass untouched. Derive this from the existing `Running` picture: add no field to the `Running` typedef, since its fixtures in `chain.test.js` and `drawers-rate-title.test.js` build it whole. Leave `railLamp` and `railValue` as they are: the paused and off transports already darken the stage, and with no rate known Task 1's rule keeps today's reading. Update the module's head comment to say the HF stage is lit only for content its filter acts on. Tests-first (D-09, `docs/spec/testing.md` rule 8): rewrite the old-behavior cases that pin an engaged filter lit on the 44.1 kHz default (`chain.test.js` the engine-name value case and the lit-while-playing lamp case; `rail.test.js` the lit-lamp case and its `playing` fixture, whose source rate moves to one the fixture's `30k` acts on, which also keeps the stage-shows-its-value case honest) as changed behavior, and add the cases below; never edit a test to pass. The off and paused cases in `chain.test.js` stay as they are.
- **Verify:** Run the rewritten and new tests red against the pre-change `chain.js` (implementation at HEAD, tests kept), then green: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/chain.test.js tests/js/components/faceplate/rail.test.js tests/js/store/faceplate/rail-now.test.js` prints `exit=0`. Testing scope: lowest lane is `railStages` (pure); the rendered rail needs only its fixture moved so its lit-lamp and value cases sit on acting content. Outcomes to pin at the `railStages` lane: an engaged 20k on a 44.1 kHz source reads unlit, carries no value and is not `byp`; 50k on 88.2 kHz unlit and 30k on 88.2 kHz lit; 50k and 2x on 176.4 kHz lit; on a `dsd-pcm` path a DSD128 rate with 30k lit and with 50k unlit, and a DSD64 rate with 30k unlit; `direct` still marks the HF stage `byp`. The rule's full table is Task 1's; do not repeat it here.

### Task 3: The HF menu options carry whether they do nothing on the content

- **Files:** hqptuner/static/store/faceplate/hf.js, tests/js/store/faceplate/hf.test.js
- **Reads:** hqptuner/static/store/faceplate/hf.js#hfNow, hqptuner/static/store/faceplate/path.js#sourceIsDsd, hqptuner/static/store/faceplate/path.js#transportNow, hqptuner/static/store/signals.js#engineStatus
- **Decisions:** D-01, D-04, D-06, D-08
- **Pins:** tests/js/store/faceplate/hf.test.js, tests/js/components/faceplate/hf-filter.test.js
- **Action:** Extend `hfNow` so each `HfOption` also says whether it is grayed: an option is grayed when Task 1's rule says its engine name (`o.label`, the enumeration's name; D-06, never its index) does nothing on the playing content. The content is the engine's reported source (`engineStatus` `metadata.samplerate`, D-01), counted at rate / 64 when `sourceIsDsd` says the source is a DSD bitstream (D-04). Your discretion, recorded here: the menu judges the content while `transportNow()` reads `playing` or `paused`, since a paused track still has a known source; while it reads `off` (stopped, not ready), or with no rate known, nothing is grayed (CONTEXT flagged assumption 2), because the engine leaves a stopped track's metadata behind. `none` is never grayed. The running option keeps `cur` true when it is grayed (flagged assumption 3). Document the new property in the `HfOption` typedef and the module head comment. Change nothing about `txt`, option order, values or `pickHf`.
- **Verify:** Tests-first: new cases red against the pre-change `hf.js`, then `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/hf.test.js tests/js/components/faceplate/hf-filter.test.js` prints `exit=0`; the existing cases, which seed no source, still pass unedited. Testing scope: store lane, seeded at the wire signals the suite already drives plus `engineStatus` and the health phase. Outcomes: playing a 44.1 kHz source grays every option but none; playing a DSD64 source (`sdm` flag set) grays every option but none; playing 88.2 kHz grays 50k, 2x, 4x and 8x and leaves none, 20k, 30k, 40k; playing 176.4 kHz grays only 4x and 8x; stopped with stale 44.1 kHz metadata grays nothing; a grayed running option is still current. The rule table is Task 1's; stop at these.

### Task 4: A grayed HF menu row is drawn dead and does nothing when tapped

- **Files:** hqptuner/static/components/faceplate/HfFilter.js, hqptuner/static/css/header.css, tests/js/components/faceplate/hf-filter.test.js
- **Reads:** hqptuner/static/components/faceplate/HfFilter.js#HfFilterPopover, hqptuner/static/components/faceplate/HfFilter.js#pick, hqptuner/static/components/faceplate/bottom/Switcher.js#SlotMenu, hqptuner/static/css/header.css#.hfpop, hqptuner/static/css/sheets.css#.orow, docs/spec/design-system.md
- **Decisions:** D-08
- **Pins:** tests/js/components/faceplate/hf-filter.test.js
- **Action:** In `HfFilterPopover`, render a grayed option's row as disabled the way this tree's menus already do (`disabled` on the `.pmrow` button, as `Switcher.js` `SlotMenu` does), still ticked by `aria-checked` when it is the running one. A tap on a grayed row does nothing at all: no `pickHf` call, so no write, and the menu stays open. Enforce this in the handler, not only through the `disabled` attribute, because the suite fires `onClick` through the vnode seam where a disabled attribute stops nothing. The row carries no badge, no `title`, no reason text and no new words (D-08; no copy ships). In `header.css`, under the existing HF menu block, give a disabled `.hfpop .pmrow` the dead-state look: `--ink-3` text per `docs/spec/design-system.md` (precedent `.orow[aria-disabled="true"] .nm`), a default cursor, and no `--hover` background. Read `docs/spec/design-system.md` before the CSS edit. Update the component's head comment to say grayed rows do nothing.
- **Verify:** Tests-first: new cases red against the pre-change `HfFilter.js`, then `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/hf-filter.test.js` prints `exit=0`. Testing scope: rendered-component lane, which is the lowest that observes the attribute and the tap. Outcomes: with a 44.1 kHz source playing, every row but none renders disabled; firing a grayed row's tap posts nothing to `/api/config/live` and leaves `openPopover` open; firing a non-grayed row's tap still writes its index (the existing pick case covers this). The CSS look is not unit-tested: it is checked at the hand-back. Then `bash .claude/task-check.sh` passes (make check, rebuilt `hqptuner:dev`, `:8090` healthy). human-verify: at the hand-back URL from the host skill, the owner plays a 44.1 kHz track and an 88.2 or 176.4 kHz track, opens the engine-row HF menu, and sees the non-acting rows in dead ink with no badge or text, a tap on one doing nothing, and the rail's HF lamp lit only on content the engaged filter acts on.

### Task 5: The faceplate spec states the acts-on rule

- **Files:** docs/spec/faceplate.md
- **Reads:** docs/spec/faceplate.md#Rail, docs/spec/faceplate.md#Alerts
- **Decisions:** D-02, D-03, D-04, D-05, D-07, D-08, D-09
- **Action:** With `Edit`, soft-wrapped, no em dashes: in the rail rule that lists why an unlit lamp prints no value (the line naming off, bypassed on the playing path, or darkened by an alert), add an engaged HF filter on content it does not act on. At the HF filter advice line in the alerts list (the one saying the HF filter can't be engaged at 1x rates), state the acts-on rule: content is the source rate, a DSD source through conversion at rate / 64, Direct SDM bypassed; nothing acts below 50 kHz; 20k to 50k act when the content's Nyquist exceeds the corner; 2x, 4x and 8x act above that multiple of the 44.1 or 48 kHz base; the engine-row HF menu grays every option that does nothing on the playing content, none never, a grayed row carries no text and a tap on it does nothing. Cite manual §4.6 p27 and §8 p52 as CONTEXT does. Keep the wording a rule, no decision history (repo rule on trivia).
- **Verify:** `scripts/gate.sh .venv/bin/python .claude/hooks/md-softwrap.py --check docs/spec/faceplate.md` and `scripts/gate.sh .venv/bin/python scripts/gates/check_docs.py .` print `exit=0`; `grep -n "—" docs/spec/faceplate.md` shows no new line from this edit. Then the phase gate: `scripts/gate.sh make check` prints `exit=0` (AC6).

## Notes

- Recalled D-01 to D-04 (phases/3/CONTEXT.md, phase 3) bind Tasks 1 to 3; phase 2's D-01 rate gate is unrelated and not reused.
- Plan shape: one plan, as CONTEXT directs. All tasks are sequential (Tasks 2 and 3 both consume Task 1's module; Task 4 consumes Task 3's option property).
- Discretion choices for the owner's eye at hand-back: the menu judges a paused track as well as a playing one (Task 3); a filter name the rule does not know is never grayed or darkened (Task 1); a grayed running row stays ticked (flagged assumption 3).
- Outside this plan, for the human: the HF drawer's own `junk_filter` row (`components/faceplate/drawers/hf.js`) offers the same options and is not grayed, since D-08 scopes graying to the engine-row menu. Under Direct SDM the menu still judges a DSD source at rate / 64 (D-04 as written), though the stage is bypassed; no decision covers graying everything there.
