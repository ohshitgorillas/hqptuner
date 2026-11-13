---
status: testing
phase: 3
fields_version: 1
started: 2026-11-12
updated: 2026-11-12
---

## Items

### 1. 1x and DSD64 content: lamp dark, menu grays all but none
expected: On a 44.1 kHz source and on a DSD64 source through PCM conversion, the rail HF lamp is unlit for every engaged filter, and every HF menu option except none is grayed
criterion: AC1
status: pass
first_pass: pass
source: verifier
evidence: hf-reach.js:44-52 floor rule; chain.js:225,246; hf.js:35-39,56. Green: chain test_an_engaged_hf_filter_on_a_44_1_source_reads_unlit/_prints_no_value/_is_not_bypassed, test_the_30k_filter_on_a_dsd64_source_converted_to_pcm_reads_unlit; hf test_a_44_1_source_grays_every_option_but_none, test_a_dsd64_source_grays_every_option_but_none; hf-reach 'nothing acts below 50 kHz'.

### 2. 88.2 kHz content: lamp and menu follow the corners
expected: On an 88.2 kHz source the lamp is unlit with 50k or 2x engaged and lit with 20k, 30k or 40k; the menu grays 50k, 2x, 4x and 8x
criterion: AC2
status: pass
first_pass: pass
source: verifier
evidence: Green: chain test_the_50k_filter_on_an_88_2_source_reads_unlit, test_the_30k_filter_on_an_88_2_source_reads_lit, test_a_running_hf_filter_shows_its_engine_name_on_content_it_acts_on; hf test_an_88_2_source_grays_50k_2x_4x_and_8x; hf-reach acting(88200) = [20k,30k,40k].

### 3. 176.4 kHz content: 50k and 2x act
expected: On a 176.4 kHz source the lamp is lit with 50k or 2x engaged; the menu grays 4x and 8x only
criterion: AC3
status: pass
first_pass: pass
source: verifier
evidence: Green: chain test_the_50k_and_2x_filters_on_a_176_4_source_read_lit; hf test_a_176_4_source_grays_4x_and_8x_only; hf-reach acting(176400) = [20k,30k,40k,50k,2x].

### 4. DSD128 content counts at 88.2 kHz
expected: On a DSD128 source through PCM conversion the lamp is lit with 30k engaged and unlit with 50k engaged
criterion: AC4
status: pass
first_pass: pass
source: verifier
evidence: hf-reach.js:31-35 rate/64; chain.js:216 DSD_SOURCE_PATHS. Green: chain test_the_30k_filter_on_a_dsd128_source_converted_to_pcm_reads_lit, test_the_50k_filter_on_a_dsd128_source_converted_to_pcm_reads_unlit, test_direct_sdm_still_marks_the_hf_stage_bypassed.

### 5. Tap on a grayed HF option does nothing
expected: A tap on a grayed HF menu option sends no write and leaves the running filter as it was
criterion: AC5
status: pass
first_pass: pass
source: verifier
evidence: HfFilter.js:64-65 disabled + handler guard. Green: hf-filter test_tapping_a_grayed_row_writes_nothing, test_tapping_a_grayed_row_leaves_the_menu_open, test_a_disabled_row_that_runs_is_still_ticked.

### 6. Gate green
expected: scripts/gate.sh make check prints exit=0
criterion: AC6
status: pass
first_pass: pass
source: verifier
evidence: /tmp/gate-make-tGjGFIJH.log at 9c221f42 code: pytest 3664 passed, JS 5435 pass 0 fail, reaches end of test-js; only .planning/ changed since. Verifier did not re-run make check per dispatch.

### 7. Grayed HF rows render dead in the browser
expected: At the hand-back URL, non-acting HF menu rows show in dead ink with no badge or text, and the rail HF lamp is lit only on content the engaged filter acts on
status: pass
first_pass: fail
source: model
evidence: HQPTUNER_CHROMIUM=/usr/lib64/chromium-browser/headless_shell scripts/gate.sh .venv/bin/pytest -m e2e tests/e2e/test_hf_menu_dead_rows_look_dead.py -> exit=0, 3 passed at bf2f5a4c (dead ink, plain cursor, no hover wash, each against an observed look); red by assertion with header.css:74-75 reverted. No badge/text: hf-filter.test.js (no title); rail lamp per content: chain/rail suites (items 1-4), not repeated in e2e per testing.md rule 15.
reported: uncovered acceptance requirement: no automated check exercises it. The CSS rule exists and wins the cascade on static reading, but nothing observes the computed color, cursor or hover background of a disabled .hfpop .pmrow, or the rendered rail lamp, in a browser.
severity: minor
cause: No automated check exists for the rendered look. Phase 3 pinned the disabled attribute and the tap guard in the jsdom suite (tests/js/components/faceplate/hf-filter.test.js) but added no browser-lane test, although tests/e2e/ (playwright against the stack's HTTP and control fakes, no live daemon) is the repo's lane for computed style. So the dead ink, plain cursor and absent hover wash of header.css:74-75, and the rendered rail HF lamp per content rate, are unobserved.
fix: bf2f5a4c, retest

## Summary

total: 7
passed: 7
failed: 0
pending: 0
skipped: 0
blocked: 0
reworked: 1
