# Changelog

Notable changes to HQPTuner. Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/) once out of beta.

## [Unreleased]

### Changed

- Naming a preset and confirming an overwrite or a delete happen inline now, instead of through the browser's own `prompt()` and `confirm()` boxes. Those never matched the rest of the app, were awkward to back out of, and are blocked outright in some embedded browsers — in a wrapped webview, saving a preset simply did nothing. The name field opens in the pending bar where the action was taken: Enter commits, Escape cancels, and a blank name is refused in place rather than silently dismissing the question. The delete confirmation opens beside the preset picker. One question is open at a time, and asking a second supersedes the first rather than leaving it stranded.

- The Bauer | Structural switch in the Crossfeed card header fills the header instead of sitting undersized in it — measured at 1280, it now occupies 96.9% of the header's content box and takes its type size from the header rather than the browser's default button font.

- The Pipelines card on the DSP tab collapses. Once a matrix has rows in it the card ran most of the length of the page and pushed everything below it out of view; it now carries the same header toggle the Headphone Auto EQ and Crossfeed cards already use, open by default, and keeps the row count on the header so a collapsed card still says how many pipelines are configured.

### Fixed

- The signal path bar showed a filter and a modulator that were not in the path while DSD content played. HQPlayer runs four different conversion chains depending on whether the source and the output are PCM or DSD, and the engine reports its *configured* filter and shaper whichever one is actually live — hqplayerd's own web UI shows the same pair regardless — so a DSD track going to a DSD output displayed a modulator (`AMSDM7EC 512+fs`) and an oversampling filter that neither touch it. The bar now follows the real path: DSD→DSD shows the integrator and the SDM→SDM conversion, which are the only two stages the manual names for remodulation; DSD→PCM shows the noise filter and the SDM→PCM conversion ahead of the resampling filter and dither; PCM→DSD names the modulator, and PCM→PCM the dither. Direct SDM collapses the chain to a bare bit-perfect pass-through and drops the matrix, crossfeed and DAC-correction chips with it, because it disables all processing (manual §4.5).

- Volume range and startup volume stayed editable while the volume control they bound was bypassed. They now gray for the same reasons the master volume knob does — Direct SDM, fixed volume, auto headroom — and say which one. The one bypass case deliberately left out is min and max both sitting at 0: graying the range there would take away the only controls that get you out of it.

- Unreadable browser storage no longer fails silently. `prefs.js` fell back to defaults with no signal at all when `localStorage` was missing or threw, which is invisible in a private-mode browser and would quietly defeat any persistence test under node. It now warns once, distinguishing storage that is absent from storage that is present but refused the read.

- The Python wheel ships the frontend and the metadata JSON. `pip install hqptuner` previously produced a package carrying neither `hqptuner/static/` nor the filter/shaper/settings JSON, so it could not serve the SPA and had no prose to join against the live enumerations; Docker only worked because the working directory shadowed the installed copy, and if that shadowing ever stopped the SPA mount was skipped with nothing logged. Verified against a built wheel: 84 static assets and all three metadata files are in it.

- Docker images no longer bake in stray bytecode. `.dockerignore` root-anchored `__pycache__` and `*.pyc`, so every nested `hqptuner/**/__pycache__` still entered the build context; both patterns are recursive now.

- Turning structural crossfeed off could rewrite rows without saying so. Removal normally restores the exact rows the block was built over, stashed when it was installed; when there is no stash — another browser, cleared storage, a block installed before the stash existed — it rebuilds the pair from the block instead, which canonicalizes row order to In 1-first and reformats the gains. Both paths looked identical from the outside. The rebuild path now says what it did and asks you to check rows 1 and 2 before applying. `docs/crossfeed-math.md` §8.1 also claimed the stash was lost after an Apply and a reload; it is persisted alongside the remembered controls and survives both, and the section now says so along with the consequence — a stash is browser-local and is not invalidated when the configuration changes under it.

- The Crossfeed compensation section header lost the explanation the old card header carried; hovering it describes again what compensation does.

- The Crossfeed compensation controls lost their label. Merging the crossfeed and compensation cards into one two-mode card inlined the compensation strip and its plot but dropped the card wrapper whose header carried the name, leaving a slider and buttons in Bauer mode with nothing saying what they were. It is now a "Crossfeed compensation" section header alongside "Response plot", collapsible and open by default.

## [0.6.0] — 2026-07-22

### Added

