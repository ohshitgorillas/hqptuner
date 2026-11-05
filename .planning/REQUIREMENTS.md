# Requirements: HQPTuner

**Defined:** 2026-11-05

**Core Value:** Configuring HQPlayer Embedded is easier to learn and use than the stock UI, and never endangers the running engine.

## Active

Committed scope. Each maps to exactly one roadmap phase.

### Integration

- **INTG-01**: Owner can run every test file of the retained 12a affected baseline together in `.claude/worktrees/integrate`, including every consumer of a repaired shared helper, and see zero failures.
- **INTG-02**: Owner can find no test or support under `tests/js/` that seeds a field value through `config.value` or `matrixConfig.value`; field values are seeded through `seedReadings`, and those signals carry form metadata only.
- **INTG-03**: Owner can find no test or support under `tests/js/` still using a retired shape (such as `fileTruth`), with each port's pre-edit baseline recorded as passing.
- **INTG-04**: Owner can run `PYTHONPATH=$(pwd) scripts/gate.sh make check` in `.claude/worktrees/integrate` and read `exit=0`.
- **INTG-05**: Owner can check out `v2` and find `rebuild/integrate` merged into it, with `scripts/gate.sh make check` exiting 0 on `v2`.

## v2 Requirements

Deferred. Tracked, not in the current roadmap.

### Station builder

- **STAT-01**: User can build a station from scratch through the Station builder's Overview and ten steps, backed by NAA bring-up, IPv6 detection, USB listing, Connection check and 48k-family DSD probes that each idle-gate, restore and verify by readback.
- **STAT-02**: User can delete a preset from the Station builder.

### Defects

- **BUG-01**: User can save a snapshot to one station without it disappearing from another station.
- **BUG-02**: User is offered only modulators the running output rate supports, and a live apply that stops playback reports the stop instead of ok.
- **BUG-03**: User sees the HF filter lamp lit only for content the filter acts on.
- **BUG-04**: User can apply PCM filters while in SDM output mode without the engine resetting.
- **BUG-05**: User sees the app dimmed while HQPlayer is unavailable or disconnected.
- **BUG-06**: User who clicks "Open HQPTuner" in a packaged build gets the app in the browser.

### Features

- **HF-01**: User gets HF filter recommendations only; the HF auto-pilot no longer engages a filter.
- **SPEC-01**: User can switch the spectrum between sum, left and right.

### Test debt

- **TEST-01**: Owner can find each behavior on `todo.txt`'s triaged "untested behaviors" list covered by a test, or struck from the list.

### Held

- **HOLD-01**: User can tell which staged changes Discard drops.
- **HOLD-02**: User sees apodizing warnings only above a rate of events that fits listening sessions.
- **HOLD-03**: User can use the Space/Emphasis toggle for hi-res content on the Perfect Ten and Lifelike presets.

### Cutover

- **CUT-01**: User gets the v2 faceplate as the only entry, with the v1 components, CSS, LIVE and METER modes and their tests deleted, `README.md` and `CONTRIBUTING.md` rewritten where they describe the v1 shell, and release 2.0.0.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Media playback and library management | Roon covers it |
| The convolution engine | Matrix DSP covers it |
| HQPlayer Desktop | It has no port-8088 configuration lane |
| Max rates at 32 kHz multiples | "Auto-rate family" is always forced to keep friendly rate options |
| v1 development | It happens in `~/dev/hqptuner/` and is merged in |
| Measuring HQPlayer's filter design | Proprietary unless published |
| Agent-written `CHANGELOG.md` entries | The v2 changelog is the owner's alone until handed back |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|

Bare headers - `/cad-plan` seeds a row per requirement when its phase is planned (`references/req-traceability.md`).

---

*Last updated: 2026-11-05 after /cad-adopt*
