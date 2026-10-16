# Docs

A new fact goes in the doc that owns its subject. If no doc owns it, it gets a new doc, listed here.

## spec/

The design and binding rules.

- [api](spec/api.md): the REST API contract with its clients.
- [crossfeed-compensation](spec/crossfeed-compensation.md): compensating headphone EQ for the Bauer crossfeed tilt.
- [design-system](spec/design-system.md): frontend layout and stylesheet rules.
- [eq-export](spec/eq-export.md): EQ export formats and their mapping.
- [faceplate](spec/faceplate.md): the faceplate's controls and behavior.
- [lifecycle](spec/lifecycle.md): the daemon connection lifecycle.
- [matrix](spec/matrix.md): matrix profile, pipeline and EQ editing.
- [protocol](spec/protocol.md): hqplayerd wire truth.
- [settings-classification](spec/settings-classification.md): which lane each setting writes on.
- [settings-truth](spec/settings-truth.md): which store answers for a setting, and when.
- [state](spec/state.md): state HQPTuner keeps that the daemon does not.
- [testing](spec/testing.md): testing policy.
- [timing](spec/timing.md): playback time and wall time.
- [wizard](spec/wizard/wizard.md): the setup wizard workflow.

## parked/

Design kept for withdrawn work.

- [advisor](parked/advisor.md): the junk-filter advisor and auto-pilot.

## research/

Background studies.

- [crossfeed-math](research/crossfeed-math.md): structural crossfeed math and design options.
- [junk-filter-autopilot-resource-20k](research/junkfilter/junk-filter-autopilot-resource-20k.md): junk-filter auto-pilot detectors and their scores.

## internal/

Working notes for contributors.

- [copy-before-after](internal/copy-before-after.md): copy that differs from the manual text it derives from.
- [gate-notes](internal/gate-notes.md): read-only commands the change budget meters.
- [v2-roadmap](internal/v2-roadmap.md): the v2 implementation roadmap.
