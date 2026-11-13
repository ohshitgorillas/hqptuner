---
status: testing
phase: 2
fields_version: 1
started: 2026-11-11
updated: 2026-11-11
---

## Items

### 1. Above-floor modulators grayed at DSD256 on every picker
expected: With DSD256 (11289600) the output rate in force, every modulator whose floor is above 11289600 (e.g. ASDM7EC-fast 512+fs, AHM7EC8B) is grayed, its tier badge as the reason, in the chain picker, Switcher slot, drawer and Snapshot builder lists, and a tap on it sends no write.
criterion: AC1
status: pass
first_pass: pass
source: verifier
evidence: options.js:93-132 gate in listOptions; Rows.js:67-76 aria-disabled with no onClick; switcher.js:177,277 slot disabled with no write; rate-floor.test.js, rate-floor-row.test.js, rate-floor-surfaces.test.js (all four surfaces under DSD256 12288000), switcher-rate-floor.test.js all pass (scripts/gate.sh node --test, 50/50, exit=0).

### 2. At-or-below-floor modulators stay pickable and apply live
expected: In the same DSD256 state, a modulator whose floor is at or below 11289600 (e.g. a 256+fs modulator at 10240000) is not grayed, and picking it applies it live.
criterion: AC2
status: pass
first_pass: pass
source: verifier
evidence: rate-floor.test.js floor-equal and floor-below cases not grayed; rate-floor-row.test.js test_tapping_a_row_at_the_floor_hands_its_name_to_the_pick; conversion.test.js test_a_pick_from_the_list_writes_its_enum_id_live and switcher.test.js:320 POST /api/config/live; all pass.

### 3. A live apply that stopped playback reports as failed
expected: A live apply through /api/config/live or a live snapshot apply during which State.state goes from 2 to 0 or 3 reports playback_stopped and the UI shows a failed apply reading "HQPlayer stopped playback while applying this.", not ok.
criterion: AC3
status: pass
first_pass: pass
source: verifier
evidence: lane.py:176-184,216-220 detection and preset OR; routes return the report intact (apply.py:196, livepreset.py:160, livesnapshots.py:215); test_live_stop_report.py 9 passed; state.js:46 + wirelabels.js:51 line, wired through write.js:115 and presets.js:135; live-stop.test.js 8/8 pass.

### 4. A live apply while not playing reports no stop
expected: A live apply made while State.state is not 2 reports playback_stopped false and no stop line.
criterion: AC4
status: pass
first_pass: pass
source: verifier
evidence: test_live_stop_report.py cases with before STOPPED, PAUSED, STOP_REQUESTED assert playback_stopped False and pass; live-stop.test.js no-stop cases do not fail the op.

### 5. make check is green
expected: scripts/gate.sh make check prints exit=0.
criterion: AC5
status: pass
first_pass: pass
source: model
evidence: PYTHONPATH=$(pwd) scripts/gate.sh make check at 2678dd79 (main session) -> exit=0 log=/tmp/gate-make-iRvjGwUF.log, coverage all files 97.21%

### 6. A grayed remembered Switcher slot shows its tier badge reason under Standard names
expected: behavior wrong - under Standard names the slot face draws no tier badge, so a grayed slot for a modulator whose engine name carries no rate (AHM7EC8B) shows no reason, unlike the grayed list row; no automated check exercises the slot face's reason
origin: verifier
status: skipped
first_pass: fail
source: model
evidence: hqptuner/static/store/faceplate/page/conversion.js:107-108 (plainOf under Standard: fam "", tier ""); hqptuner/static/components/faceplate/NameFace.js:77-80 (TierMark only in the family line, skipped when fam is empty); hqptuner/static/components/faceplate/bottom/Switcher.js listFace passes s.tier; tests/js/store/faceplate/switcher-rate-floor.test.js has no badge assertion.
reported: ok the entire slot doesn't and should not read "Unavailable etc" ... yes, it can't be selected. / no and I'm glad it's not tbh
severity: minor
cause: Under Standard names plainOf (conversion.js:107-108) returns fam "" and tier "", and NameFace (NameFace.js:77-80) draws TierMark only inside the family line, skipped when fam is empty; the Switcher slot face (Switcher.js:132) therefore shows a grayed remembered modulator with no badge, while list rows draw TierMark unconditionally (Rows.js marks). switcher-rate-floor.test.js asserts the gray but not the badge.
fix: 470474b0 reverted in e4729ea0, owner ruling
reason: Owner ruling at retest: a grayed Switcher slot keeps its modulator name, cannot be selected, and shows no reason text; the slot-reason fix 470474b0 was reverted in e4729ea0.

## Summary

total: 6
passed: 5
failed: 0
pending: 0
skipped: 1
blocked: 0
reworked: 1