- **Structural crossfeed** — a second crossfeed implementation alongside HQPlayer's Bauer, selected by a segmented toggle in the Crossfeed card. Where Bauer exposes a crossover frequency and a level in dB — coefficients of its own filter — this models an actual head and an actual pair of speakers, and its controls are quantities you can picture: speaker angle, head circumference, and centre character. It compiles to sixteen literal matrix pipelines carrying an explicit interaural delay and a head-shadow filter, both derived from Brown & Duda's structural HRTF model; the head-shadow filter factors exactly into a flat row plus a first-order lowpass, so nothing is numerically fitted and nothing is sample-rate-bound. The rows stay hand-editable and badged, and an edit that breaks the pattern drops the badge rather than being blocked or rewritten. Derivation and measurements in the new `docs/crossfeed-math.md`.
- Centre character, the third control, is the one with no hardware equivalent. Real speakers colour centred sound — vocals, bass, most of a mix — darker than the sides, and they put a notch in it: at 30° the centre response has an 11.6 dB dip at 1426 Hz. That is what speakers genuinely do, but in a room reflections fill it, and headphones reproduce it bare. The control scales that colouration continuously from literal to none, with the stereo image byte-identical at every setting — only centred tone changes. Presets take their values from the measured ripple curve rather than by feel: Standard 30°/70%, Anechoic 30°/100%, Intimate 22°/70%, Wide 45°/50%, Neutral center 30°/0%. Head size is deliberately excluded from presets and persists across them, being anatomy rather than taste.
- The card shows a live top-down geometry diagram, the computed ear-to-ear delay (high- and low-frequency), far-ear treble level and centre shift, and a collapsible response plot. The headphone EQ rides through untouched and per ear, so asymmetric measured corrections are carried rather than refused.

## [0.5.0] — 2026-07-22

### Changed

- Crossfeed compensation no longer reads as if the treble tilt it removes were a fault in the crossfeed. Centred sound really does come out ~1.8 dB duller in the treble than the sides — and that is close to what a real pair of speakers at ±30° does to a centred image, so compensation is a tonal choice (speaker-like centre vs neutral centre), not a repair. The card description, the tilt readout, and the card header say that now. Grounded in Brown & Duda's structural head model, which puts the ±30° centre tilt at 1.80 dB against bs2b's default preset's 1.81 dB; the derivation is in the new `docs/crossfeed-math.md`.

- "Optimal ISO" is now **Auto headroom**, with `(Optimal ISO)` kept as a smaller second line under the label so anyone cross-referencing HQPlayer's own page or the manual still lands on the same setting. The description drops the ISO jargon for what actually happens: loud tracks can peak above 0 dBFS between samples after resampling, and the margin leaves room for those peaks instead of clipping them. The control renders 1.1x the standard segment size (new reusable schema `size: "lg"`), and the two places that named it in passing — the fixed-volume-level gray reason and the playback knob's disable notice — follow the rename.

- Three two-column cards now group related controls down a column instead of pairing unrelated ones across the divider. DSD sources: Integrator → SDM → SDM stack on the left, Noise filter → SDM → PCM on the right, so each column is one conversion path in signal order. Hardware acceleration: CUDA offload → CUDA devices on the left, Multicore DSP → E-core allocation on the right, with Blocks / cycle as a full-width row below. HQPTuner preferences: the two description toggles stack on the left (they gate each other), leaving Accent color on the right.

- Volume tab layout: the playback-volume knob now shares the top row with the Fixed volume card, the volume Range bar spans full-width below, and the Automatic card moved to full-width. Within Fixed volume, Auto headroom sits at the top as an independent control with only the dBFS level indented under the Fixed-volume enable.
- Response plot (DSP tab) shows data by default instead of an empty frame: every pipeline that carries processing is plotted without toggling ◉, and selecting a stage chip plots its row. A recognized crossfeed compensation block is drawn as the single headphone-EQ curve it was built from (recovered via mid/side recognition) rather than its eight near-identical internal pipelines, and byte-identical stereo-pair rows collapse into one trace labeled with both pipeline numbers (`1+2`). Overlaid traces now take evenly-spaced computed hues (`hsl(i×360/n)`) so any number of curves stays visually distinct with color-matched legend labels, replacing the fixed four-colour cycle that repeated past four traces. The crossfeed "what you hear" overlay (corrected / uncorrected centre, stereo sides) now shows by default while crossfeed is enabled; the ∿ button overrides that either way.

