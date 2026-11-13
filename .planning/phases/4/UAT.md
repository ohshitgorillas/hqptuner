---
status: testing
phase: 4
fields_version: 1
started: 2026-11-12
updated: 2026-11-12
---

## Items

### 1. Plate dims while HQPlayer is away
expected: With the health phase Down or Alarm, including HQPlayer going away on its own (crash, foreign restart), the whole plate shows dimmed at the same look as the restart dim
status: pass
first_pass: pass
source: model
evidence: PYTHONPATH=$(pwd) scripts/gate.sh make check -> exit=0 (JS 5443 pass 0 fail): conn.test.js test_a_down_engine_reads_away, test_an_alarmed_engine_reads_away ok; plate-away.test.js test_the_plate_carries_the_away_mark_while_hqplayer_is_down ok. scripts/gate.sh .venv/bin/pytest tests/e2e/test_plate_dims_while_hqplayer_away.py -v -> 3 passed: test_the_plate_looks_dimmed_while_the_lane_is_away (lane severed through the control fake, not an own write; computed opacity below the before look). base.css:14 `.plate[data-restarting],.plate[data-away]{opacity:var(--op-2)}` - one rule, same look.

### 2. Plate undims once HQPlayer is back
expected: With the health phase back at Reachable or Ready, the plate is no longer dimmed, with no page reload; no health reading yet does not dim
status: pass
first_pass: pass
source: model
evidence: make check exit=0: conn.test.js test_a_reachable_engine_does_not_read_away, test_a_ready_engine_does_not_read_away, test_no_health_reading_yet_does_not_read_away, test_a_write_in_flight_on_a_ready_engine_does_not_read_away ok; plate-away.test.js test_the_plate_carries_no_away_mark_once_hqplayer_is_back ok. e2e test_the_plate_looks_as_it_did_once_the_lane_is_back PASSED (same page, no reload, opacity equals the before look).

### 3. Every action proceeds while dimmed
expected: While the plate is dimmed for HQPlayer away, a control still takes a tap and its action proceeds; no pointer-events, inert, disabled or aria-disabled on the dim
status: pass
first_pass: pass
source: model
evidence: e2e test_a_tap_while_the_lane_is_away_starts_its_action PASSED: with the lane away, tap Settings then the logging category, #drawer-logging becomes visible. grep -n 'pointer-events|inert|aria-disabled' base.css Plate.js -> no hits.

### 4. Restart dim unchanged
expected: The plate still dims for a write that takes the daemon down, an all-live apply still does not dim, and plate-restarting.test.js is unedited and green
status: pass
first_pass: pass
source: model
evidence: git diff 36709b23 --stat -- tests/js/components/faceplate/plate-restarting.test.js -> empty; make check exit=0 with test_the_plate_carries_the_restarting_mark_while_the_engine_restarts, test_apply_and_save_of_a_live_only_change_does_not_dim_the_page_for_a_restart (ok 4202), test_apply_and_save_of_a_change_that_restarts_the_engine_dims_the_page (ok 4203) green.

## Summary

total: 4
passed: 4
failed: 0
pending: 0
skipped: 0
blocked: 0
reworked: 0
