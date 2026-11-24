PLAN COMPLETE

Plan: .planning/phases/7/PLAN-18.md

Tasks: 2 of 2

| Task | Commit | Note |
|---|---|---|
| 1 - The painters move by the ms each paint carries | 5b10b258 | Six cases across three suites: peak bar falls 20 dB in 1000 ms, trace closes 1/e of the gap in 150 ms, needle short of 99% at 270 ms and at 99% by 330 ms (IEC 60268-17 fixture), bars peak cap holds 500 ms then falls half the plot in a further 500 ms, aurora `time` uniform is 2.5 for 2500 ms of paints. Painters unchanged: no unit slip found at HEAD. |
| 2 - Each popover opens beside what opens it | 81efbfd7 | New `test_popovers_park_beside_what_opens_them.py` reads six sites in one walk of the plate at Normal (HF menu, see-more note, bottom bar menu, pipeline + menus, Display options, filter presets) and the facet panel in its own case. The fit suite's walk moved to `fit.walk_js(measure)` in `tests/e2e/support/fit.py` and the fit suite takes it from there (`Walk`, `walk_plate` made public for the new test). `Popover.js` never touched. |

Red run for task 1: `sourcepaint.js`, `spectrumfx.js` and `aurora.js` from `5d4e572e^` laid over HEAD's in a scratch copy under /tmp (removed after). All three restored painters loaded. Each of the three suites failed by AssertionError: bar, trace and the early-needle case (sourcepaint-motion), the cap case (spectrumfx-fx), the time-uniform case (aurora-glsl). That slip is x1000 too fast, so the late-needle case stayed green there. A second scratch copy handing each painter `dt / 1000` turned the late-needle, bar, trace, cap and uniform cases red, so a slip either way is caught.

Bite for task 2: `place` in `Popover.js` edited to write nothing, both new cases failed (the walk case named the HF menu, see-more note, bottom bar menu, pipeline + menu, Display options and filter presets; the facet case failed). `Popover.js` restored with `git checkout`, `git status` shows it clean.

Verification: `scripts/gate.sh node ... --test` over all five Pins files, exit 0. `make lint-js` exit 0. `make lint` exit 0. `make jscpd` exit 0. e2e `test_popovers_park_beside_what_opens_them.py` and `test_popovers_fit_every_format.py`: 37 passed. Full suite `scripts/gate.sh make check` (the manifest's suite, `workflow.test_command` is null): lint, lint-js and the offline pytest passed; `test-js` failed with exactly the 12 baseline playhead tests SUMMARY records for phase 8 (8 in `playhead-lag.test.js`, 3 in `playhead-motion.test.js`, 1 in `playhead-scroll.test.js`), 5641 of 5653 passing.

Deviations: none

Open items:

- 12 red playhead tests (phase 8's tables, named above; rewritten by phase 8 plans 1 and 2). They make `make check` exit non-zero.
- Two of the nine popover sites are not read: the volume panel (the stack's fake engine config pins the volume, so its trigger is disabled) and the alert note (the stack raises no alert, so no note is homed). Both named in the new test's docstring. The facet panel opens from the list a chain picker opens, which the fit suite's walk does not enter, so it has its own case.
- The fit suite does not recognize the option list sheet as a surface, so nothing inside the list is measured by it. Not in this plan's scope.
- Declined the fuller shape for task 1: one hand-off case per spectrum style (ridges, halo, flames). The painter hands every style the same `frame.dt`, so the bars cap case meets the Verify; add per-style cases only if a painter ever hands a style its own `dt`.
- Gate-rule slips by me, 8.1: I piped one `scripts/gate.sh` run into `tail` and sent two others to `/dev/null` (a spectrumfx rerun and the task 2 bite run); the logs were kept by the gate and the results were re-read from them or re-run without the redirect.
- The e2e lane needs `HQPTUNER_CHROMIUM=/usr/lib64/chromium-browser/headless_shell` exported; `~/.cache/ms-playwright` holds no chromium.
