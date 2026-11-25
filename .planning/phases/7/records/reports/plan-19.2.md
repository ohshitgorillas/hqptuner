PLAN CHECKPOINT: human-verify

Plan: .planning/phases/7/PLAN-19.md

Tasks: 1 of 2

| Task | Commit | Note |
|---|---|---|
| 1 - Every gate and suite stands where the phase leaves it | none (nothing to commit) | threshold unchanged at 0.18; all four Verify items met (first dispatch, record in plan-19.1.md) |
| 2 - The owner sees the reshaped surfaces on the rebuilt dev build | none | build rebuilt and serving, own captures read; CHECKPOINT human-verify: the owner's look at items 8, 9, 10 is outstanding |

## Task 2 evidence

Owner's ruling on the rebuild, verbatim: "okay, commit past them so I can see and tell me what I'm looking for." Read by the coordinator as: rebuild `hqptuner:dev` past the red `make check`, through task-check steps 2 and 3. `task-check.sh` not edited, no test edited, nothing exempted, 12 phase 8 playhead tables left red.

Rebuild: steps 2 and 3 of `.claude/task-check.sh` replayed by `/tmp/plan19-rebuild.sh` (same trigger file, same result-file nonce match, same `:8090` poll). Result: `status=0`, `health=200`. HEAD at rebuild 81efbfd7. Hand-back URL http://10.0.0.238:8090 (local http://127.0.0.1:8090).

The daemon was idle (`State state="0"`, no track) at capture time, so no real music was heard. Nothing was started on hqplayerd. Moving surfaces were captured on a headless browser that replays the committed capture (`tests/support/fixtures/meter_feed_capture.json`, looped) in place of the meter feed and patches State/Status to "playing" inside that browser only. Each surface was captured on two builds side by side: the rebuilt tree and the tree at 5aa4aa41 (before phase 7), the latter served from a temporary local proxy (PID 516729, killed, verified with `ps -p`) that serves the old static files and forwards `/api` to the live container read-only (GET only).

Results (all captures in `/tmp/plan19-snaps/`):

- Item 8: trace, bars, ridges, aurora, fade, fire, each clipped to the Source panel, `style-<name>-a.png` and `-b.png` (1.3 s apart; shapes and peak marks differ between them, so each moves). Equal-clock A/B: for trace, bars, ridges, aurora and fade the set of frames the two builds produce overlap pixel for pixel (`ab-<style>-now|before-<i>.png`); fire draws from `Math.random` so its flames differ by design, its envelope, grid and trace match. VU meters: `vu-now-0.png`. Level bars and the L/R peak marks move in `plate-playing-0.png` vs `-1.png`.
- Item 9: Source drawer spectrogram, `drawer-now-0.png` vs `drawer-before-0.png`. In real time it grows 40 columns per second (33, 73, 114 ... 596 lit columns at 1 s steps, matching 1200 columns over 30 s). Column scan of the painted canvas at 25 s: no dark dip inside the painted run in either build (the only dip is at the left edge where the music starts, same in both). A 3x crop of the right 400 px, `drawer-zoom-now.png`, is pixel-identical to the before build.
- Item 10: 61 popovers on the plate and in all nine rail drawers (stations, HF filter, Display, Filter presets, apply menu, Import EQ, setting switcher menu, see-more notes) opened on both builds: panel and trigger boxes equal to the pixel in every case, 60 of 61 screenshots byte-identical (the 61st, Import EQ, differs only in its list text, "loading..." in one load against the model count in the other, a load race). Visual settings drawer, `view-settings-now.png` vs `-before.png`: byte-identical. Matrix profile view (page top set to the profile through the browser's own storage), `view-profile-now.png` vs `-before.png`: byte-identical.

Not reachable on this idle live daemon: the volume panel (its trigger is disabled, the engine pins the volume), an alert note (no alert raised), the pipeline `+` menus and a facet list's panels. Those are held by the browser suite that passed in Task 1.

## Observations that are not the phase's (same on the before build)

- On every page load the console logs `<circle> attribute cx: Expected length, "-Infinity"`, `<path> attribute d: Expected number, "M28 NaN L29.9 NaN ..."` and `<text> attribute y: Expected length, "NaN"`. Located to the Loudness drawer's response plot and range bar (`class="trace"`, `circle.hdl`, text "0% applied") by a setAttribute trap. Identical on the 5aa4aa41 build and in files phase 7 never touched (`git diff 5aa4aa41 HEAD` lists none under `drawers/loudness/`).
- The Import EQ popover (`pop pimp`) shows the paragraph behind it through its box (see `pop2-pipelines-pl-import-now.png`); the panel is not opaque. Identical on the before build.

## Blocking question for the owner

None beyond the human-verify itself: the owner reports for items 8, 9 and 10 whether the surface looks and moves as it did before the phase. A surface the owner says differs is a defect report and goes back to planning, never a pass.

Deviations: none

Open items:

- Gate-conduct slip, first dispatch: the first `make check` run was piped into `tail -40` (repo rule: a gate is never piped). `scripts/gate.sh` still kept the whole log; every conclusion was read from it.
- `make test-e2e` needs `hqpcreds` sourced (`HQPTUNER_CHROMIUM`); it runs about 644 s, over the 600 s tool watchdog, so it was run detached.
- Verify item (2) wording "fails at 0.01 below": at 0.17 the python run exits 1 as required.
- The rebuild went past the red `make check` step on the owner's ruling above; `make check` is still red on the 12 phase 8 playhead tables (UAT item 13).
- Console NaN/Infinity SVG attributes in the Loudness drawer and the non-opaque Import EQ panel, both pre-existing (see Observations); not touched here.
