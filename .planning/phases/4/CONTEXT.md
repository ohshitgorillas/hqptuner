# Phase 4: PCM filters in SDM output mode - Context

Gathered: 2026-11-11

Feeds: /cad-plan 4

## Scope boundary

In: while the output mode is SDM, applying one of the SDM chain's filters for PCM sources (`sdm_filter_1x`, `sdm_filter_nx`; wire `filter1x`, `filter`) does not reset the engine, from every surface that writes them: the Resampling drawer's SDM tab ("PCM sources" rows), the page filter pick, the bottom switcher, and Filter presets / Easy Mode. The cause of the reset is found and recorded before the fix lands.

Out: the drawer's idle "PCM out" tab (`pcm_filter_1x`, `pcm_filter_nx` picked while SDM runs), which still falls to `POST /restore` and restarts the engine; any live probe of the production daemon; any change to PCM output mode's filter apply.

Deferred: the idle "PCM out" tab in SDM mode restarts the engine through `POST /restore` and its row carries no restart mark (`hqptuner/fields/register.py:357-366`, `hqptuner/core/pending.py:60-97`); out of this phase by owner choice, for a later phase or task.

Plan shape: one plan (owner: right-sized).

## Durable decisions

None this phase.

## Decisions

- D-01 (meaning): "PCM filters in SDM output mode" are the SDM chain's filters for PCM sources, `sdm_filter_1x` and `sdm_filter_nx`, set on the loaded chain; not the idle PCM output chain. Every surface that writes them is in scope. Evidence: owner ruling 2026-11-11 (rejected the idle-chain reading as "false"); `hqptuner/static/components/faceplate/drawers/modes.js:57-60`, `hqptuner/static/store/faceplate/bottom/switcher.js:59-60`, `hqptuner/static/store/easy/easy.js:47`, `hqptuner/static/store/live/derive.js:80-81`.
- D-02 (scope edge): the idle "PCM out" tab's restore restart in SDM mode is out of scope and goes under Deferred; the tests that pin it (`tests/live/test_live_apply_split.py:127-141`, `tests/live/test_live_mode_first.py:82-87`) and the spec rows they implement (`docs/spec/settings-truth.md:53,79`) stay as they are. Evidence: owner confirmation 2026-11-11; `hqptuner/lanes/live/routing.py:107-150`.
- D-03 (cause evidence): the cause is found from the code and a red test on the fake 4321 and 8088 daemons, never from a live probe of the production daemon or from matching hqplayerd journal times; the owner does not recall the symptom, so the code is the only evidence. The cause is recorded in a commit before the fix lands. Evidence: owner answer 2026-11-11 ("Don't remember"); `tests/live/test_live_mode_first.py:15-31`, `tests/support/fake_http.py:252`, repo `CLAUDE.md` prime directive, `~/dev/CLAUDE.md` 6.1.
- D-04 (suspects): the cause step checks three paths: the live `SetFilter` write from the page pick, switcher and Easy surfaces (`POST /api/config/live`); the drawer's staging slot, where `stagedSlot` files a served-live key with no `liveKey` under `""`, so a stage either 422s (`fields_unknown`) or lands cross-chain; and any path that falls through to the restore lane. Evidence: `hqptuner/static/store/schema/dsp.js:44-73`, `hqptuner/static/store/actions.js:64,98-158`, `hqptuner/api/routes/pending.py:44-56`, `hqptuner/core/applyops.py:157-197`, `hqptuner/lanes/live/lane.py:240-270`, `hqptuner/engine/view.py:203-231`.
- D-05 (no reset): applying such a filter in SDM mode behaves as a PCM-mode filter apply does today: the only engine write is `SetFilter` on the loaded chain, with no `POST /restore`, no config form POST and no `SetMode`. Evidence: `hqptuner/lanes/live/routing.py:72-92`, `docs/spec/settings-classification.md:56-57`.
- D-06 (PCM mode): applying a filter in PCM output mode stays as it is today; the existing tests at `tests/live/test_live_apply_split.py:91-110` guard it unedited. Evidence: `hqptuner/lanes/live/routing.py:72-92` (`_complete_filter_pair`).
- D-07 (tests): tests are written first and bite red before the fix, through the fake daemons of `tests/live/test_live_*` and the JS staging wire `tests/js/support/wire/wire.js`, at whichever unit shows the cause; no wall-clock wait. Evidence: phase 2 D-09, `docs/spec/testing.md` rules 8 and 15, repo `CLAUDE.md` tests-first rule.

## Acceptance criteria

- [ ] AC1: A commit on `v2` names the path that reset the engine. A test that reproduces the reset on the fake daemons fails at the commit before the fix, and it lands before the fix does.
- [ ] AC2: With the fake daemon in SDM mode, a filter picked on the drawer's SDM-tab "PCM sources" rows is staged by `POST /api/config/stage` with no 422, and Apply then sends exactly one `SetFilter` and no `POST /restore`, no config form POST and no `SetMode`.
- [ ] AC3: With the same SDM setup, applying `sdm_filter_1x` or `sdm_filter_nx` through `POST /api/config/live` (page pick, bottom switcher, Filter presets / Easy) sends exactly one `SetFilter` and no `POST /restore` and no `SetMode`.
- [ ] AC4: In PCM output mode, applying `pcm_filter_1x` or `pcm_filter_nx` sends `SetFilter` as it does today, and the existing tests in `tests/live/test_live_apply_split.py:91-110` pass with no edits.
- [ ] AC5: `scripts/gate.sh make check` prints `exit=0` at the phase's last commit.

## Flagged assumptions

- Whether `SetFilter` on the SDM chain with a PCM source playing (hqplayerd 6.0.4) itself stops playback or restarts the modulator is undocumented (`hqp_find SetFilter`: 0 hits in the manual, manual-facts and readme); only an owner-run, idle-gated live probe answers it - Unclear; if wrong: D-05's single `SetFilter` is itself the reset, and the fix needs another shape taken back to the owner.
- No Control API command sets the chain that is not loaded; HQPlayer's docs are silent - Likely; if wrong: the deferred "PCM out" tab has a no-restart path this phase did not use.
- The hqplayerd SEGV/ABRT core dumps of Oct 11-15 (`journalctl -u hqplayerd`) are unrelated to this defect - Likely; if wrong: the "reset" was a daemon crash, and no HQPTuner path reproduces it on the fake daemons.
- The frontend's dead `report.stored` branch (`hqptuner/static/store/live/write.js:47-58`) stays dead; holding a dormant-chain edit for replay is forbidden by `docs/spec/settings-truth.md:75,176-181` - Confident; if wrong: the plan revives a v1 hold without a spec.
