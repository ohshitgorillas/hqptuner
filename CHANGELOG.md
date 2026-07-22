# Changelog

Notable changes to HQPTuner. Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/) once out of beta.

## [Unreleased]

### Changed

- The CUDA DSP-device id grays out in Convolution-only offload mode (the manual's device split: `cuda_dev` drives filters/DSP tasks, which convolution-only mode never offloads), with the reason captioned.
- The System tab's Engine health card is now a full-width meter cluster: a VU-style needle gauge for process speed (red zone below 1.00×, amber to 1.05×, needle pegs past 4×), tick-marked bar meters for input/output buffer fill (amber under 15%), and clip / apodizing-event counters with per-track deltas. Values sweep between polls instead of jumping.

## [0.3.3] — 2026-07-21

### Changed

- The signal-path bar gives the matrix its own permanent chip showing the active profile name (previously it folded into an anonymous "DSP: On" whenever crossfeed or loudness was also active). Crossfeed + loudness still share the combined "DSP" slot.

- Credentials default to hqplayerd's stock management credential (`hqplayer` / `password`), so a stock daemon works with zero configuration — `HQPTUNER_HQP_USERNAME` / `HQPTUNER_HQP_PASSWORD` are only needed when the daemon's auth was re-provisioned.

### Added

- Engine-health surfacing off the daemon's Status frame (fields HQPlayer reports but its own UI barely shows): an alert strip under the signal-path bar warns — only while playing, only when a threshold is crossed — about DSP below 1.05× realtime (red below 1.00×), output-buffer starvation, clipping this track, and apodizing events landing on a non-apodizing filter. A System-tab "Engine health" card shows the raw numbers (process speed, buffer fill, clips/apodizing counters) at all times.
- Favicon (there was none — every tab showed the generic globe and `/favicon.ico` 404'd): a level-slider glyph that follows the active preset — 🎧 when the preset name contains "headphone", 🔊 for "speaker", 🎚️ otherwise.

## [0.3.2] — 2026-07-21

### Changed

- Loudness grays out whenever the volume control is bypassed (fixed volume / Optimal ISO, Direct SDM, or volume min = max = 0) — volume-adaptive loudness cannot adapt to a fixed level and sits at 0% applied above the loudness range. The caption points at a Matrix EQ as the volume-agnostic alternative.

## [0.3.1] — 2026-07-21

### Added

- MIT `LICENSE` file.
- Mode-aware graying for more controls: DSD over PCM (DoP) and 48k DSD rates gray in PCM output mode; Direct SDM, Integrator, and SDM → SDM conversion gray in PCM mode; Gain +6 dB, Noise filter, and SDM → PCM conversion gray in SDM mode; Adaptive volume grays whenever the volume control is bypassed (Direct SDM, fixed volume / Optimal ISO, or volume min = max = 0).
- The live volume knob now names the "volume min and max both 0" bypass case instead of falling through to "no active stream".

### Changed

- Grayed controls now show their reason as a visible caption under the control (previously hover-only); dither/modulator options unusable at the selected rate carry the reason in the option label.

## [0.3.0] — 2026-07-21

### Added

- Docker packaging: `Dockerfile` (python:3.12-slim, non-root, healthcheck on `/api/health`) and `compose.yaml` — bridge networking by default (hqplayerd reached via the Docker host gateway; host-network fallback documented), `./state` volume for backups + presets, read-only log-file mount for the System-tab log tail.
- GHCR publishing via GitHub Actions: multi-arch (amd64 + arm64) images at `ghcr.io/ohshitgorillas/hqptuner`, `latest` from master and semver tags from `v*` releases.
- README: Docker-first install instructions.

## [0.2.0] — 2026-07-21

First public beta. Everything below is the state of the app at beta start.

### Core

- Two-lane integration with hqplayerd (verified against 6.0.4): live settings over the Control API (TCP 4321), persistent settings over the HTTP config interface (TCP 8088, Digest auth) with readback verification across the daemon's self-restart.
- Staged-changes model with a pending bar showing the live/restart split; Discard/Apply; apply preserves settings not being staged (rebuilds from the running config, not the preset snapshot).
- HQPTuner-owned preset store with full CRUD (the daemon's native profile subsystem proved unreliable — its `profile/save` to an existing name is a silent no-op), mirrored into the daemon's config directory so the stock UI stays populated.
- Six tabs: Output, Volume, Resampling, DSP, Matrix, System.

### Features

- Filter narrowing by quality, genre, focus, phase, and length; apodizing-only toggle; the manual's descriptions inline under every control.
- Friendly rate selection (PCM 1x–32x, DSD64–DSD2048) with the auto-rate-family invariant forced on write.
- Mode/rate-aware graying with reasons (PCM vs SDM, modulator minimum rates).
- Live volume control, three-handle volume range, PCM gain compensation.
- DSP: crossfeed (Bauer presets loadable), volume-adaptive loudness, DAC correction; live client-side response plots with draggable EQ handles on the loudness plot.
- Matrix pipeline editing: signal-flow rows, inline stage editor (11 IIR types incl. raw biquad, delay, RIAA, per-stage convolution upload), two-way raw-string sync, drag-reorder, per-row clear.
- AutoEq / REW ParametricEQ import (paste or .txt) with stereo mirroring and preamp→gain mapping; built-in vendored AutoEq library (8850 models, pinned snapshot, MIT) with search, A/B preview, and one-click profile load.
- Matrix response card: overlaid magnitude + phase per plotted pipeline, computed client-side and numerically validated; draggable EQ dots with stereo-pair sync and chip-selection highlight.
- Matrix profiles: live switch (no restart), save-as-new, delete.
- Hardware acceleration controls (CUDA, multicore DSP, E-cores, blocks/cycle) via the backup→edit→restore lane.
- System tab: log tail, config backup/restore, engine identity, HQPTuner prefs (accent themes, description visibility).

### Known limitations

- HQPlayer Embedded only — Desktop has no web interface.
- Convolution stages plot only when their impulse was uploaded this session.
- Concurrent edits from the stock `/matrix` page can silently revert HQPTuner's (daemon-level limitation).
- Auto-rate family always forced; only 44.1k/48k-multiple output rates offered.
- Not yet packaged (Docker/compose planned).
