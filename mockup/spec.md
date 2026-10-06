# HQPTuner v2 redesign spec

Current state only. Mockup: https://claude.ai/artifact/TDCf3zE1nWfFgKFvui58G7. Code map and conventions: `claude/hqptuner-v2-mockup/README.md`. Mock-only data (stations, numbers, scenarios) lives in `scripts/data/` and isn't repeated here.

## Constraints
- Cohesion through the signal chain. No cards, no parts-bin reorganisation.
- Never invent copy: manual, owner copy or engine enums only, verbatim; manual paragraphs in full.
- No impulse plots. No transport features.
- Target iPad landscape, in points: 1080×810 (10.2", the smallest and the design size), 1180×820 (11": iPad / iPad Air 11") and 1366×1024 (13": iPad Air 13"). The plate is laid out at the picked size and reflows into it (rail stages flex, the `.fill` section takes the spare height, drawers and bodies widen); rendered 1:1, scaled down only below it. Everything fits without scrolling at every size, checked with the real fonts. Phone not required.
- Drawer overflow: first bring the copy closer to its control (narrow the control column), then anything else.
- Aesthetic: tuner / integrated-amp faceplate, dark only.

## Visual rules
- Accent is the user's pick (amber default). It marks only what you set (VFD values, a setting seg's fill, plot traces/handles of settings, dirty dots) and where you are (left-hand selection bar, open stage, view/tab picks as ink with an accent foot, focus, links). Never measurements, semantics, drawings, button faces or read-only readouts.
- Fixed colours that never follow the accent: instrument amber (`--meter*`: Source meter, spectrogram), `--warn`, `--busy`, lamps `--ok` / `--bad`.
- Engine row: speed figure and buffers take the gauge's zones, red | amber | green. Speed seams are the gauge's arcs (0.87×, 1×). Buffer seams 25% / 50% are placeholders.
- Text is never darker than ink-2. ink-3/4 and accent-dim are for strokes and dead states only.
- Hatch only for what can't or doesn't run (unavailable rate tiers, idle chain head).
- No new green lamps; show running state with lettering.
- Selection bars are left-hand everywhere.
- Every control, axis and readout labels its unit; units keep their own case.
- Switches put the default first; gates read BYPASS | ENGAGE; plain settings Off | On.
- Line heights are pinned via `--lh-eng` / `--lh-text`; never `normal`.
- Sizes and colours come from tokens (`tokens.css`); no hand-rolled one-offs.

## Naming
- **Station** = whole hqplayerd config; recalling one restarts.
- **Snapshot** = live subset, saved under a station, no restart. Never holds the HF filter or the volume level.
- **Filter presets** = the old Easy Mode tiles.
- **Matrix profile** = everything the matrix engine runs.

## Frame
- **Header:** brand knob (the connection lamp: ring green Connected, amber Applying… with the pointer sweeping, red Unreachable; tap = connection settings) · HQPTUNER · Station · Snapshot tree-select · Station builder · Snapshot builder · gear.
- **Engine row:** speed gauge + figure, input / output buffers (bars widen with the display: 72 / 130 / 240px at 10.2″ / 11″ / 13″), Clipping and Apodizing lamps with counts (this track over total), then volume `−` | window | `+` at the right end.
- **Body:** rail | page, with drawers over the page. The gear and the builders swap the whole body; header, engine row and bottom bar stay.
- **Bottom bar:** Setting Switcher (or None). Target dropdown, then two slots. A slot's body makes it live; its ▾ opens its list. No A/B keys, no lamp. Slots show the true name small and the full simplified name. Output mode is a target: its slots are the two bands, PCM | SDM (DSD) (no list, no ▾); a slot going live sets the mode, and the mode moving anywhere lights its slot. Output rate is not a target: the page's pins are its live home. **Volume** is a target: the slots give way to the volume bar (−, slider with scale marks and loudness bounds, +, readout), and the engine-row volume hides while it shows. Slot names read in the body face (not mono), so a full simplified name fits one line.

