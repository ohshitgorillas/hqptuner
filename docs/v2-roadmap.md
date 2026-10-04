# HQPTuner v2 implementation roadmap

The target is `mockup/spec.md`, with `mockup/` as its visual reference. Where the spec and a v1 document or v1 code disagree, the spec wins and the v1 side changes.

## Strategy

- Work lands on branch `v2`. The store, schema, lanes and API carry over. The shell, the components and the CSS are rebuilt.
- The v2 shell has its own entry (a second `index.html` and `app.js`) beside v1 until cutover. Both entries stay reachable, so knip, css-dead and the coverage floors stay green without exemptions.
- The mockup divides into what v2 lifts and what v2 rewrites. `mockup/scripts/model/` holds every decision as a typed function with no DOM access and its tests under `tests/js/mockup/`; a phase moves the modules it needs into `hqptuner/static/` with their tests, unchanged. Everything else under `mockup/scripts/` (`app/`, `components/`, `lib/`) is plain DOM code over the hard-coded tables in `data/`, and is rewritten in preact and signals against the real store.
- `mockup/` passes the same JavaScript gates as `hqptuner/static/`: eslint, prettier, strict `tsc --checkJs`, knip, jscpd, filepawl and the comment gates. An eslint layer rule keeps `mockup/scripts/model/` from importing a DOM module. The CSS gates do not read `mockup/styles/` until Phase 0 retargets them.
- Wire names (`preset`, `livepresets`) stay. Station and Snapshot are UI names.
- Every phase goes through the plan gate, is written tests-first, passes `make check`, and is handed back at 1080×810, 1180×820 and 1366×1024.
- Backend work in the first and ninth phases may be planned ahead of its UI.

## What the mockup provides

| For | Module under `mockup/scripts/` | Holds |
|---|---|---|
| Every phase | `lib/shell/clock.js` | The `Clock` every timer and frame runs on, so a test drives time with a fake. |
| Every phase | `model/shell/timing.js` | Hold to repeat, a paced check, a state that reverts. |
| 1, 4 | `model/gauges/output.js` | Rate tiers by family, the dial scale, which tiers are pinned and playing. |
| 1, 3 | `model/gauges/loudness.js`, `model/gauges/shelf.js` | The loudness shelf scale and the percent applied at a level. |
| 2 | `model/shell/drawer.js` | Dirty rows, gray reasons, what Apply commits across a drawer family, what Discard restores. |
| 2 | `model/gauges/wire.js`, `model/shell/place.js` | The rail wire path and the clamp of a popover to the plate. |
| 3 | `model/gauges/meter.js`, `meter-plot.js`, `meter-source.js` | Spectrum hold, level ballistics, spectrogram indexing, the mock signal source. |
| 3 | `model/shell/pipelines.js`, `pipelines-edit.js`, `model/gauges/eq.js` | Pin grid, pipeline summaries, dock fields, AutoEq bands to IIR stages. |
| 3 | `model/gauges/crossfeed.js`, `speakers.js`, `volume.js`, `range-axis.js`, `plot-axes.js` | Crossfeed presets and geometry, speaker placement, volume pins, the range bar and plot axes. |
| 4 | `model/shell/conversion.js`, `option-list.js`, `narrow-view.js`, `presets.js`, `options.js` | Which fields a mode shows, option columns and tips, narrowing state, filter preset subsets. |
| 5 | `model/shell/alerts.js`, `app.js` | Which alerts raise, where each one is homed, blink and pin. |
| 6 | `model/shell/settings.js` | Readout forms and the visual effect of each setting. |
| 7, 8, 9 | `model/builders/builder.js`, `pager.js`, `schema.js` | The builder walk, dirty state, the record transitions of save, rename and remove. |
| 7 | `model/builders/snapshot.js` | Rail paging, station folds, each row against the live setting. |
| 8 | `model/builders/profile.js` | Step skips, per-step summaries, preset matches. |
| 9 | `model/builders/station.js` | Step skips, device grouping, rate limits, the verdict of each check. |

`model/shell/flags.js` and `lib/shell/bus.js` serve the mockup's own URL flags and events and are not lifted.

## Phase 0: rules before code

- Rewrite `docs/design-system.md` for v2: plate sizes, the ink ladder, surfaces, spacing, motion (alert blink, knob sweep), no cards, no two-track pack grid.
- Retarget the CSS gates to the new rules: `scripts/gates/css/check_css_tokens.py`, `scripts/gates/css/check_css_cards.py`, and the eslint `no-hand-rolled-card` rule. Once retargeted they read `mockup/styles/` as well.
- Port `mockup/styles/tokens.css` into `hqptuner/static/css/base/tokens.css`. The default accent becomes amber.
- Self-host Saira Extra Condensed, IBM Plex Sans and IBM Plex Mono under `hqptuner/static/fonts/`.
- Renumber `docs/wizard/wizard.md`: it carries two sections numbered 1.5 and two numbered 4, and the spec cites it by number.
- Correct the spec's Behavior list: it names Live / Stage and Auto-save, which `mockup/scripts/data/settings/behavior.js` no longer has.

