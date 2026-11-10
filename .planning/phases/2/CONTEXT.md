# Phase 2: Modulators fit the output rate - Context

Gathered: 2026-11-09

Feeds: /cad-plan 2

## Scope boundary

In: every modulator list grays the modulators whose floor is above the current output rate, so they cannot be picked; modulators the current output rate supports stay pickable and apply live; a live apply after which playback stopped is reported as a failed apply, not ok.

Out: the output rate menu and its device-caps graying (the device's announced rates cap which output rates can be selected, already handled by `hqptuner/engine/devicecaps.py` and `hqptuner/static/store/narrow/devicecaps.js`, unchanged here); the Shaping-stage alert in `hqptuner/static/store/alerts/shaperfit.js`; the v1 `grayShapersByRate` path.

Deferred: None

Plan shape: not settled; the owner stopped the size question, so the split into one or several plans is the planner's call.

## Durable decisions

- D-01 (rate gate): the current output rate caps which modulators can be selected; the device's announced rates cap which output rates can be selected. The two caps are separate, and modulators are never judged against the device's announced rates. Evidence: owner ruling 2026-11-09; `hqptuner/engine/devicecaps.py:1-13`, `todo.txt:16`.
- D-02 (stop report): a live apply after which playback stopped is a failed apply and is reported to the user as a failure, not as a success with a side note. Evidence: owner ruling 2026-11-09; `todo.txt:16`; `hqptuner/static/store/live/write.js:108-124` (silence reads as ok today).

## Decisions

- D-03 (floor source): a modulator's floor is `min_rate_hz` from `hqptuner/data/shapers.json` (`sdm_modulators`), joined by engine name; the engine's `GetShapers` enumeration carries only index, name and value. A floor above the current output rate grays the modulator; a floor equal to it does not. Evidence: `docs/spec/protocol.md` (GetShapers), `hqptuner/data/shapers.json`, `hqptuner/data/engine-enums.json` (36 of 36 names join), `hqptuner/static/store/ui/options.js:28-42`.
- D-04 (defect site): the v2 faceplate list has no graying today; the gate lands in the faceplate list store (`narrowedOptions`/`listOptions`) and its `Row`, not in `grayShapersByRate`/`chainOptions` alone. Evidence: `hqptuner/static/store/faceplate/lists/options.js:41-43,86-103,123-133`, `hqptuner/static/model/shell/option-list.js:29-40`, `hqptuner/static/components/faceplate/lists/Rows.js:62-82`.
- D-05 (grayed, not hidden): an unsupported modulator stays listed, grayed with a reason, and a tap on it does nothing. Evidence: `hqptuner/data/shapers.json` `_comment`, `tests/js/store/guards/shaperfit-graying.test.js:5-8`.
- D-06 (one list): the chain picker, the Setting Switcher slot, the drawer nameplate and the Snapshot builder all show the same gated list; the lists never diverge. Evidence: owner ruling 2026-11-09; they share `narrowedOptions` (`hqptuner/static/components/faceplate/page/ChainPick.js:22`, `hqptuner/static/store/faceplate/bottom/switcher.js:263-305`, `hqptuner/static/components/faceplate/drawer/controls.js:143-152`, `hqptuner/static/components/faceplate/builders/SnapshotRows.js:73-87`).
- D-07 (copy): the grayed row's reason text and the stop failure line are owner-approved copy, verbatim, no em dash; the v1 `needs ≥ …` string is not reused unasked. Evidence: `CLAUDE.md` copy rule, `hqptuner/static/store/ui/options.js:39`.
- D-08 (stop detection): the stop is detected once, in the backend batch `_apply_batch`, from the `State` re-read `refresh_after_live` already makes after every live batch, so `/api/config/live`, live snapshot apply and autopilot all carry it on `LiveApplyReport`; no settle window. A stop means `State.state` was 2 (playing) before the batch and is 0 (stopped) or 3 (stop requested) after it. Evidence: owner ruling 2026-11-09 ("already covered by existing code"); `hqptuner/lanes/live/lane.py:101-166`, `docs/spec/protocol.md` State table.
- D-09 (tests): tests go through the existing seams, red first: JS list tests through `tests/js/support/listsfixture.js`, the backend stop report through the fake 4321 daemon of `tests/live/test_live_*`; no wall-clock wait. Evidence: `tests/js/store/faceplate-lists/rate-cap.test.js`, `tests/live/test_live_after_write_reads.py`, `docs/spec/testing.md` rules 4, 7, 8, 13, 15.

## Acceptance criteria

- [ ] AC1: With DSD256 (11289600) the current output rate, every modulator whose floor is above 11289600 (e.g. ASDM7EC-fast 512+fs at 22579200, AHM7EC8B at 40960000) is grayed with a reason in the chain picker, Switcher slot, drawer and Snapshot builder lists, and tapping it sends no write.
- [ ] AC2: In that same state, a modulator whose floor is at or below 11289600 (e.g. a 256+fs modulator at 10240000) is not grayed, and picking it applies it live.
- [ ] AC3: A live apply, through `/api/config/live` or a live snapshot apply, during which `State.state` goes from 2 to 0 or 3 is reported to the user as a failure, not ok.
- [ ] AC4: A live apply made while playback is not playing reports no stop.
- [ ] AC5: `scripts/gate.sh make check` prints `exit=0`.

## Flagged assumptions

- Which reading is "the current output rate" (the selected output rate in force, versus `active_rate` from Status, versus the configured SDM rate limit `sdm_rate`) is the planner's to locate; the owner's rule is "follow the selected rate", and at DSD256 no modulator with a 512x floor or above may be selectable - Likely; if wrong: the gate judges a rate other than the one in force and AC1 fails on the reported case.
- What the list grays while no SDM output rate is in force (PCM output, stopped, rate on auto, or a missing or 0 reading) is unsettled; modulators are not judged against the device's announced rates in that case either (D-01) - Unclear; if wrong: a stale or PCM rate grays every floored modulator, or none.
- `active_rate` while stopped or paused (0, absent, or the last rate) was not measured; only one playing sample was taken (2026-11-10 04:20 UTC: `active_rate=24576000`, `State.rate="0"`) - Unclear; if wrong: the idle case above resolves against a value the planner assumed.
- One post-write `State` read sees the stop (D-08, owner: "already covered by existing code"); the stop's timing after an above-floor modulator write mid-play was not reproduced, since that stops live playback on Opal - Likely; if wrong: AC3 needs a settle window on an injectable clock.
