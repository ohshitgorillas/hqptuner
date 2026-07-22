# Changelog

Notable changes to HQPTuner. Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/) once out of beta.

## [Unreleased]

### Changed

- Volume tab layout: the playback-volume knob now shares the top row with the Fixed volume card, the volume Range bar spans full-width below, and the Automatic card moved to full-width. Within Fixed volume, Optimal ISO sits at the top as an independent control with only the dBFS level indented under the Fixed-volume enable.

### Fixed

- Disabling Fixed volume no longer traps the volume control in a locked state. Optimal ISO (`volume_fixed`) is an independent inter-sample-overs fixed-volume mode (readme attr `volume_fixed`, its own 0/−3/−6 dB enable), not a sub-option of Fixed volume — but its control was greyed whenever Fixed volume was off, on a wrong "Fixed volume enable gates both" assumption. So turning Fixed volume off left Optimal ISO stuck on (e.g. −3 dB), which kept bypassing the live volume control, while the one control that could clear it was greyed. Optimal ISO is now gated only by Direct SDM (which bypasses all volume), so it stays adjustable and the playback knob frees as expected.

### Added

- Per-page "quick updates" opt-ins that bump the live status/volume poll from 2 s to 0.5 s while the page is open: a "Quick updates" checkbox at the bottom of the System tab's Engine health card, and a "Faster volume updates" checkbox under the Volume tab's playback knob. Off by default, remembered per browser; the faster cadence only runs on the page you're looking at, so idle pages keep the light 2 s poll.

## [0.4.0] — 2026-07-21

### Added

- Crossfeed EQ compensation (DSP tab, own card): headphone EQ profiles assume listening without crossfeed, but Bauer crossfeed dulls centered sound — vocals, bass, most of the mix — by ~1–2.7 dB toward the treble (bs2b model, math verified against the libbs2b source; HQPlayer's bauer matches its presets and parameter ranges exactly). One click rebuilds the stereo EQ pair into eight mid/side pipelines that correct only the centered part, leaving the crossfeed's stereo width effect untouched. Strength slider with an editable number box (0 % off · 100 % neutral · up to 150 %, with a content guide: center-heavy mixes take 100 %+, wide/hard-panned material sits better at 50–75 %), a mini correction plot in the card (crossfeed dip, correction, net result), a "what you hear" overlay on the Response plot (corrected center, uncorrected center, stereo sides), and staleness detection with one-click rebuild when the crossfeed settings change. The compensated block is literal, badged pipelines — fully hand-editable; edits that break the pattern gracefully return it to plain rows. Compensation cascade accurate to ≤0.05 dB against the exact inverse.

### Fixed

- All response plots now label their axes (dB / Hz, and ° on the phase scale), and trace labels right-align inside the frame with a background halo instead of clipping at the edge ("center, c…").
- Loading a matrix profile no longer loses the post-process settings. HQPlayer's own `/matrix/load` replaces the whole matrix context — crossfeed, DAC correction, and loudness were silently cleared. HQPTuner now snapshots the post-process state before the load and re-applies it afterwards, verified by readback (at the cost of a second ~3 s engine reload per load).

### Changed

- Tab reorganization: Loudness moved to the Volume tab (it is volume-adaptive); Crossfeed moved to the pipeline-matrix tab as its own collapsible card with a collapsible response plot, a hairline between its two knobs, and a note that HQPlayer does not carry crossfeed in matrix profiles; that tab is now named DSP and its General card is now named Matrix. The old post-process DSP tab is gone — five tabs total. Headphone Auto EQ, Crossfeed, and Crossfeed EQ compensation cards are all collapsible and open by default.

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
