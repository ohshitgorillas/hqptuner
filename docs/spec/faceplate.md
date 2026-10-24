# Faceplate: controls and behavior

Current state only.

The control set is **not enumerated in prose**.

## Constraints
- Cohesion through the signal chain. No cards, no parts-bin reorganization.
- Never invent copy: manual, owner copy or engine enums only, verbatim; manual paragraphs in full.
- No impulse plots. No transport features.
- Display row (Settings' Visual settings): Auto | Expanded | Normal | Compact.
- Drawer overflow: first bring the copy closer to its control (narrow the control column), then anything else.
- Aesthetic: tuner / integrated-amp faceplate, dark only.

## Visual rules
- Engine row: speed figure and buffers take the gauge's zones, red | amber | green. Speed seams are the gauge's arcs (0.87×, 1×). Buffer seams 25% / 50% are placeholders.
- Switches put the default first; gates read BYPASS | ENGAGE; plain settings Off | On.

## Naming
- **Station** = whole hqplayerd config; recalling one restarts.
- **Snapshot** = live subset, saved under a station, no restart. Never holds the HF filter or the volume level.
- **Filter presets** = the old Easy Mode tiles.
- **Matrix profile** = everything the matrix engine runs.

## Frame
- **Header:** brand knob (the connection lamp: ring green Connected, amber Applying… with the pointer sweeping, red Unreachable; tap = connection settings) · HQPTUNER · Station · Snapshot tree-select · Station builder · Snapshot builder · gear.
- **Engine row:** speed gauge + figure, input / output buffers (bars widen with the display: 102 / 130 / 240px at Compact / Normal / Expanded), Clipping and Apodizing lamps with counts (this track over total), then volume `−` | window | `+` at the right end.
- **Body:** rail | page, with drawers over the page. The gear and the builders swap the whole body; header, engine row and bottom bar stay.
- **Bottom bar:** Setting Switcher (or None). Target dropdown, then two slots. A slot's body makes it live; its ▾ opens its list. No A/B keys, no lamp. Slots show the full simplified name under Option style Simplified, and the engine name alone under Standard.

  Output mode is a target: its slots are the two bands, PCM | SDM (DSD) (no list, no ▾); a slot going live sets the mode, and the mode moving anywhere lights its slot. Output rate is not a target: its live pin is the Output drawer's rate dial. **Volume** is a target: the slots give way to the volume bar (−, slider with scale marks and loudness bounds, +, readout), and the engine-row volume hides while it shows. Slot names read in the body face (not mono), so a full simplified name fits one line.

## Rail
- Order (true signal order, the physical processing order): Source → HF filter → DSD Processing → Matrix engine { DSP pipelines, Crossfeed, Loudness } → Rate conversion → Speakers → DAC correction → Volume → Shaping → Output.
  - DSD Processing: always shown, hideable; in the path (lit) only while a DSD source plays processed. Value = what it runs for the running mode (`noise · decimation` / the integrator / `Direct`). It comes first because the matrix runs after the conversion to PCM.
  - Rate conversion is the source rate | output rate seam. Its name is `Rate conversion`, and `Resampling` while a PCM resampling filter other than `none` converts the rate (PCM → PCM, PCM → SDM, DSD → PCM). Lit only while the output rate differs from the source rate: the running filter on a resampling path, the SDM → SDM conversion on SDM → SDM. Its drawer's title follows the name.
  - Speakers runs at the output rate (manual §5), after Rate conversion and before the shaping stages, and applies to Direct SDM's bit-perfect DSD. It is not a matrix plugin.
  - DAC correction and Volume are part of shaping. DAC correction runs at the output rate and needs the matrix (its lamp goes dark with it). Volume's order against DAC correction is undocumented.
- A stage whose drawer holds a staged, unapplied edit carries an accent dot after its name, hover text `Staged changes`. Only that drawer's stage carries it, never its family's other members.
- Every stage always shows. Off is the name under an unlit lamp, never grayed. Stages flex to fill the rail.
- A stage whose lamp reads unlit prints no value: off, bypassed on the playing path, or darkened by an alert.
- Drawers open only from the rail. One open at a time, one wipe at a time.
- Open stage: name in accent + left bar. One stage, one drawer.
- Matrix bypassed: the children's lamps go dark, the page section leaves.
- A long value (a DAC model) wraps to a second line rather than being cut off.
- Values: Volume = level only (the mode word only under Fixed volume); Loudness = `x% applied` at the live volume; DSP pipelines = `n active`.

## Drawers (all)
- **Head:** title or tabs, then Discard + split apply button, then a hairline, then close.
  - The split body runs Apply or Apply & save. Its ▾ only switches which one, one choice for all drawers.
  - The group shows while the open tab holds a restart setting or edits are staged.
  - Closing never discards.
- **Lanes:** live rows apply at once and carry no mark. A setting that restarts the engine carries `↻` on the nearest head that names it, from the moment it is drawn and before any edit, so the cost is known before the tap: a row's label; a choice's header, its lines bare; a block's header where its controls share one (the volume range, the loudness range), its boxes bare. One exception: under a pinned family the Output rate dial row's header is bare, since a tap on the running band pins live.

  A drawer whose form writes the engine's config or a daemon form (Hardware acceleration) marks the head of every control its form applies; Speakers carries one mark, on its switch row's head, its channel rows bare; a browser preference it also draws (the speaker set pick) stays bare. Restart rows stage, with a dirty dot on the tab. A drawer with one part has no tab strip; the dot goes on the title.
- **The restart mark is `↻`, the glyph alone, everywhere:** one style (`.rs`), on a station row not loaded, on a restart setting's head, and in front of a builder's state line while saving restarts the engine. The mark takes its label's size. Every mark carries a hover tip: `Applying this setting restarts the engine` on a setting's head, `This restarts the engine` on a station row and the builder's state line. Nothing marks what applies live, and nothing marks a browser preference.
- **Row grammar:** control column | the manual's paragraph. The picked option's line runs full width under the row, lit. Choice lines are vertical radios, each with its detail control (grayed, never hidden) and its paragraph.
- **Gray:** a reason line under the controls, from v1 copy.
  - Disclosure follows staged values, not applied ones, so it updates before Apply.
- **One home per setting.** The documented exceptions are two-home pairs that stay in sync.
- **Cross-references** (`Name ›`, accent): only where a line already names another place as its cause or fix and that place is out of sight. The copy never changes; the link carries the place's name. Never on alert lines, never in the Profile builder or the Station builder (their links move within the builders).
  - Matrix engine bypassed (Crossfeed, Loudness, DAC correction, DSP pipelines; Source's DSD meter state) → `Matrix engine ›`.
  - Volume: Fixed volume reason → `Level ›`; min = max = 0 reason → `Range ›`. Range bar → `Loudness ›`.
  - Speakers under Direct SDM → `DSD playback ›` (DSD Processing, SDM out).
  - Shaping (PCM out) dither line → `Output ›` (DAC bits, Format tab).
  - DSP pipelines crossfeed blocks → `Crossfeed ›`.

## Controls (all)
- Switches, number boxes, selects and sliders behave alike wherever they are drawn: drawers, page, popovers, builders, Settings. A control reports a change; its setting's lane decides what the change writes (live at once or staged, Lanes above), and its owner decides what value it holds after a refused write (the speakers/headphones view keeps the user's pick, `matrix.md`; a refused star reverts, `state.md`).
- **Switch** (segmented): one button per option, lit on the option equal to the value its owner holds. A click on any button, the lit one included, reaches the owner, which decides whether it does anything (every hand click on the speakers/headphones switch records, `matrix.md`). Off grays the whole switch and no button takes a tap. An option its list marks unavailable shows grayed and takes no tap; whether a list grays, hides or offers an option is that list's own rule. An option holding a staged edit carries the accent dot. A screen reader hears a radio group under the switch's name, each option a radio, checked when lit; each option is its own tab stop.
- **Number box:** typing is never overwritten by a poll; the box takes its owner's value again only while it is not being edited. A value commits on Enter or when the box loses focus, never per keystroke. A blank or non-numeric box commits nothing and shows the owner's value again. A number outside the bounds commits as the nearest bound. After a commit the box shows the value that landed. The mouse wheel never changes it.
  - Open: whether the DSP pipelines response plot, which "updates live while a stage field changes" (`matrix.md`), follows each keystroke or each commit.
  - A box's minimum, maximum and step come from the field's reading `bounds` (`api.md` "Field readings"), which the server fills from the daemon form's own limits and from `VolumeRange`. The unit is display copy kept in the schema entry, since no wire field carries one. HQPlayer bounds every value, so every control takes the daemon's bounds, and no client default stands in for one.
- **Select:** shows the value its owner holds, so a pick the owner does not take snaps back. An option its list marks unavailable shows grayed and cannot be picked. A value matching no option shows no option picked. The mouse wheel never changes it.
- **Slider:** a track and a number box showing one value. The thumb moves only under a held pointer or a key pressed while it has focus, never under the wheel or a pointer passing over it. Each move and the release are reported, and the lane decides what a move writes (the compensation strength previews while dragging and commits on release, `crossfeed-compensation.md`).
- **Staged row:** a row whose setting holds a staged edit carries the accent dot on its label, as its tab or title does for the drawer.
- **Folded choice line:** where a choice folds its unpicked lines (Crossfeed; the Profile builder's choice steps), an unpicked line shows its name and, where it has one, a one-line summary, never its paragraph. A tap on it picks it.

## Page
- Engaged stages only, in signal order. Fixed spacing (22px between sections); one `.fill` section takes the spare height.
- Every section uses the same two columns: controls | copy or plot.
- One field open per section; others fold to one line (▸ name, why, value; never accented).
  - Exception: at Expanded, Resampling opens both 1x and Nx, each with its copy beside it (the spare height goes to the idle filter rather than stretching the Matrix section). At Normal and Compact the idle one stays folded, also with the Matrix engine bypassed: that room goes to the Source meter.
- Long option copy that would push the page off gives way with `… see more`.
- **Sections:**
  - **Top of page:** Settings → Visual settings → Layout → Top of page:
    - **Auto** (default): both. The spectrum takes the fill; the Matrix engine section folds to its header line (profile select + Profile builder after the hairline, no body) while the matrix engine is engaged, so a profile is one tap away (A/B flat vs EQ'd).
    - **Matrix profile:** the Matrix section at full size, no spectrum. Bypassed, there's no profile, so the spectrum.
    - **Spectrum:** the spectrum alone, no Matrix section.
    - Bypassed: no Matrix section in any mode (engaged stages only). The Setting Switcher's Matrix profile target is the other A/B home.
  - **Source** (Auto, Spectrum, or bypassed): the meter's spectrum + levels, no spectrogram. Its header carries Display, a popover holding Spectrum style (Trace | Bars | Ridges | Aurora | Fade), Levels floor (−48 | −60 | −90 dBFS, default −60) and Frequency span (Full | 1/2 | 1/4 of the band up to the source Nyquist, opening at Full on every load, never remembered), no help text. At a narrower Frequency span the spectrum spreads 0 Hz to the top of the view across its width; the ticks, the grid and the last label follow the top of the view, and the last label's Source Nyquist title shows at Full only.

    The Range control sits in the spectrum's top-right corner at every size: two bare round keys, − | +, each drawn small with a tablet-size tap area, one step along 120 | 180 | 240 | 300 dB a tap, the key at its end stop dimmed and inert; the dB axis shows the range, so there is no readout. The Range sets the spectrum's span only; the levels read from 0 dBFS down to the Levels floor, a preference of its own; the heads carry titles only.

    VU meters: two needle meters, L over R, each face taking the shape of its space with a round arc spanning its width, scale −20 to +3 VU, red above 0, IEC 60268-17 dynamic response, driven by each channel's RMS; 0 VU sits at the VU reference (−14 | −18 | −20 dBFS, default −18), a preference of its own; no peak lamp, the Clipping lamp covers it.

    Expanded: full, the levels column a strip of the bars running sideways over their scale, the VU pair filling the column under it to the plot's foot, no readout table, no Meters switch; Display holds both Levels floor and VU reference.

    Compact / Normal: slim, the spectrum strip beside the bars or a VU square as tall as the levels column, picked by Display's Meters (Levels | VU, default Levels), with Levels floor or VU reference after it following the pick (sparser axis labels when short), with a 148px floor (≈100px of plot) so the section never collapses under the sections below it; the option copy stays complete at every format (measured: pins on, Normal 116px of plot; pins off ≈210).

    No-stream states show v1's line in an empty glass well. DSD needs the matrix engine engaged (`Matrix engine ›`); engaging keeps the spectrum in place (Auto, Spectrum). Open: whether an engaged, do-nothing matrix alters a processed DSD path (undocumented); if it does, that line must say so. Source is always engaged and first in signal order, so the engaged-stages rule holds.
  - **Matrix profile** (the page section; the rail stage stays Matrix engine): profile select + Profile builder, the description box (user text, ink-2), response plot. In Auto it folds to its header line (above); in Spectrum it's gone.
  - **Resampling** and **Shaping:** one section each, as on the rail (one stage, one drawer, one section). Resampling's header carries Filter presets; its body is the 1x / Nx filter, no narrowing tags (narrowing shows only in the filter list). Shaping: modulator or dither.
  - **Chain picker** (1x / Nx filter, modulator, dither): opens its list (sheet or panel). Under Option style Simplified the glass reads family › variant at reading size, then the plain name (accent); under Standard it reads the engine name alone (accent). No marks, counts, step buttons or sibling strip.
  - **No mode control on the page.** Output mode is the station's. Two homes, one live state: the Output drawer's Format tab (Output mode, PCM | SDM (DSD), manual §4.2 in full) and the Setting Switcher's Output mode target (slots spelled out, centered: `Pulse Code Modulation (PCM)` | `Sigma Delta Modulation (SDM)` / `aka DIRECT STREAM DIGITAL (DSD)`). Auto ([source]) is not offered anywhere (manual §4.2: it "usually leads to sub-optimal result"); a daemon left in Auto elsewhere just shows where its output lands.
- Volume has no section; its control is in the engine row. Output has none: the rail shows the format, the Output drawer sets it, and the output rate pin lives on the drawer's rate dial. HF filter has none when off.
- Resampling and Shaping show the running chain only.

## Alerts
- No strip. Each alert lives where it belongs.
- These lines show directly under the header on every view, with no tap. Settings a daemon restart dropped (warn): its line has one row per setting, stays until tapped, and the tap clears the report. Six failure lines, each warn: a failed apply, a failed live write, a failed snapshot, a failed profile description, a failed favorite, a failed narrowing. Each failure line clears when its area next succeeds or when tapped. The brand knob shows connection status only and never carries it.
- v1's alerts and copy, verbatim, each where v1's would fire:
  - Credentials rejected (crit) → brand knob, blinking red (steady red stays Unreachable).
  - DSP speed (crit / warn) → engine-row speed figure.
  - Clipping (warn) → Volume lamp.
  - Apodizing on a non-apodizing filter (warn) → Resampling lamp + the page's Resampling header.
  - SDM modulator below its rate floor (crit) → Shaping lamp; every stage after Shaping (Output) goes dark (unlit, no wire tap): no output. Line in the page's Shaping header.
  - PCM ditherer below its rate floor (warn) → Shaping lamp + the page's Shaping header.
  - Roon at default idle time (warn) → gear, and Settings → Timing.
  - Junk / HF filter advice (advice) → HF filter lamp. Nx PCM content only: the HF filter can't be engaged at 1x rates.
- **Tap a stage:** its drawer opens with the alert line pinned under the head (glyph, v1's sentence). The row that fixes it reads in the alert's color with the glyph before its label.
- **Running chain's filter / modulator / ditherer:** the page holds those fields and the drawer drops them, so the alert line (glyph, v1's sentence) sits in that page section's header beside the title, never in the drawer.
- **Tap a header home:** knob and speed figure open the alert in a popover; the gear's Settings rail category blinks and its drawer carries the line.
- Several alerts on one home: the worst sets the blink.
- No hideable stage hosts an alert.
- Copy never points at a place by position (`below`, `top bar`) or by a v1 name (`status pill`, `System tab`); it names the v2 place.

## Source drawer
- A meter only (the engine's meter stream taps the source side). No settings, no tabs.
- **Spectrogram** only: it fills the drawer. Apodizing strip on the same time axis; Range (dB, color span), Channel and Window controls (All = track start to now). Spectrum and levels live on the page's Source section, not here.
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
- **Rate conversion** (titled as the rail names the stage): 1x filter, Nx filter, FFT filter length (only with an FFT-family filter). SDM out heads them `PCM sources` and adds `DSD sources` → Rate conversion (SDM → SDM conversion), the official config page's sections, in the backend subhead grammar.
- **Shaping:** each tab opens on a DAC question (HQPTuner pref, live; manual copy + a DRAFT effect line): PCM out **DAC type** Other | R-2R, SDM out **DAC chip** Other | ESS Sabre. It collapses (never hides) the shaper list's wrong-fit groups: R-2R folds the dither list's Additive family; ESS Sabre folds every Seventh order variant. A tap opens a folded group.
  - Then PCM out = Dither, then a read-only line naming what it dithers to (DAC bits, read off the Output drawer) with `Output ›` (copy DRAFT); SDM out = Sigma-delta modulator. DAC bits stays in Output: it describes the DAC.
  - SDM modulator options whose floor is above the selected SDM rate are grayed **with a short reason** (e.g. "needs ≥ 40.96 MHz"), never hidden: visible-but-disabled teaches the constraint.
  - **PCM dithers gray nowhere**: their floors are the manual's recommendations, and a dither below its floor still produces output, so every dither stays selectable at every rate. **Rates never gray by shaper**, in either family: that would lock the user into the higher rate, a worse failure than the one it fixes.
- Filters and shapers are live, with two homes (page and drawer) in sync: the drawer shows them too. Everything else stages.
## Matrix engine family (Matrix engine, Crossfeed, Loudness, DAC correction, DSP pipelines)
- **Profile-wide:** one value store. An edit anywhere lights every member's apply group; Apply in any member applies all.
- Nothing is live; the rail follows staged edits. Matrix bypassed grays every child.
- **Matrix engine:** tabs Basic (Matrix processing, Expand HF) | Advanced (Engine, IIR to FIR); enum options listed with their manual lines.
  - Basic opens on an intro (DRAFT, the `intro` of the Basic tab of `MATRIX_DRAWER` in `hqptuner/static/components/faceplate/drawers/matrix.js`): what the matrix engine runs, each part a link to its drawer (`DSP pipelines ›`, `Crossfeed ›`, `Loudness ›`, `DAC correction ›`), and what bypassing does to them. The one cross-reference that isn't a cause or a fix: a family index.
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
    - **Uncertainty narrows nothing**: no announcement, an announcement naming a device other than the staged one, or the `combo` backend (two devices, one announcement, unknown which limits bind) all leave every menu whole. Graying an option the hardware can in fact reach is the worse failure, so the rule is one-directional.
    - **A setting already sitting on an unreachable value falls back**, to the highest reachable tier, or to PCM where no DSD rate is reachable at all, **as a staged edit, never a display-only substitution**, so the Output drawer marks it staged and its Discard undoes it. That it costs a restart at Apply is the user's to spend.
  - Pin picker `Auto | 44.1k | 48k` at the end of the dial row's header line (`Output rate`, sub-label `PCM and SDM target rates`), its buttons the height of the drawer's other switches and one width, only while Settings → Behavior → Allow pinned rates is On. Under Auto a tap moves the band's limit (staged). Under a family a tap on the running band pins that tier's exact rate in that family (live, nothing staged); a tap on the other band moves its limit. Picking a family writes nothing; Auto clears the pin. Each drawer opening reads the pin's family, else Auto.

    Under a family the dial row's header carries no `↻`; Auto, or Allow pinned rates Off, keeps it. The glass always prints both rates of every tier: under Auto all of them read lit (`--ink`); under a family the picked family's rates stay lit and the other family's step back to `--ink-2` on every tier, the needle's included, still shown. The pinned rate is boxed in accent on its tier. A mode change clears the pin.
  - Output mode first (live; manual §4.2 in full), then the dial, then DSD support, DSD rates, DAC bits; family-only rows carry a band tag and never gray by mode.
  - The Output mode row and the DAC bits rows show the start of their paragraph, then `… see more`, which opens the rest in a note popover. A drawer row opts in through `more` on its `settings.json` entry: `tooltip` holds the start shown, `more` the rest, a blank line between its paragraphs. A two-stage filter's note waits behind `… see more` the same way. On the 13″ plate nothing waits: every paragraph shows in place.
- **Device:** Backend, with one line for each backend the daemon offers, then Channels (`Stereo | 5.1 | 7.1 | Manual`, the number enabled only on Manual; moved from Format so Format fits), then the backend's rows (only the active backend's; Combo shows all and may scroll). Control column 300px (Format 220px): copy closer, so both tabs fit without scrolling.

## Option lists + narrowing
- Filter pickers open a bottom sheet over the bottom bar and body. Picking closes it.
- Modulator and dither pickers open a panel parked at the picker (left edges aligned; below it, else above, else as low as the plate allows), sized to its list. Same head (title, count, facet windows: Maximum rate; modulators also Favorites, shared with filters), rows and hover tip. Rows 25px. A pick, an outside tap, the picker again, × or Escape closes it; facet popovers open over it without closing it.
  - Modulators show every family at once (Hybrid over Fixed, then Adaptive's two variant columns): about 1106 px wide at Compact, near the sheet's width.
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
  - Facets AND-combine with each other across both the 1x and Nx lists. **Within** genre and focus the user picks how their own values combine, with an AND/OR switch closing each popover (genre defaults to OR, focus to AND). Phase and length are multi-select too but carry no such switch and always union: a filter holds exactly one phase and exactly one length, so an AND across two picks is empty by construction.
  - A mode set while its facet is unpicked narrows nothing and does not count as narrowing engaged. Genre's `any` tag outranks the mode: the manual marks such a filter as suiting every genre, so it survives either way; focus has no such tag. Narrowing hides the running selection like any other option it excludes. An empty result, in a filter list or a modulator list, shows an explicit "Nothing matches. Try different narrowing criteria." state, never a stale selection.
  - **Static facets fill in for the inactive mode.** The live enumeration covers only the active mode, so filters exclusive to the inactive mode would carry no facets and bypass narrowing. Quality, focus, apodizing and ratio are transcribed into `data/filters.json` as the **fallback for filters the live enumeration omits**. Live stays sole authority for the active mode.
  - **Length and adaptive are overlay-first.** The wire carries no length or adaptive signal, so these two facets are the exception to live-first: a `length` token or `adaptive` bool on a filter's `data/filters.json` row wins over the name-token rules, which remain the fallback for names the overlay does not reach. Enumeration authority is untouched: the overlay still joins by name and decides nothing about which filters exist.
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
  - Allow pinned rates (owner copy). Shows the rate dial's pin picker.
- **Visual settings** (live), tabs Display | Layout.
  - Display: descriptions, option style, apodizing indicator, dyslexic font, accent color.
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
- The setup wizard's station walk (repo `docs/spec/wizard/wizard.md` §1–§1.7, §4), one station at a time, in the Profile builder's grammar. Edits a copy; Save writes the station. Saving the loaded station, or new Hardware answers, restarts the engine.
- Wizard copy verbatim, `preset` renamed `station`. Agent copy is marked DRAFT.
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
- A strip above the plate sets the source: Not playing / PCM 44.1 / PCM 192 / DSD64. Its Display switch (Compact | Normal | Expanded) lays the plate out at that format, as the app's own Display row does. Its Alerts picker raises any of the alerts; each fires only where v1's would (engine health while playing, a shaper conflict only in the running family). Output mode, DSD playback and Matrix stay the user's settings, so the path falls out of config.
- Nothing hides; lamps, values and readouts follow what plays.
- **DSD → PCM:** DSD Processing lit (noise filter · decimation), then the Nx filter.
- **DSD → SDM processed:** DSD Processing lit (the integrator); Resampling's slot reads `Rate conversion`, its value the SDM → SDM pick.
- `#mode-auto`: the daemon left in Auto by another client (read-only state).
- **Direct:** no block. Resampling and Shaping leave the chain; everything but Speakers reads unlit, and volume is fixed at −3 dB.
- Page fields not in the path read `· idle`.
