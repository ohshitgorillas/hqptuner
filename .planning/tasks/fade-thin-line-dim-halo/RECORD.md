# Task: fade-thin-line-dim-halo

## What shipped

- The flames painter moved out of the page spectrum's effects painter into page/spectrumfire.js (owner-ordered split at the file length cap). Under Fade the trace's line shows alone, with neither the filled area nor the shadow, and Fade's halo is laid on the plot at 0.5 of its canvas's strength so the trace can be told from it. Fade's halo now fades out at every paint rate: shares of dimming under 10% are owed from paint to paint and taken off the canvas together, because an 8-bit canvas rounds smaller ones away. A change of color suite or accent starts Fade's halo on a clear canvas, so it builds again in the colors in force. docs/spec/faceplate.md states the Fade rule in owner-approved wording. The painter's filepawl allowance is 412 by owner ruling. No test pins the halo's strength: the owner ruled it a look, not a behavior.

## Commits

| Task | Commit | Description |
| --- | --- | --- |
| 1 | b128b8978cb6f60162088e03217a9f99da15f264 | refactor: the flames painter moves to its own module |
| 1 | 56954610002d6e239b6689fa681eae50ab1e0341 | fix: Fade's halo is dimmed so its trace can be told from it |
| 1 | 3a672f27adfe58da7adfc302276089c2f37c2ed5 | fix: Fade shows the trace's line alone, over a halo at half strength |
| 1 | 9cc2b681036c6318c8d33ed5af6d0cb749d10f2b | fix: Fade's halo fades out at every paint rate |
| 1 | 48230645dcb4da5b59b1c3e3c245d770fe92370a | fix: Fade's halo follows a change of color suite |

## Files

### Task 1: fade-thin-line-dim-halo

- **Files:** .filepawl.toml, docs/spec/faceplate.md, hqptuner/static/components/faceplate/page/sourcepaint.js, hqptuner/static/components/faceplate/page/spectrumfire.js, hqptuner/static/components/faceplate/page/spectrumfx.js, hqptuner/static/model/gauges/meter/steps.js, tests/js/components/faceplate-page/sourcepaint-section.test.js, tests/js/components/faceplate-page/spectrumfx-fx.test.js, tests/js/model/gauges/meter/steps.test.js
