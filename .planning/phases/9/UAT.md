---
status: testing
phase: 9
fields_version: 1
started: 2026-11-25
updated: 2026-11-25
---

## Items

### 1. No trace under Bars, Ridges, Fade or Flames
expected: With the spectrum style set to Bars, Ridges, Fade or Flames, a paint of a playing frame leaves the three trace paths (.strace, .sarea, .shold) in the page Source section with no drawing. (ci: check)
criterion: AC1
status: skipped
first_pass: pass
source: verifier
evidence: sourcepaint.js:326-327 gate on showsTrace; SourceMeter.js:290-292,354-356 bind .sarea/.shold/.strace to the painter; tests ok 936-947 pass (/tmp/gate-make-9n6xoZ1N.log).
reason: Superseded by the reworded criterion after the owner's Fade ruling; replaced by items 8 to 12. Skipped by owner decision at /cad-verify 2026-11-25.

### 2. Style table test states which styles show the trace
expected: A test states, style by style, that Trace shows the trace and that Bars, Ridges, Aurora, Fade and Flames do not. (ci: check)
criterion: AC2
status: skipped
first_pass: pass
source: verifier
evidence: sourcepaint-section.test.js:434-446 six-row table against showsTrace; ok 930-935 pass.
reason: Superseded by the reworded criterion after the owner's Fade ruling; replaced by items 8 to 12. Skipped by owner decision at /cad-verify 2026-11-25.

### 3. Trace style draws line, area and shadow
expected: With the spectrum style set to Trace, a paint of a playing frame draws the line, the filled area and the shadow. (ci: check)
criterion: AC3
status: pass
first_pass: pass
source: verifier
evidence: test_under_trace_a_playing_paint_draws_the_{trace,area,shadow}, ok 948/951/954 pass.

### 4. Switching styles drops and restores the trace
expected: After a switch from Trace to another style, the next paint leaves no trace; after a switch back, the next paint draws it. (ci: check)
criterion: AC4
status: skipped
first_pass: pass
source: verifier
evidence: test_a_switch_from_trace_to_bars_* and test_a_switch_back_to_trace_* for all three paths, ok 949-956 pass.
reason: Superseded by the reworded criterion after the owner's Fade ruling; replaced by items 8 to 12. Skipped by owner decision at /cad-verify 2026-11-25.

### 5. No stepped-view case reads the trace under a non-Trace style
expected: tests/js/store/meter/spectrum-motion.test.js holds no case that reads the SVG trace under a style other than Trace.
criterion: AC5
status: pass
first_pass: pass
source: verifier
evidence: e1098576 removed STEPPED_VIEWS and the view parameter; spectrum-motion.test.js:110 pins TRACE; only the five Trace cases remain, ok 5080-5084.

### 6. Faceplate spec states the trace rule
expected: docs/spec/faceplate.md states that the trace shows under the Trace style only.
criterion: AC6
status: skipped
first_pass: pass
source: verifier
evidence: docs/spec/faceplate.md:93 states the trace shows under the Trace style only, whatever the color suite, with the Ridges grid exception.
reason: Superseded by the reworded criterion after the owner's Fade ruling; replaced by items 8 to 12. Skipped by owner decision at /cad-verify 2026-11-25.