## Phase 1: backend and store deltas

None of this depends on the shell.

- The snapshot record drops the junk filter and the auto-pilot state: the HF filter never persists in saved settings. Stored records are migrated.
- Snapshots are scoped per station, and one save can write to several stations.
- New preferences: DAC type, DAC chip, hidden stages, top of page, bottom bar, allow pinned rates.
- A pinned-rate lane: one exact output rate, cleared by a mode change. The design has to account for the reason v1 holds the fixed rate slot at auto: an exact rate overrides automatic base-rate selection, and the engine then refuses the filter (`hqptuner/lanes/live/routing.py`).
- Loudness `x% applied` at the live volume, as a store value.

## Phase 2: frame

- Plate sizing and scaling for the three display sizes.
- Header: brand knob as connection lamp, station, snapshot tree-select, the two builders, gear.
- Engine row: speed gauge and figure, buffers, Clipping and Apodizing lamps, volume.
- Rail: every stage with its lamp, value and wire, flexing to fill.
- Page skeleton: engaged sections in signal order, two columns, one open field per section, one fill section.
- The generic drawer: head, tabs, live and staged rows, dirty dots, the split Apply / Apply & save button, reason lines, and apply groups shared across a drawer family. It replaces the pending bar.

## Phase 3: stage drawers

In signal order:

1. Source: spectrogram and apodizing strip.
2. HF filter.
3. DSD Processing, Resampling, Shaping: PCM out and SDM out tabs.
4. Matrix engine, DSP pipelines (pin grid, one tab per output), Crossfeed, Loudness, DAC correction.
5. Volume: Level, Gain, Range.
6. Speakers.
7. Output: rate dial, Format, Device. The mockup's DSD support, DSD rates, Discovery and Channels controls carry no id and share one key in the drawer's value store; each needs its own id before the drawer sits on the real store.

## Phase 4: page sections and pickers

- The Source meter section, the Matrix profile section, and the Resampling and Shaping chain pickers.
- Option lists: the filter sheet, the modulator and dither panels, in the Simplified and Standard layouts.
- The narrowing console in the sheet head, and a new console for the shaper lists.
- The Filter presets popover.
- The Output rate pins.

## Phase 5: alerts and cross-references

- Each v1 alert moves to its home: the blink overlay, the line pinned in the owning drawer or page header, and the header popovers. The alert strip is deleted, and the failed preset pick alert with it.
- The `Name ›` cross-reference links.

## Phase 6: Settings body

Timing, Hardware acceleration (CPU and GPU tabs), UPnP, Logging, Behavior, the Signal path map, Visual settings (Display and Layout tabs), About.

## Phase 7: bottom bar and Snapshot builder

- The Setting Switcher: targets and two slots, with Output mode and Volume as targets.
- The Snapshot builder, on the per-station snapshot store.

## Phase 8: Profile builder

The Overview and its five steps, on the existing matrix profile, AutoEq and description routes.

## Phase 9: Station builder

- New backend probes: NAA bring-up, IPv6 detection, USB listings, the Connection check, and the 48k-family DSD check. Each one touches the production daemon, so each follows the idle gate, restores what it changes and verifies by readback.
- The Overview and its ten steps, on those probes.

## Phase 10: connection panel

- Tapping the brand knob opens the connection panel: v1's Setup screen moved over with its fields and copy as they are, in the faceplate's style.
- It runs on the existing connection routes and the credential verdict in the health route; the backend does not change.

## Phase 11: cutover

- The v2 entry becomes the only entry. The v1 components, CSS, LIVE and METER modes and their tests are deleted.
- `docs/architecture.md` is rewritten where it describes the v1 shell: §4.2, §4.3, §5.3, §6.2, §7 and §9. `README.md` and the bug-report directions in `CONTRIBUTING.md` follow.
- Changelog and release 2.0.0.

## Owner inputs

Each phase waits on these before it ships.

| Phase | Input |
|---|---|
| 0 | Whether the pre-commit jscpd hook, scoped to `hqptuner`, `scripts` and `tests`, also reads `mockup/`. `make check` already does. |
| 3 | The DAC type and DAC chip effect lines, the Matrix engine intro and the `Dithers to` line, all marked DRAFT. The order of Volume against DAC correction. |
| 4 | Modulator panel: every family at once, or family tabs. Whether an engaged matrix that does nothing alters a processed DSD path. |
| 6 | Signal path copy, Top of page copy, Bottom bar copy, all marked DRAFT. |
| 9 | The lines marked DRAFT in `mockup/scripts/data/builders/station-builder.js`. |
| Any | Renaming Resampling to Rate conversion. Whether Auto output mode is offered. The buffer zone seams. |

The mockup leaves these undrawn: the Combo backend's DAC model per sub-device, and tips on touch. Selection in the station tree is unwired.