## Rail
- Order (true signal order, as the Signal path map draws it): Source → HF filter → DSD Processing → Matrix engine { DSP pipelines, Crossfeed, Loudness } → Resampling → DAC correction → Volume → Shaping → Speakers → Output.
  - DSD Processing: always shown, hideable; in the path (lit) only while a DSD source plays processed. Value = what it runs for the running mode (`noise · decimation` / the integrator / `Direct`). It comes first because the matrix runs after the conversion to PCM (Jussi).
  - Resampling is the source rate | output rate seam. DAC correction runs at the output rate (Jussi) and needs the matrix (its lamp goes dark with it). Volume sits before Shaping (manual §2.15); its order against DAC correction is unconfirmed.
- Speakers sits after Shaping because delays run at the target rate and apply to Direct SDM's bit-perfect DSD. It is not a matrix plugin.
- Every stage always shows. Off differs only by its unlit lamp, never grayed. Stages flex to fill the rail.
- HF filter, Crossfeed, Loudness, DAC correction and Speakers print no value while switched off.
- Drawers open only from the rail. One open at a time, one wipe at a time.
- Open stage: name in accent + left bar. One stage, one drawer.
- Matrix bypassed: the children's lamps go dark, DSP pipelines and Loudness print no value on the rail, the page section leaves.
- A long value (a DAC model) wraps to a second line rather than being cut off.
- Values: Volume = level only (the mode word only under Fixed volume); Loudness = `x% applied` at the live volume; DSP pipelines = `n active`.

## Drawers (all)
- **Head:** title or tabs, then Discard + split apply button, then a hairline, then close.
  - The split body runs Apply or Apply & save. Its ▾ only switches which one, one choice for all drawers.
  - The group shows while the open tab holds a restart setting or edits are staged.
  - Closing never discards.
