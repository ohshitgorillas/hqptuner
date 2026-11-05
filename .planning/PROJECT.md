# HQPTuner v1

## What This Is

HQPTuner is a configuration interface for HQPlayer Embedded: a small Python backend and a no-build-step web frontend that drive a running `hqplayerd`, for HQPlayer users who find the stock web UI hard to learn. It ships publicly as a Docker image, deb and rpm packages, a macOS app and a Windows app. This tree is v1, which receives patches only: bug fixes and accommodations for new HQPlayer releases. New development happens in v2 (`~/dev/hqptuner2/`, branch `v2`).

## Core Value

A user on any supported platform installs HQPTuner, reaches it from their browser, and configures HQPlayer Embedded without endangering the running engine.

## Requirements

### Validated

- ✓ Plain-English "Simplified" option names for filters, modulators and dithers - v1.20.1
- ✓ Filter narrowing over the manual's filter knowledge, with Favorites - v1.20.1
- ✓ Easy Mode: curated filter presets with an Emphasis nudge - v1.20.1
- ✓ Headphone Auto EQ from a vendored AutoEq library, AutoEq/REW import, draggable bands on the live response plot - v1.20.1
- ✓ Bauer crossfeed and structural (Brown & Duda) crossfeed compiled to matrix pipelines - v1.20.1
- ✓ Full matrix pipeline editing with live response plots - v1.20.1
- ✓ Friendly output rate selection, rate- and mode-aware graying of options - v1.20.1
- ✓ Live volume control and LIVE mode with live snapshots - v1.20.1
- ✓ Hardware acceleration settings (multicore DSP, CUDA, E-cores) exposed and explained - v1.20.1
- ✓ Persistent settings written by backup, surgical `hqplayerd.xml` edit and `POST /restore`, verified by readback - v1.20.1
- ✓ HQPlayer 6.2.0's adaptive cleanup filters - v1.20.0
- ✓ System tab downloads HQPTuner's own state as one zip - v1.19.0
- ✓ Daemon log tail in the browser, customizable accent color - v1.20.1
- ✓ Packaged builds: Docker image, deb, rpm, signed macOS dmg, signed Windows installer for x64 and Arm64 - v1.20.1

### Active

Milestone v1.20.2: the Windows app problems a user reported against v1.20.1, under the accepted testing policy.

- [ ] A Windows user can reach HQPTuner from other devices on their network after a fresh install
- [ ] A Windows user can install a new version over an existing one and the app starts

### Out of Scope

- New features - they go to v2
- v2 work - it happens in `~/dev/hqptuner2/` on branch `v2`
- Media playback and library management - Roon covers it
- HQPlayer Desktop - it has no port-8088 configuration lane for HQPTuner to drive
- Measuring HQPlayer's filter design (corner, transition width, roll-off, taps, attenuation) - proprietary unless published

## Context

- **Stack:** Python 3.12 package `hqptuner/` (REST API on port 8090, knobs as `HQPTUNER_*` env vars in `hqptuner/config.py`, listen host defaults to `127.0.0.1`); browser UI under `hqptuner/static/` on vendored Preact/htm with no build step; tests in `tests/` (pytest) and `tests/js/` (node test runner), browser suite in `tests/e2e/`.
- **Engine lanes:** Control API on TCP 4321 for live settings, status and enumerations; HTTP configuration interface on TCP 8088 (Digest auth) for persistent settings. hqplayerd runs bare metal on the dev host and is live production.
- **Desktop apps:** PyInstaller one-folder bundles (`hqptuner.spec`) launched behind a tray icon (`hqptuner/desktop.py`). Windows ships one Inno Setup installer for both architectures (`packaging/windows/hqptuner.iss`), per-user under `%LOCALAPPDATA%\Programs\HQPTuner`, which writes `HQPTUNER_LISTEN_HOST=0.0.0.0` to the user's environment. macOS carries the same value in `LSEnvironment`.
- **Gates:** `make check` runs ruff, black, xenon, vulture, strict mypy, import-linter, test-assertion gates, offline pytest with a 90% per-file coverage floor, eslint, tsc `--checkJs`, knip, jscpd and css-dead, plus the JS suite at lines 95 / branches 90 / functions 85. Every gate runs through `scripts/gate.sh`.
- **CI:** `.github/workflows/check.yml` runs `check` and `e2e` on push to `dev` and on pull requests; `release.yml` builds and smokes every package (`smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos`, `smoke-windows`) and publishes. No workflow yet runs the accepted coverage commands. Python branch coverage measured 89.96% (1389/1544) on 2026-11-03, under the accepted 90.
- **Open report (v1.20.1, Windows 11):** installing over the existing version fails at launch with `FileNotFoundError` opening the bundled tray image under `_internal`; after uninstalling and installing fresh, the app is not reachable from an iPad, an Android phone or another Windows 11 PC.
- **Shared repository:** v1 and v2 share one repository. `dev` is never merged into `v2`, because both branches track their own `.planning/`; v1 commits reach `v2` one at a time by `git cherry-pick -x` or a recorded skip.

## Constraints

- **Testing:** `docs/testing.md` is the binding testing policy: tests-first with a red bite run, lowest lane, no wall-clock waits, one assertion per test. Tests are never edited to pass.
- **Host safety:** hqplayerd is live production on the same machine; every write against it idle-gates first, restores what it changed and verifies by `State` readback.
- **Copy:** user-facing text and `CHANGELOG.md` entries ship only as owner-approved verbatim copy; em dashes are forbidden.
- **Gates:** every gate exemption is owner-approved per site before it is written; `--no-verify`, `SKIP=` and hook-config edits are off the table.
- **Layering:** imports follow `api > core > presets > lanes > engine > conf`, enforced by `lint-imports`.
- **Release:** `dev` to `beta` to `main`, promotion by the owner through `scripts/bump.sh` and `scripts/ship.sh`.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Python backend plus a no-build-step Preact/htm frontend | One small process and no frontend toolchain | ✓ good |
| The running engine is the enumeration authority; shipped JSON joins by name | Shipped filter and modulator lists drift from the engine | ✓ good |
| Persistent settings via backup, surgical `hqplayerd.xml` edit, `POST /restore`, readback | Reaches settings the daemon's own form never exposed, and verifies them | ✓ good |
| The code's listen host stays `127.0.0.1`; packaging supplies `0.0.0.0` | A bare run stays private; the Linux unit, the container and the desktop apps opt into the network | - pending |
| macOS and Windows launch behind a tray icon, one instance per port | A desktop user needs a way to reopen and quit a windowless server | ✓ good |
| v1 is patch-only; `dev` is never merged into `v2` | v2 replaces v1, and both branches track their own `.planning/` | - pending |

---

*Last updated: 2026-11-05 after /cad-adopt*
