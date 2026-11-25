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
status: pass
first_pass: pass
source: verifier
evidence: sourcepaint.js:326-327 gate on showsTrace; SourceMeter.js:290-292,354-356 bind .sarea/.shold/.strace to the painter; tests ok 936-947 pass (/tmp/gate-make-9n6xoZ1N.log).

### 2. Style table test states which styles show the trace
expected: A test states, style by style, that Trace shows the trace and that Bars, Ridges, Aurora, Fade and Flames do not. (ci: check)
criterion: AC2
status: pass
first_pass: pass
source: verifier
evidence: sourcepaint-section.test.js:434-446 six-row table against showsTrace; ok 930-935 pass.

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
status: pass
first_pass: pass
source: verifier
evidence: test_a_switch_from_trace_to_bars_* and test_a_switch_back_to_trace_* for all three paths, ok 949-956 pass.

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
status: pass
first_pass: pass
source: verifier
evidence: docs/spec/faceplate.md:93 states the trace shows under the Trace style only, whatever the color suite, with the Ridges grid exception.

### 7. Owner's eyes: trace visible under Trace only
expected: At the hand-back URL, under Bars, Ridges, Aurora, Fade and Flames, with the Borealis colors and one other color suite, no trace line, fill or shadow is visible; under Trace all three are visible. (human-verify: needs owner's eyes)
criterion: AC7
status: fail
first_pass: fail
source: verifier
evidence: hqptuner/static/components/faceplate/page/sourcepaint.js:74 (TRACE_STYLES holds only "trace") and :326-327 withhold the trace under Fade. tests/js/components/faceplate-page/sourcepaint-section.test.js:434-446 (fade row false) and :451 (fade in the leaves-empty loop) pin that. docs/spec/faceplate.md:93 states it. The SUMMARY Open items also list hqptuner/static/store/ui/prefs.js:176-178, docs/spec/design-system.md:34-35, todo.txt:18, CONTEXT D-01/D-03/D-04, SPEC-02 and the phase goal wording as carrying the Fade-shows-none rule.
reported: behavior wrong against the owner's ruling. The owner's check at the hand-back URL failed for Fade ('Fade does get a trace. the rest pass.'). The Fade half of SPEC-02, D-01, D-03 and D-04 is the owner's own mistake, so the delivered rule (no SVG trace under Fade) is not what the owner wants. The check also did not name the second color suite AC7 requires besides Borealis.
severity: major
cause: The phase rule itself, not a code defect: CONTEXT D-01, D-03 and D-04 and SPEC-02 say Fade shows no SVG trace, and the code delivers exactly that (hqptuner/static/components/faceplate/page/sourcepaint.js:74 TRACE_STYLES holds only "trace"; :326-327 hands paintTrace no columns when showsTrace is false). The owner's check then ruled "Fade does get a trace", so the rule is what is wrong. Whether that means the SVG trace under Fade, or Fade's own canvas line accepted as is, is not confirmed. The second color suite beside Borealis was also not named in the owner's check. Walk's own suite: scripts/gate.sh make check, exit=0.
fix: routed to /cad-plan

## Summary

total: 7
passed: 6
failed: 1
pending: 0
skipped: 0
blocked: 0
reworked: 1