- **Lanes:** live rows apply at once; restart rows stage, with a dirty dot on the tab. A drawer with one part has no tab strip; the dot goes on the title. No `↻ restart` marks in drawers.
- **Row grammar:** control column | the manual's paragraph. The picked option's line runs full width under the row, lit. Choice lines are vertical radios, each with its detail control (grayed, never hidden) and its paragraph.
- **Gray:** a reason line under the controls, from v1 copy.
- **One home per setting.** The documented exceptions are two-home pairs that stay in sync.
- **Cross-references** (`Name ›`, accent): only where a line already names another place as its cause or fix and that place is out of sight. The copy never changes; the link carries the place's name. Never on alert lines, never in the Profile builder or the Station builder (their links move within the builders).
  - Matrix engine bypassed (Crossfeed, Loudness, DAC correction, DSP pipelines; Source's DSD meter state) → `Matrix engine ›`.
  - Volume: Fixed volume reason → `Level ›`; min = max = 0 reason → `Range ›`. Range bar → `Loudness ›`.
  - Speakers under Direct SDM → `DSD playback ›` (DSD Processing, SDM out).
  - Shaping (PCM out) dither line → `Output ›` (DAC bits, Format tab).
  - DSP pipelines crossfeed blocks → `Crossfeed ›`.

## Page
- Engaged stages only, in signal order. Fixed spacing (22px between sections); one `.fill` section takes the spare height.
- Every section uses the same two columns: controls | copy or plot.
- One field open per section; others fold to one line (▸ name, why, value; never accented).
  - Exception: at 13″ Resampling opens both 1x and Nx, each with its copy beside it (the spare height goes to the idle filter rather than stretching the Matrix section). At 10.2″ / 11″ the idle one stays folded, also with the Matrix engine bypassed: that room goes to the Source meter.
- Long option copy that would push the page off gives way with `… see more`.
- **Sections:**
  - **Top of page:** Settings → Visual settings → Layout → Top of page:
    - **Auto** (default): both. The spectrum takes the fill; the Matrix engine section folds to its header line (profile select + Profile builder after the hairline, no body) while the matrix engine is engaged, so a profile is one tap away (A/B flat vs EQ'd).
    - **Matrix profile:** the Matrix section at full size, no spectrum. Bypassed, there's no profile, so the spectrum.
    - **Spectrum:** the spectrum alone, no Matrix section.
    - Bypassed: no Matrix section in any mode (engaged stages only). The Setting Switcher's Matrix profile target is the other A/B home.
  - **Source** (Auto, Spectrum, or bypassed): the meter's spectrum + levels, no spectrogram. One Range column left of the spectrum, stacked (60 | 90 | 120 dB), sets both the spectrum's span and the levels' floor (−range); the heads carry titles only. 13″: full, with the readout table. 10.2″ / 11″: slim, the spectrum strip and two bars (sparser axis labels when short), with a 148px floor (≈100px of plot) so the section never collapses under the sections below it; the option copy stays complete at every size (measured: pins on, 10.2″ 102px / 11″ 116px of plot; pins off ≈210). No-stream states show v1's line in an empty glass well. DSD needs the matrix engine engaged (`Matrix engine ›`); engaging keeps the spectrum in place (Auto, Spectrum). Open: whether an engaged, do-nothing matrix alters a processed DSD path (undocumented); if it does, that line must say so. Source is always engaged and first in signal order, so the engaged-stages rule holds.
  - **Matrix profile** (the page section; the rail stage stays Matrix engine): profile select + Profile builder, the description box (user text, ink-2), response plot. In Auto it folds to its header line (above); in Spectrum it's gone.
  - **Resampling** and **Shaping:** one section each, as on the rail (one stage, one drawer, one section; reverses the 2026-10-03 merge, the Source spectrum gives back the header line). Resampling's header carries Filter presets; its body is the 1x / Nx filter, no narrowing tags (narrowing shows only in the filter list). Shaping: modulator or dither.
  - **Chain picker** (1x / Nx filter, modulator, dither): opens its list (sheet or panel). The glass reads family › variant at reading size, then the option's name (accent; the engine name under Option style Standard). No marks, counts, step buttons or sibling strip.
  - **Output:** only while Settings → Behavior → Allow pinned rates is On. Pins off, the Output stage has no job on the page (the rail shows the format, the Output drawer sets it), so it has no section, as Volume has none. The spare height goes to the fill.
    - Pins on: a rate picker, the output rate its whole subject (no source mark, no ratio). One glass, two rows: head column `Auto` | `44.1k · 48k`; one column per tier of the running band: the tier name, then its two exact rates side by side (44.1k family first) with the tier's unit once after the pair, each rate a live pin (one tap, one exact rate). Hatched where the device can't carry a tier. The other band never shows. The rate playing is ringed (ink); the pin, or `Auto`, reads in accent. A mode change clears the pin. The rate limit (restart) never shows on the page.
    - **No mode control on the page.** Output mode is the station's. Two homes, one live state: the Output drawer's Format tab (Output mode, PCM | SDM (DSD), manual §4.2 in full) and the Setting Switcher's Output mode target (slots spelled out, centred: `Pulse Code Modulation (PCM)` | `Sigma Delta Modulation (SDM)` / `aka DIRECT STREAM DIGITAL (DSD)`). Auto ([source]) is not offered anywhere (manual §4.2: it "usually leads to sub-optimal result"; owner's call, pending the community poll); a daemon left in Auto elsewhere just shows where its output lands.
- Volume has no section; its control is in the engine row. HF filter has none when off.
- Resampling and Shaping show the running chain only.

## Alerts
- No strip. Each alert lives where it belongs and blinks there: red = crit, amber = warn or advice. Fixed colours, never the accent. The blink overlays the lamp's state (an unlit lamp blinks too). Reduced motion: steady.
- v1's alerts and copy, verbatim, each where v1's would fire:
  - Credentials rejected (crit) → brand knob, blinking red (steady red stays Unreachable).
  - DSP speed (crit / warn) → engine-row speed figure.
  - Clipping (warn) → Volume lamp.
  - Apodizing on a non-apodizing filter (warn) → Resampling lamp + the page's Resampling header.
  - SDM modulator below its rate floor (crit) → Shaping lamp; every stage after Shaping (Speakers, Output) goes dark (unlit, no wire tap): no output. Line in the page's Shaping header.
  - PCM ditherer below its rate floor (warn) → Shaping lamp + the page's Shaping header.
  - Roon at default idle time (warn) → gear, and Settings → Timing.
  - Junk / HF filter advice (advice) → HF filter lamp. Nx PCM content only: the HF filter can't be engaged at 1x rates.
- **Tap a stage:** its drawer opens with the alert line pinned under the head (glyph, v1's sentence). The row that fixes it reads in the alert's colour with the glyph before its label.
- **Running chain's filter / modulator / ditherer:** the page holds those fields and the drawer drops them, so the alert line (glyph, v1's sentence) sits in that page section's header beside the title, never in the drawer.
- **Tap a header home:** knob and speed figure open the alert in a popover; the gear's Settings rail category blinks and its drawer carries the line.
- Several alerts on one home: the worst sets the blink.
- No hideable stage hosts an alert.
- Dropped: v1's failed preset pick/delete alert (nothing to act on).
- Copy never points at a place by position (`below`, `top bar`) or by a v1 name (`status pill`, `System tab`); it names the v2 place.

## Source drawer
- A meter only (the engine's meter stream taps the source side). No settings, no tabs.
- **Spectrogram** only: it fills the drawer. Apodizing strip on the same time axis; Range (dB, colour span), Channel and Window controls (All = track start to now). Spectrum and levels live on the page's Source section, not here.
- Frequency axes are linear only, the source Nyquist as the last label (no red edge). No CLIP legend.
- No-stream states use v1 copy.

## HF filter drawer
- High-frequency filter: live enum seg, every option listed with its manual line.
- Auto-pilot: live; a manual pick switches it off.
- Pre-process before metering: stages.

## Volume
- **Engine row:** ± 0.5 dB steps, hold repeats. Tapping the window opens a slider popover (level only, true linear scale marks). Live everywhere.
- **Loudness bounds:** marked on both volume sliders while loudness is in effect.
- **Fixed volume / Direct SDM:** the windows show the level alone, and ±, slider and window gray.
- **Drawer tabs Level / Gain / Range.**
  - **Level:** Fixed volume as one choice, Off / Manual (level) / Auto (−3 | −6 headroom).
  - **Gain:** Adaptive volume (live), Playlist album gain, PCM gain compensation.
  - **Range:** v1's shared dBFS bar.
    - Min / Max brackets and a Startup pin, all amber.
    - Live playback needle in green.
    - Loudness bounds as an ink-2 reference with a `Loudness ›` link.
    - Every mark named once beside its glyph; no legend.
    - Grays whole while Fixed volume isn't Off.

## DSD Processing · Resampling · Shaping drawers
- One drawer per stage, one grammar: title, then **PCM out | SDM out** tabs (the output modes; the engine keeps a chain per mode, both settable in every mode). Opens on the running mode; the other tab reads `idle`, and while it shows the head is hatched and the plate darker.
- **DSD Processing:** PCM out = Source gain, Noise filter, Decimation filter; SDM out = DSD playback (Processed | Direct, Direct SDM), Remodulator structure.
- **Resampling:** 1x filter, Nx filter, FFT filter length (only with an FFT-family filter). SDM out heads them `PCM sources` and adds `DSD sources` → Rate conversion (SDM → SDM conversion), the official config page's sections, in the backend subhead grammar.
- **Shaping:** each tab opens on a DAC question (HQPTuner pref, live; manual copy + a DRAFT effect line): PCM out **DAC type** Other | R-2R, SDM out **DAC chip** Other | ESS Sabre. It collapses (never hides) the shaper list's wrong-fit groups: R-2R folds the dither list's Additive family; ESS Sabre folds every Seventh order variant. A tap opens a folded group.
  - Then PCM out = Dither, then a read-only line naming what it dithers to (DAC bits, read off the Output drawer) with `Output ›` (copy DRAFT); SDM out = Sigma-delta modulator. DAC bits stays in Output: it describes the DAC.
- Filters and shapers are live, with two homes (page and drawer) in sync: the drawer shows them too. Everything else stages.
- Under consideration: renaming Resampling → Rate conversion (collides with the SDM → SDM setting of that name; wraps to two lines on the rail).

## Matrix engine family (Matrix engine, Crossfeed, Loudness, DAC correction, DSP pipelines)
- **Profile-wide:** one value store. An edit anywhere lights every member's apply group; Apply in any member applies all.
- Nothing is live; the rail follows on Apply. Matrix bypassed grays every child.
- **Matrix engine:** tabs Basic (Matrix processing, Expand HF) | Advanced (Engine, IIR to FIR); enum options listed with their manual lines.
  - Basic opens on an intro (DRAFT, `data/matrix.js` MX_INTRO): what the matrix engine runs, each part a link to its drawer (`DSP pipelines ›`, `Crossfeed ›`, `Loudness ›`, `DAC correction ›`), and what bypassing does to them. The one cross-reference that isn't a cause or a fix: a family index.
- **Crossfeed:** gate, then a Bauer / Structural choice. The pick is a view choice and never engages crossfeed. The unpicked line folds to a summary.
  - Bauer: presets, Frequency / Level (Custom only), compensation, plot.
  - Structural: presets, angle, head circumference, center character; v1's top-down drawing and readouts, no plot.
- **Loudness:** gate, Bass | Treble switch with its rows, bounds bar (amber here: they are its settings), plot of max vs `x% applied`.
- **DAC correction:** gate + DAC model.
- **DSP pipelines:** tabs Overview + one per output channel.
  - **Overview:** pin grid (inputs down, outputs across; lit pin = gain or `×n`; crossfeed block pins dashed and named), totals, Import EQ, Upload convolution filters, manual copy. Tapping a pin opens its output tab on that input.
  - **Output tab:**
    - Input switch.
    - Fixed 8-line list that pages; crossfeed blocks fold to one line.
    - One-pipeline editor of chips, with Raw for the process string.
    - Stage dock with the manual's tables, and a plot (pipeline / crosspoint sum / output).
  - Up to 128 pipelines.
  - Crossfeed blocks follow the Crossfeed drawer and are locked.

## Speakers drawer
- Own form, own apply group.
- **Gate:** v1 owner copy plus manual §5.
- **Rows:** speaker set (a view choice, never stages), then level and distance per channel, with v1's room plan.
- Under Direct SDM the levels are dead and distances stay live.

## Output drawer
- **Tabs Format | Device.**
- **Format:**
  - Rate dial: one glass, PCM 1x–32x | SDM 64x–2048x, a needle per band, both always live. Hatched = unavailable; green lamp = playing.
  - Output mode first (live; manual §4.2 in full), then the dial, then DSD support, DSD rates, DAC bits; family-only rows carry a band tag and never gray by mode.
- **Device:** Backend, then Channels (`Stereo | 5.1 | 7.1 | Manual`, the number enabled only on Manual; moved from Format so Format fits), then the backend's rows (only the active backend's; Combo shows all and may scroll). Control column 300px (Format 220px): copy closer, so both tabs fit without scrolling.

## Option lists + narrowing
- Filter pickers open a bottom sheet over the bottom bar and body. Picking closes it.
- Modulator and dither pickers open a panel parked at the picker (left edges aligned; below it, else above, else as low as the plate allows), sized to its list. Same head (title, count, facet windows: Minimum rate; modulators also Favorites, shared with filters), rows and hover tip. Rows 25px. A pick, an outside tap, the picker again, × or Escape closes it; facet popovers open over it without closing it.
  - Modulators show every family at once (Hybrid over Fixed, then Adaptive's two variant columns): about 1030×600 at 10.2″, near the sheet's width. Under review against family tabs.
  - Dithers: one column, families stacked, about 340×470.
- **Layout (Simplified):** v1's Simplified outline with blurbs in place, placed per list kind by hand rather than packed by rule.
  - Filters: Polyphase sinc over two columns | Pure sinc (PCM's Misc under it), then Analog-style under its own `Other` title | Conventional and Interpolation under `Other`.
  - No chain tag (PCM / SDM) in any list head: a list is always the running chain's.
  - Rows: name (never wraps) | apodizing mark | stars | heart.
  - Families don't fold (exception: a dither family, whose header folds for DAC type); variants do.
  - Filter lists: a key to the row marks (apodizing, half apodizing, quality, favorite) under the Polyphase sinc family, v1's `glyph = word` grammar.
- **Layout (Standard):** one flat list in engine order (v1: options 1:1), no family or variant headers, blurbs, folds or column titles.
  - Fills down fixed columns (filters 3, modulators 2, dithers 1), each holding a third / half / all of the full list; narrowing reflows from the top of the first column, never leaving gaps.
  - Rows 25px (the room the outline gave up); same marks, stars and heart. The filters' key runs along the sheet's foot.
- **Narrowing** lives in the sheet's head as a console of fixed-width VFD facet windows (owner's order).
  - Each window opens a popover with its controls and its hint, verbatim. Favorites is a plain On / Off switch, no popover.
  - Shaper lists have their own console.
  - The page shows none.
- Hover tips use v1's tip card; touch has none yet.

## Filter presets
- One row per preset. The Perfect Ten and Lifelike each fold Concert Hall + The Crucible as nested rows in that flagship's version; one flagship open at a time.
- Correction is per subset. One lamp across the popover.

## Settings (gear)
- **Rail:** categories with their settings as readouts; no wire or lamps.
- **Page:** About HQPlayer (identity windows, backup) and About HQPTuner.
- **Timing:** idle time, quick pause, short buffer. All restart.
- **Hardware acceleration:** tabs CPU | GPU; Apply to all stations at the foot of both.
- **UPnP:** freewheel.
- **Logging:** enable, path, live log tail.
- **Behavior** (live):
  - Allow pinned rates (owner copy). Shows the page's Output section, the rate pins.
- **Signal path** (read-only; rail readout `Playing`: the path playing now): every path HQPlayer can take on one map, the one playing lit in ink (running state, never the accent). Source rate | output rate as tinted zones, the seam through Resampling. PCM / SDM band tags on mode-only stages, `PCM · SDM` on the filters (both modes, a list each). Hatched = bypassed on the path; dashed = position unconfirmed (DAC correction, Volume). Direct SDM runs under the map into Speakers. Copy DRAFT. Sources: manual §2.8, §2.15, §5, §7.2; Jussi (DAC correction at the output rate, needs the matrix; DSD → PCM convolution after decimation).
- **Visual settings** (live), tabs Display | Layout.
  - Display: descriptions, option style, apodizing indicator, dyslexic font, accent colour.
  - Layout: top of page (Auto | Matrix profile | Spectrum; label and copy DRAFT), bottom bar (Setting Switcher | None; copy DRAFT, the owner's line named the old Volume option), hide stages from the chain (DSD Processing, Speakers, Crossfeed, Loudness, DAC correction; the row stacks its copy under the toggles).

## Snapshot builder
- **Rail:** station folds (one open) with their snapshots, paged, + New snapshot.
- **Head:** Name, Stations (multi-pick; Save writes to every ticked station), Delete · Discard · Save.
- **Rows** in chain order: include | snapshot value | ← | live value; Use live settings.

## Profile builder
- Edits a copy; nothing is heard until Save, which restarts the engine and runs the profile.
- Opens on New profile from what's loaded, so a profile tuned by ear needs only a name and Save.
- **Rail:** Overview + steps with their answers; tap to jump.
- **Overview:**
  - Intro beside the chain picture with the matrix part lit.
  - What the profile holds (› to each step), DSP pipelines access.
  - Profile / Name / Stations / Description.
  - State line, Start from scratch / Change something / Delete / Discard / Save.
  - `Advanced settings ›` at the foot only.
- **Steps:** Listening, EQ / Correction, Crossfeed, DAC correction, Loudness.
  - Drawer row grammar with the manual's copy, Back / Next; the last step's Review returns to the Overview.
  - Skipped steps say why. Values rows lay out two per line.

## Station builder
- The setup wizard's station walk (repo `docs/wizard/wizard.md` §1–§1.7, §4), one station at a time, in the Profile builder's grammar. Edits a copy; Save writes the station. Saving the loaded station, or new Hardware answers, restarts the engine.
- Wizard copy verbatim, `preset` renamed `station`. Agent copy is marked DRAFT in `data/station-builder.js`.
- **Rail:** Overview + steps with their answers (`Skipped` where a step doesn't apply); tap to jump, nothing forces the order.
- **Overview:**
  - The wizard's intro beside the chain picture with the station's part lit (Volume, Output).
  - What the station holds (› to each step), then Matrix profiles (› the Profile builder).
  - Station (picker, every station + New station) / Name.
  - State line, Start from scratch / Change something / Delete (never the loaded station) / Discard / Save.
- **Steps:** Name, Backend, Device, IPv6, USB listings, Connection, Rates, DAC bits · Gain, Volume, Hardware.
  - The wizard's question is the guide line; its answers are choice lines beside the manual's paragraph for the setting they write. Settings borrow the owning drawer's control and paragraph (Discovery, rate dial, DSD support, DSD rates, DAC bits, PCM gain compensation).
  - Device: listings in a glass well grouped by host, an include box each (two listings of one device = the USB listings step). Refresh devices carries the rescan's cost line. The NAA bring-up (wizard §1.2) opens in place: from `Network Audio Adapters ›`, from the Name step's `here`, and on its own when an NAA backend lists nothing.
  - IPv6 (NAA only), USB listings (two listings only) and the 48k-family DSD check print the wizard's lines as they run, then its verdict. A new station starts on IPv4.
  - Connection: USB / I2S runs the check; coax and Toslink fix the limits (hatched beyond them on the dial).
  - DAC bits · Gain: the manual's known values, one tap each; PCM gain compensation grays without native DSD.
  - Volume: Yes = adjustable (Fixed volume Off, range −60 to −3 dB, startup −40 dB); No = Fixed volume Auto at the clipped-material answer's headroom, with the wizard's two hints (the second behind `… see more`).
  - Hardware: the machine's, not the station's; the result reads in Settings' terms and Save writes it to every station.
- Mock outcomes by hash: `#naa-none`, `#ipv6-fail`, `#usb-fail-gone` / `#usb-fail-none`, `#dsd48-no`.

## Mock scenarios (viewing tool, not app UI)
- A strip above the plate sets the source: Not playing / PCM 44.1 / PCM 192 / DSD64. Its Display switch (10.2″ | 11″ | 13″, `#size-11` / `#size-13`) lays the plate out at that iPad size; the app itself has no size control. Its Alerts picker raises any of the alerts; each fires only where v1's would (engine health while playing, a shaper conflict only in the running family). Output mode, DSD playback and Matrix stay the user's settings, so the path falls out of config.
- Nothing hides; lamps, values and readouts follow what plays.
- **DSD → PCM:** DSD Processing lit (noise filter · decimation), then the Nx filter.
- **DSD → SDM processed:** DSD Processing lit (the integrator); Resampling's slot reads `Rate conversion`, its value the SDM → SDM pick.
- `#mode-auto`: the daemon left in Auto by another client (read-only state).
- **Direct:** no block. Resampling and Shaping leave the chain; everything but Speakers reads unlit, and volume is fixed at −3 dB.
- Page fields not in the path read `· idle`.
