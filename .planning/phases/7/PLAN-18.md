---
phase: 7
plan: 18
requirements: []
files:
  - tests/js/components/faceplate-page/sourcepaint-motion.test.js
  - tests/js/components/faceplate-page/spectrumfx-fx.test.js
  - tests/js/components/faceplate-page/aurora-glsl.test.js
  - tests/js/support/rendered/sourcesection.js
  - hqptuner/static/components/faceplate/page/sourcepaint.js
  - hqptuner/static/components/faceplate/page/spectrumfx.js
  - hqptuner/static/components/faceplate/page/aurora.js
  - tests/e2e/test_popovers_park_beside_what_opens_them.py
  - tests/e2e/support/fit.py
  - tests/e2e/test_popovers_fit_every_format.py
---

# Phase 7: One time base - Plan 18: Checks for the surfaces the phase moved

## Goal

The app keeps time on one time base, and the code the phase reshaped behaves as it did. This plan closes the "no automated check exists" half of UAT items 8 and 10. Item 9's seam check already exists. Plan 19 puts every surface in front of the owner.

## Must be true when done

- The meters, each spectrum style and the aurora on the Source page move by the wall time each paint carries, in ms. A paint is never treated as a thousand times longer or shorter than it was, and a check fails if a painter slips a unit.
- Each of the nine popovers moved onto `place()` and `parkPanel()` by dd3541d0 opens beside the element it parks against, on the side its placement names, inside the plate. A check fails if a popover is never moved, or is moved against the wrong element.

## Context

- D-01 binds Task 1: wall time is ms in every painter.
- Plan 3's SUMMARY deviation records that the `sourcepaint`, `spectrumfx` and aurora suites stayed green across the change from seconds to ms, because they compare same-time pictures. The SUMMARY open items record that no test reads the aurora's `time` uniform in seconds (`.planning/phases/7/SUMMARY.md`, phase 7). Those are the gaps Task 1 closes.
- `tests/js/model/shell/place.test.js` pins the placement arithmetic (`clampToPlate`), and `tests/e2e/test_popovers_fit_every_format.py` pins that every popover fits without a scroll bar or cut-off. Nothing pins that each site's panel is moved at all, or against which element. That is the gap Task 2 closes.
- Item 9 needs no new test. `tests/js/components/faceplate-drawers/drawers-source-paint-blank.test.js` already asserts that the Source drawer's spectrogram shows no blank column for played music, and it passed after 4148b887 (UAT item 11 evidence). `tests/e2e/test_spectrogram_scrolls_smoothly_through_bursty_feeds.py` reads its scroll from painted pixels. Plan 19 runs both.
- The Visual settings drawer and the matrix plot (plan 6 task 2) are pinned by `tests/js/components/faceplate-settings/visual.test.js` and `tests/js/components/faceplate-page/profile.test.js`. No new test; the owner's eyes cover them in Plan 19.
- No task changes user-facing text, and no task touches the three phase 8 playhead table files.

## Tasks

### Task 1: The painters move by the ms each paint carries

