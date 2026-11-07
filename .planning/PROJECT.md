# HQPTuner

## What This Is

HQPTuner is a configuration interface for HQPlayer Embedded: a small Python backend and a no-build-step web frontend that drive a running `hqplayerd`, for HQPlayer users who find the stock web UI hard to learn. This repository holds v2, the faceplate rebuild of the interface, for private use and development only; v1 is developed in `~/dev/hqptuner/` and merged in.

## Core Value

Configuring HQPlayer Embedded is easier to learn and use than the stock UI, and never endangers the running engine.

## Requirements

### Validated

- ✓ Plain-English "Simplified" option names for filters, modulators and dithers - v1.20.1
- ✓ Filter narrowing over the manual's filter knowledge, with Favorites - v1.20.1
- ✓ Jargon-free Filter Presets with an Emphasis nudge - v1.20.1
- ✓ Headphone Auto EQ from a vendored AutoEq library, AutoEq/REW import, draggable bands on the live response plot - v1.20.1
- ✓ Bauer crossfeed and structural (Brown & Duda) crossfeed compiled to matrix pipelines - v1.20.1
- ✓ Full matrix pipeline editing with live response plots - v1.20.1
- ✓ Friendly output rate selection, rate- and mode-aware graying of options - v1.20.1
- ✓ Live volume control - v1.20.1
- ✓ Hardware acceleration settings (multicore DSP, CUDA, E-cores) exposed and explained - v1.20.1
- ✓ Persistent settings written by backup, surgical `hqplayerd.xml` edit and `POST /restore`, verified by readback - v1.20.1
- ✓ Stations (full-config copies mirrored into the daemon's config directory) and Snapshots - v1.20.1
- ✓ Daemon log tail in the browser, customizable accent color - v1.20.1
- ✓ Packaged builds: Docker image, deb, rpm, macOS and Windows apps - v1.20.1

### Active

Milestone v2.0.0. This roadmap covers landing the rebuild-integrate design (`docs/superpowers/specs/rebuild-integrate-design.md`, steps 12 and 13) under the accepted testing policy.

- [ ] The JS test baseline in the integration worktree is recovered to zero failures
- [ ] Every remaining test and support under `tests/js/` is ported off retired shapes
- [ ] `make check` is green on `rebuild/integrate`, and it merges into `v2`

### Out of Scope

- Media playback and library management - Roon covers it
- The convolution engine - Matrix DSP covers it
- HQPlayer Desktop - it has no port-8088 configuration lane for HQPTuner to drive
- Max rates at 32 kHz multiples - "Auto-rate family" is always forced to keep friendly rate options
- v1 development - it happens in `~/dev/hqptuner/` and is merged into this repository
- Measuring HQPlayer's filter design (corner, transition width, roll-off, taps, attenuation) - proprietary unless published
- Agent-written `CHANGELOG.md` entries - the v2 changelog is the owner's alone until handed back

## Context

- **Stack:** Python package `hqptuner/` (FastAPI-style REST API on `127.0.0.1:8090`, knobs as `HQPTUNER_*` env vars in `hqptuner/config.py`); browser UI under `hqptuner/static/` on vendored Preact/htm with no build step; tests in `tests/` (pytest) and `tests/js/` (node test runner).
- **Engine lanes:** Control API on TCP 4321 for live settings, status and enumerations; HTTP configuration interface on TCP 8088 (Digest auth) for persistent settings. hqplayerd runs bare metal on the dev host and is live production.
- **Gates:** `make check` runs ruff, black, xenon, vulture, strict mypy, import-linter, test-assertion gates, offline pytest with a 90% per-file coverage floor, eslint, tsc `--checkJs`, knip, jscpd and css-dead, plus the JS suite at lines 95 / branches 90 / functions 85. Every gate runs through `scripts/gate.sh`. `docs/spec/testing.md` is the binding testing policy.
- **v2 state:** branch `v2` is 505 commits ahead of `main`'s merge base. The faceplate frame, drawers, page sections, settings body, bottom bar, Snapshot and Profile builders and the connection panel exist under `hqptuner/static/components/faceplate/`. The meter, spectrum and source painters were excised and rebuilt across three branches; `rebuild/integrate` (worktree `.claude/worktrees/integrate`) has merged them and landed design steps 1 to 11, and step 12a is in progress.
- **Known rough edges:** field values in many JS tests are seeded through `config.value` while production reads `readings.value.fields`; `todo.txt` carries open defects and an untriaged list of untested behaviors; `pyproject.toml` still reads `version = "1.19.2"`.
- **CI:** `.github/workflows/check.yml` runs `make check` (job `check`) and `make test-e2e` (job `e2e`) on push to `dev` and on pull requests; a commit on `v2` gets no CI run unless a pull request is open.

## Constraints

- **Host safety:** hqplayerd is live production on the same machine - every write against it idle-gates first, restores what it changed and verifies by `State` readback.
- **Engine authority:** the running engine is the authority for names, IDs and ordering; static `data/*.json` joins by name.
- **Copy:** user-facing text ships only as owner-approved verbatim copy; em dashes are forbidden.
- **Gates:** every gate exemption is owner-approved per site before it is written; `--no-verify`, `SKIP=` and hook-config edits are off the table.
- **Layering:** imports follow `api > core > presets > lanes > engine > conf`, enforced by `lint-imports`.
- **Tests:** written tests-first with a red bite proof; tests are never edited to pass.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Python backend plus a no-build-step Preact/htm frontend | One small process and no frontend toolchain | ✓ good |
| The running engine is the enumeration authority; shipped JSON joins by name | Shipped filter and modulator lists drift from the engine | ✓ good |
| Persistent settings via backup, surgical `hqplayerd.xml` edit, `POST /restore`, readback | Reaches settings the daemon's own form never exposed, and verifies them | ✓ good |
| v2 keeps the store, schema, lanes and API, and rebuilds the shell, components and CSS | The faceplate spec (`docs/spec/faceplate.md`) replaces v1's shell, not its backend | - pending |
| Wire names `preset` and `livepresets` stay; Station and Snapshot are UI names | Renaming the wire would break stored records and the API | ✓ good |
| Branches `dev` to `beta` to `main`, promotion by the owner through `scripts/ship.sh` | Each branch maps to a container tag (`:beta`, `:latest`) | ✓ good |
| The meter playhead advances on the loop's `dt` between frames, capped at the newest stamp less the delay | Frames reach the reader in bursts, and no clock-free decision can move between arrivals; `dt` comes only through the injected `Clock` seam (owner approval, 2026-11-07) | - pending |

---

*Last updated: 2026-11-05 after /cad-adopt*