### 7. Owner's eyes: trace visible under Trace only
expected: At the hand-back URL, under Bars, Ridges, Aurora, Fade and Flames, with the Borealis colors and one other color suite, no trace line, fill or shadow is visible; under Trace all three are visible. (human-verify: needs owner's eyes)
criterion: AC7
status: skipped
first_pass: fail
source: verifier
evidence: hqptuner/static/components/faceplate/page/sourcepaint.js:74 (TRACE_STYLES holds only "trace") and :326-327 withhold the trace under Fade. tests/js/components/faceplate-page/sourcepaint-section.test.js:434-446 (fade row false) and :451 (fade in the leaves-empty loop) pin that. docs/spec/faceplate.md:93 states it. The SUMMARY Open items also list hqptuner/static/store/ui/prefs.js:176-178, docs/spec/design-system.md:34-35, todo.txt:18, CONTEXT D-01/D-03/D-04, SPEC-02 and the phase goal wording as carrying the Fade-shows-none rule.
reported: behavior wrong against the owner's ruling. The owner's check at the hand-back URL failed for Fade ('Fade does get a trace. the rest pass.'). The Fade half of SPEC-02, D-01, D-03 and D-04 is the owner's own mistake, so the delivered rule (no SVG trace under Fade) is not what the owner wants. The check also did not name the second color suite AC7 requires besides Borealis.
severity: major
cause: The phase rule itself, not a code defect: CONTEXT D-01, D-03 and D-04 and SPEC-02 say Fade shows no SVG trace, and the code delivers exactly that (hqptuner/static/components/faceplate/page/sourcepaint.js:74 TRACE_STYLES holds only "trace"; :326-327 hands paintTrace no columns when showsTrace is false). The owner's check then ruled "Fade does get a trace", so the rule is what is wrong. Whether that means the SVG trace under Fade, or Fade's own canvas line accepted as is, is not confirmed. The second color suite beside Borealis was also not named in the owner's check. Walk's own suite: scripts/gate.sh make check, exit=0.
fix: routed to /cad-plan
reason: Superseded by the reworded criterion after the owner's Fade ruling; replaced by items 8 to 12. Skipped by owner decision at /cad-verify 2026-11-25.

### 8. No trace under Bars, Ridges or Flames
expected: With the spectrum style set to Bars, Ridges or Flames, a paint of a playing frame leaves the three trace paths (.strace, .sarea, .shold) in the page Source section with no drawing. (ci: check)
criterion: AC1
status: pending_ci
job: check
commit: f78d9af01de81d70585b2f343224a902be98d7f2
source: model
evidence: tests/js/components/faceplate-page/sourcepaint-section.test.js:459-472, test_under_{bars,ridges,fire}_a_playing_paint_leaves_the_{trace,area,shadow}_empty, ok 948-953 and 956-958. Local run: scripts/gate.sh make check, exit=0, # pass 5552 # fail 0 (/tmp/gate-make-FH9TXJCm.log). CI job check has not run at this commit.

### 9. Style table test states which trace parts each style shows
expected: A test states, style by style, which parts of the trace show: Trace the line, the filled area and the shadow; Fade the line alone (owner ruling 3a672f27); Bars, Ridges, Aurora and Flames none. (ci: check)
criterion: AC2
status: pending_ci
job: check
commit: f78d9af01de81d70585b2f343224a902be98d7f2
source: model
evidence: sourcepaint-section.test.js:436-453, six-row table against tracePartsOf, fade row line only, ok 930-947. Local run: scripts/gate.sh make check, exit=0, # pass 5552 # fail 0 (/tmp/gate-make-FH9TXJCm.log). CI job check has not run at this commit.

### 10. Switching from Trace to a traceless style drops the trace, switching back restores it
expected: After a switch from Trace to Bars, Ridges or Flames, the next paint leaves no trace; after a switch back, the next paint draws it. (ci: check)
criterion: AC4
status: pending_ci
job: check
commit: f78d9af01de81d70585b2f343224a902be98d7f2
source: model
evidence: sourcepaint-section.test.js:487-498, test_a_switch_from_trace_to_bars_* and test_a_switch_back_to_trace_* for all three paths, ok 961-962, 964-965, 967-968; Ridges and Flames leave every path empty by the per-style cases ok 951-958. Local run: scripts/gate.sh make check, exit=0, # pass 5552 # fail 0 (/tmp/gate-make-FH9TXJCm.log). CI job check has not run at this commit.

### 11. Faceplate spec states which trace parts show under which style
expected: docs/spec/faceplate.md states which parts of the trace show under which style: Trace whole, Fade the line alone, every other style none.
criterion: AC6
status: pass
first_pass: pass
source: model
evidence: sed -n 93p docs/spec/faceplate.md: 'The trace (its line, the filled area under it and its slower-falling shadow) shows whole under the Trace style, and its line alone, without the filled area or the shadow, under Fade; under every other style the spectrum draws no trace.'

### 12. Owner's eyes: trace parts by style at the hand-back URL
expected: At the hand-back URL, with the Borealis colors and one other color suite: under Bars, Ridges, Aurora and Flames no trace line, fill or shadow is visible; under Fade the line alone is visible (owner ruling 3a672f27); under Trace all three are visible. (human-verify: needs owner's eyes)
criterion: AC7
status: skipped
reported: I have seen and approve of the final results.
reason: Owner made this item optional at /cad-verify 2026-11-25: no automated check exists (Aurora needs WebGL2); owner's words: 'I have seen and approve of the final results.'

### 13. Fade draws the trace's line alone
expected: With the spectrum style set to Fade, a paint of a playing frame draws the line and leaves the filled area (.sarea) and the shadow (.shold) with no drawing (owner ruling 3a672f27). (ci: check)
criterion: AC8
status: pending_ci
job: check
commit: f78d9af01de81d70585b2f343224a902be98d7f2
source: model
evidence: sourcepaint-section.test.js:474 test_under_fade_a_playing_paint_draws_the_trace ok 959; test_under_fade_a_playing_paint_leaves_the_{area,shadow}_empty ok 954-955. Local run: scripts/gate.sh make check, exit=0, # pass 5552 # fail 0 (/tmp/gate-make-FH9TXJCm.log). CI job check has not run at this commit.

### 14. Fade's halo fades out at every paint rate
expected: Under Fade, the halo dies away over the same time whatever the paint rate; a test pins it. (ci: check)
status: pending_ci
job: check
commit: f78d9af01de81d70585b2f343224a902be98d7f2
source: model
evidence: tests/js/model/gauges/meter/steps.test.js test_a_halo_on_an_8_bit_canvas_fades_as_far_at_fast_paints_as_at_slow_ones ok 2162; test_fade_halo_moves_as_far_over_a_stretch_whether_it_comes_as_one_paint_or_many ok 2157. Local run: scripts/gate.sh make check, exit=0, # pass 5552 # fail 0 (/tmp/gate-make-FH9TXJCm.log). CI job check has not run at this commit.

### 15. Fade's halo follows a change of color suite
expected: Under Fade, after a change of color suite or accent the halo starts clear, so no halo in the old colors stays on the plot; a test pins it. (ci: check)
status: pending_ci
job: check
commit: f78d9af01de81d70585b2f343224a902be98d7f2
source: model
evidence: tests/js/components/faceplate-page/spectrumfx-fx.test.js test_a_change_of_suite_leaves_nothing_of_the_fade_halo_drawn_in_the_suite_before ok 999; test_under_accent_a_fade_paint_follows_a_change_of_accent ok 984. Local run: scripts/gate.sh make check, exit=0, # pass 5552 # fail 0 (/tmp/gate-make-FH9TXJCm.log). CI job check has not run at this commit.

## Summary

total: 15
passed: 3
failed: 0
pending: 0
pending_ci: 6
skipped: 6
blocked: 0
reworked: 1