- **Files:** tests/js/components/faceplate-page/sourcepaint-motion.test.js, tests/js/components/faceplate-page/spectrumfx-fx.test.js, tests/js/components/faceplate-page/aurora-glsl.test.js, tests/js/support/rendered/sourcesection.js, hqptuner/static/components/faceplate/page/sourcepaint.js, hqptuner/static/components/faceplate/page/spectrumfx.js, hqptuner/static/components/faceplate/page/aurora.js
- **Reads:** hqptuner/static/components/faceplate/page/sourcepaint.js#stepAll, hqptuner/static/components/faceplate/page/spectrumfx.js#timed, hqptuner/static/components/faceplate/page/aurora.js#auroraPainter, tests/js/support/rendered/sourcesection.js, tests/js/components/faceplate-page/aurora-glsl.test.js
- **Decisions:** D-01
- **Pins:** tests/js/components/faceplate-page/sourcepaint-motion.test.js, tests/js/components/faceplate-page/sourcepaint-section.test.js, tests/js/components/faceplate-page/spectrumfx-fx.test.js, tests/js/components/faceplate-page/aurora-glsl.test.js, tests/js/store/meter/loop-painters.test.js
- **Action:** The behavior the owner wants: on the Source page, the level bars and held marks, the VU needles, every spectrum style's motion (caps, ridges, halo, flames) and the aurora move at the pace the wall clock sets. A paint that carries some milliseconds moves each of them by that many milliseconds of its own motion, and the aurora's sway reaches its shader as that wall time in seconds. The bug this guards against is a painter that hands its models `dt` in the wrong unit, which moves them a thousand times too fast or too slow. The painters' suites miss that today, because their cases compare pictures over the same stretch of time. Expected values are written by hand from facts independent of the painters, such as the hold and step times the rendered section support already names. They are never computed by the painter's own arithmetic. The test writer picks the unit, the lane, the cases and the values. If a new case is red against HEAD, a painter really slips a unit: fix that painter, and say so in the report. The painter files are on the lease for that case only.
- **Verify:** Testing scope: the outcome is that each of the three painters hands its motion the paint's `dt` in ms and the aurora's `time` uniform gets its sway in seconds. Already covered: the models' own motion in ms (the vu, steps and fire suites), the loop handing painters `dt` in ms (`loop-painters.test.js`), and the spectrum's motion through the loop (`spectrum-motion.test.js`). Not covered: the painters' own hand-off. The smallest check is one case per painter that a slip by a factor of 1000 turns red. Testing stops there. (1) Red run: restore `sourcepaint.js`, `spectrumfx.js` and `aurora.js` as they stood at `5d4e572e^` over HEAD's in a scratch copy of the tree. The new cases fail by `AssertionError`. If a restored painter no longer loads at HEAD, a scratch edit that hands that painter's models `dt * 1000` stands in, and the report says which. The scratch files are put back. (2) After: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test` over every Pins file passes. (3) `scripts/gate.sh make lint-js` passes, jscpd included.

### Task 2: Each popover opens beside what opens it

- **Files:** tests/e2e/test_popovers_park_beside_what_opens_them.py, tests/e2e/support/fit.py, tests/e2e/test_popovers_fit_every_format.py
- **Reads:** hqptuner/static/components/faceplate/Popover.js#parkPanel, hqptuner/static/components/faceplate/Popover.js#place, hqptuner/static/components/faceplate/Header.js#parkNote, tests/e2e/test_popovers_fit_every_format.py, tests/e2e/support/fit.py, tests/e2e/conftest.py
- **Decisions:** D-03
- **Pins:** tests/e2e/test_popovers_fit_every_format.py, tests/e2e/test_see_more_popover_bounds.py, tests/e2e/test_drawer_popover_shows_whole.py, tests/js/model/shell/place.test.js
- **Action:** The behavior the owner wants: each popover parks under (or beside) what opens it, as before. Nine sites write their placement through `place()` or `parkPanel()` in `Popover.js`: the alert note in `Header.js` (parked against its home element, not a trigger button), `HfFilter.js`, `SeeMore.js`, `Volume.js`, `bottom/Switcher.js`, `drawers/pipelines/parts.js`, `lists/FacetPopover.js`, `page/DisplayOptions.js` and `page/FilterPresets.js`. Each one opens beside the element it parks against, on the side its placement names (below, flip, or before and level with the top), inside the plate. The bug this guards against is a site whose panel is never moved, or is moved against the wrong element. Today's fit suite still passes in that case as long as the panel fits. Geometry exists only in a real layout engine, as the fit suite's policy notes say, so the lease names the browser lane. The test writer picks the cases, the format and the values. The test guards that a panel sits against its anchor, not the chosen gap figures (`docs/spec/testing.md` rule 11). If the walk that reaches each trigger would repeat the fit suite's walk, it moves into `tests/e2e/support/fit.py` for both, and stays under the jscpd gate. A site the e2e stack cannot bring up is named in the report, never dropped silently.
- **Verify:** Testing scope: the outcome is that each of the nine popovers lands beside what it parks against. Already covered: the clamp arithmetic (`place.test.js`) and every popover fitting (`test_popovers_fit_every_format.py`). Not covered: that each site moves its panel, and against which element. The smallest check is one case per site at one plate format. The other formats are the fit suite's. Testing stops there. (1) Bite: with `place` in `Popover.js` edited to write nothing (a scratch edit, put back before anything is staged, so `Popover.js` is never committed and stays off the file lease), every new case fails; with it restored, every case passes. (2) `scripts/gate.sh .venv/bin/pytest -m e2e tests/e2e/test_popovers_park_beside_what_opens_them.py tests/e2e/test_popovers_fit_every_format.py --no-cov -q` passes. (3) `scripts/gate.sh make lint` and `scripts/gate.sh make jscpd` pass. Name the headless chromium and app subprocess before they run (`~/dev/CLAUDE.md` 3.1).