- Every full-width card with two internal columns now draws a hairline between them, and all of those rules sit on the card's centre line so they stack vertically down the page (previously the crossfeed card's `Enable | Preset` and `Frequency | Level` rules were ~12 px apart, and most two-track sections had no rule at all). Full-width rows inside a two-track section are not struck through. Competing section-marker borders were dropped so each split shows exactly one divider — the loudness Bass/Treble clusters and the DAC-correction nested block no longer draw a second line beside the centred rule.
- Crossfeed compensation is no longer described as an EQ feature: it corrects the treble dulling crossfeed applies to centred sound, and works with or without a headphone EQ loaded (the EQ, if any, is carried through untouched). The card is now "Crossfeed compensation" and its description drops the EQ framing.
- The crossfeed / loudness knob readout box moved from the right of the slider to directly under the dial (centred on it, slightly larger type), which frees horizontal space for the slider.

### Fixed

- Loading a headphone profile while Crossfeed compensation was on silently broke it. The compensation block is eight pipelines sharing one EQ chain, with Lin gains carrying the mid/side factor and the preamp folded in; importing appended the new filters to pipelines 1+2 only and overwrote their gain with the profile's preamp in dB. That dropped the mid/side factor, so centred sound came out roughly 6 dB louder in the left ear than the right while hard-panned material stayed put, those two rows carried the EQ twice, and the block stopped being recognized — badge, strength slider and Turn off all disappeared with no error shown. The one-click "Load profile" in the AutoEq library hit pipelines 1+2 by definition. Imports now route into the block when one is installed: the EQ joins the block's shared chain and the preamp folds into its gains, so the block survives with its strength intact. Importing onto pipelines past the block is unchanged.

- The crossfeed-compensation strength slider was rendering in the browser's default blue instead of the accent colour — the accent rule was scoped to a `.slider` wrapper the bare input doesn't have, so it also ignored a custom accent.
- Scrolling the mouse wheel over a control no longer changes its value while paging past it. The knob dials (crossfeed, loudness) no longer bind the wheel at all — adjust by drag, slider, number box, or arrow keys — and the range sliders / number boxes now let the wheel scroll the page instead of hijacking the value.
- Hardware-acceleration fields (CUDA offload / devices, Multicore DSP, E-core allocation, Blocks / cycle) now show their hover tooltip when Feature descriptions are turned off. They are built outside the shared Field component and never carried a `title`, so with notes hidden they had no hover surface at all.
- Fixed volume and Auto headroom no longer trap the volume control in a locked state. They are mutually exclusive fixed-volume modes with their own enables (`volume_fixed` carries 0/−3/−6 dB), and either one bypasses the live volume control — but Auto headroom was greyed whenever Fixed volume was off, as if it were a sub-option. So turning Fixed volume off left Auto headroom stuck on at −3 dB, still bypassing the live volume, with the one control that could clear it greyed out. Auto headroom is now gated only by Direct SDM (which bypasses all volume), and enabling either mode clears the other as a visible staged edit rather than graying it — so the playback knob frees as expected from either direction.

### Added

- Per-page "quick updates" opt-ins that bump the live status/volume poll from 2 s to 0.5 s while the page is open: a "Quick updates" checkbox at the bottom of the System tab's Engine health card, and a "Faster volume updates" checkbox under the Volume tab's playback knob. Off by default, remembered per browser; the faster cadence only runs on the page you're looking at, so idle pages keep the light 2 s poll.

## [0.4.0] — 2026-07-21

### Added

- Crossfeed EQ compensation (DSP tab, own card): headphone EQ profiles assume listening without crossfeed, but Bauer crossfeed dulls centered sound — vocals, bass, most of the mix — by ~1–2.7 dB toward the treble (bs2b model; HQPlayer's bauer matches its presets and parameter ranges exactly). One click rebuilds the stereo EQ pair into eight mid/side pipelines that correct only the centered part, leaving the crossfeed's stereo width effect untouched. Strength slider with an editable number box (0 % off · 100 % neutral · up to 150 %, with a content guide: center-heavy mixes take 100 %+, wide/hard-panned material sits better at 50–75 %), a mini correction plot in the card (crossfeed dip, correction, net result), a "what you hear" overlay on the Response plot (corrected center, uncorrected center, stereo sides), and staleness detection with one-click rebuild when the crossfeed settings change. The compensated block is literal, badged pipelines — fully hand-editable; edits that break the pattern gracefully return it to plain rows. Compensation cascade accurate to ≤0.05 dB against the exact inverse.

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

- Two-lane integration with hqplayerd 6.0.4: live settings over the Control API (TCP 4321), persistent settings over the HTTP config interface (TCP 8088, Digest auth) with readback verification across the daemon's self-restart.
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
