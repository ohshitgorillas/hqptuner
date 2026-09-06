# Changelog

Notable changes to HQPTuner. Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/) once out of beta.

## [Unreleased]

### Fixed

- **A setting is no longer reported applied when the daemon has stopped answering.** A daemon that went quiet mid-write could leave HQPTuner reporting an unapplied setting as applied, or showing a value that was never the one it asked for. It now reports the daemon unavailable until the connection is back.
- **Rejected hqplayerd credentials are now reported.** An install whose management credentials the daemon refuses showed a connected status and empty settings, then quoted a raw HTTP error at the end of a long apply. The refusal is now named on the alert strip, in the apply caption and in the log, and the apply fails immediately.

## [1.14.0] — 2026-09-01

### Added

- **High-frequency filter auto-pilot engages and disengages the filter as the playing track warrants.** Off by default; setting the filter by hand switches it off, and both live and general presets carry it.
- **The Length dropdown gains Extra-short, Stupid long, and Adaptive rows.** Extra-short collects the polynomial interpolators; Stupid long the million-tap filters; Adaptive matches the sinc filters whose tap count scales with conversion ratio. A filter can hold both a length and the adaptive trait.
- **The narrowing dropdowns carry hints on how to use each facet.**
- **Easy Mode replaces the filter cards with a small set of curated presets.** A link in the Narrow Filters header swaps the narrowing and chain cards for one card of preset tiles, each with its own emphasis and source adjustments, on the Output tab and the LIVE page; a link inside it swaps back.
- **Added an apodizing indicator light to the top bar.** Brightness indicates density. Enabled in the HQPTuner card in the System tab.
- **Dyslexic font mode.** Added the ability to switch the app's non-monospaced font from Inter to Atkinson Hyperlegible, a dyslexic-friendly font. Enabled in the HQPTuner card in the System tab.

### Changed

- **Selecting a preset in LIVE mode loads it immediately.** Previously the pick only staged a preview, and applying it meant leaving LIVE for the Apply button.
- **Live presets optionally omit settings.** Saving a live preset opens a popover with checkboxes for choosing which settings the preset carries.
- **Filter narrowing counts (1x/Nx columns) in narrowing dropdowns move to the left of the option.** This prevents them from being separated from their option by tons of dead space.
- **The Mode card moves up beside LIVE MODE.** Both sit in the locked top row: the lede and the preset picker stack on the left, Mode fills the right half. Its old movable slot is gone, and a saved layout order drops it on load.
- **SDM filter menus drop superseded single-stage variants.** On the SDM chain a filter whose `-2s` two-stage variant exists no longer appears in the 1x and Nx lists or their counts; a selection already set to one stays listed. Simplified option style drops the two-stage clause from the names and the two-stage notes from the description.

### Removed

- **The LIVE page drops its rate control.** HQPlayer offers no live route that changes the output rate limit without pinning an exact rate or restarting the engine, so rate selection lives on the Output tab, where an apply is expected to reload the engine. Saved live presets no longer store a rate; a preset that carries one applies its other settings and leaves the rate alone.

### Fixed

- **Re-selecting a live preset now re-applies the settings.** Before, changing a setting left no way to re-engage the selected Live preset. Now there is.
- **Preset names sort by number.** DSD1024 listed above DSD256 in both preset pickers, because the digits sorted as text.

## [1.13.0] — 2026-08-26

### Added

- **The Hardware acceleration card's apply button turns accent once a setting is changed, and a revert button restores the values the daemon last reported.** The button was styled like the backup links beside it, so a changed setting could sit unapplied with nothing marking that a click was owed.

## [1.12.0] — 2026-08-25

### Added

- **Modulator hover tips name the generation.** Every SDM modulator carries a Generation row in its tip, the design lineage stated in the HQPlayer manual, from 1st through 8th.

- **Limited-SNR modulators confirm before pairing with HQPlayer's volume control.** Selecting AHM5EC5L or AHM7EC5L while the volume control is live opens a confirmation, as does freeing the volume control while one of them is selected. A preset preview that lands on the same pairing, or on Direct SDM against a volume not fixed at -3 dB, asks on Apply instead.

### Changed

- **FFT filter length moves into the chain card that uses it.** It leaves its own card on the Output tab and renders under the shaper in the PCM or SDM chain, as a slider stepping through the lengths the engine offers, only while that chain has an FFT filter selected.

### Fixed

- **Slider tick marks line up with the values they mark.** A mark sat up to half a thumb width from its own position, worst at the ends of a range, which the PCM gain compensation slider showed at both of its marks.

## [1.11.3] — 2026-08-24

### Added

- **Filter narrowing can pick filters whose length is unspecified.** The Length dropdown gains an Unspecified row, so excluding one length no longer also drops every filter the taxonomy does not classify. Its button counts named lengths and reports the unspecified pick as a clause.

### Changed

- **The Phase dropdown's row for unclassified filters reads Unspecified.** It was labeled No phase.

- **Settings tooltips reworded for readability.** Thirty tooltips across the Output, DSP, Volume, and System tabs no longer carry the manual's missing articles, comma splices, and fragments; output mode copy now says Auto, and DSD playback copy follows its rename.

### Fixed

- **Narrowing rows no filter can reach are marked unavailable.** A genre, focus, phase, or length row is dimmed with a tooltip when nothing matches it under the other facets, and when picking it would empty both filter lists. Picking a phase left every Medium and Extra long row reading the full total, since a further length pick widens the list instead of narrowing it.

- **Buttons, dropdowns, and text fields render in the interface font.** Form controls never inherited the page's typography, so every button, select, and input sat in the browser's default font instead of the one the rest of the page loads.

## [1.11.2] — 2026-08-23

### Changed

- **The filter and signal chain descriptions return to the manual's terse register.** The fluent-English pass added leading articles and padding the originals did without; those come back out across the filter, modulator, integrator, noise filter, conversion and dither blurbs and the chain tooltips. Multiplier notation reads uniformly as 4096x style, rate comparisons read as ≥/≤, and poly-sinc-short-mp names poly-sinc-short instead of the manual's shrt shorthand. Grammar and spelling fixes stay.

- **Two Simplified names change on Signalyst feedback.** The Integrator control's Simplified name becomes Remodulator structure, since Reconstruction filter changed the meaning, and SDM → SDM conversion becomes Rate conversion, since Source bandwidth suggested an effect even at matching rates. The signal path rows follow.

### Fixed

- **A failed preset save during apply now reports the save error.** The summary previously showed the apply's success sentence with a failure mark and dropped the error.

## [1.11.1] — 2026-08-22

### Changed

- **The Direct SDM checkbox becomes a DSD Playback switch.** The SDM Chain card's DSD sources section now offers Processed and Direct as a two-button segment in place of the Direct SDM checkbox, and the control carries "Direct SDM" as its sublabel so HQPlayer's own name stays findable.

- **The DSD source controls honor the Option style switch.** In Simplified, Integrator reads Reconstruction filter, SDM → SDM reads Source bandwidth, and the Noise filter and the Decimation filter, formerly SDM to PCM conversion, group into plain-English families, with Bypass holding the no-decimation option. Options the manual recommends carry an accent check with a "✓ = recommended" legend, and the signal path rows follow the renames.

- **The Simplified filter families regroup around Conventional and Interpolation.** FFT joins the Conventional family as a Brickwall variant, leaving Misc to no resampling and asynchronous rate conversion alone, and Closed form and Polynomial merge into one Interpolation family captioned "Generates new samples along a curve rather than by filtering", so the dropdowns list Analog-style, Conventional, Polyphase sinc, Interpolation, Pure sinc, then Misc.

- **The filter and SDM chain descriptions read as fluent, consistent English.** The blurbs gain articles, resolve comma splices and give bare fragments a verb; spellings like hi-res and half-band match everywhere, hints name the renamed controls, rate floors read with a proper ≥ sign, and the Option style hint covers every list it simplifies instead of naming only the filter, dither and modulator lists. No technical claim changes.

- **Every triangle mark is drawn as a shape and sits level with its text.** The disclosure triangles on card heads and dropdown group headers, the caret on a closed dropdown and the mark on a selected option no longer render as text characters, so each centers on its row instead of hanging low, and the caret grows to a visible size within the same row height.

- **The selected option carries an accent mark in the dropdown list.** An open dropdown draws a small triangle in the gutter beside the option currently in force, which is what the long Simplified lists need to be scannable. The selected row no longer sets itself apart by weight alone, which read as a group header among them.

- **The two high attenuation pure sinc leaves read "Long with high attenuation".** The `sinc-Lh` and `sinc-long-h` rows drop the earlier "Long length, high attenuation" phrasing in both the leaf label and the flattened Standard name.

## [1.11.0] — 2026-08-21

### Added

- **The modulator dropdown gains favorites and rate-floor badges.** Modulator rows carry the same heart the filter rows do, on their own set of stars, and favorites-only narrowing reaches the modulator list only once a modulator is starred. A modulator that needs DSD256, DSD512 or DSD1024 and higher wears that tier in accent beside its name, and the name no longer repeats the rate.

- **Filter rows show each filter's quality rating as stars.** Every row in the filter dropdowns, Simplified or Standard, carries the engine's relative quality rating as one to five filled stars beside its name. The favorite toggle becomes a heart so the two marks stay distinct, and the Favorites chip follows.

- **Filter dropdowns badge apodizing; Simplified groups fold.** In both option styles, every apodizing filter row carries a circled accent A, half-apodizing a circled ½, beside its name; the three Simplified names that spelled out apodizing rely on the badge instead. Family and variant groups collapse and expand from their headers, and the folds persist across reloads.

- **Simplified dither and modulator dropdowns caption every family.** A one-line blurb under each header says what the group covers, and the modulator sections caption their fifth and seventh order groups as well, so picking Noise shaping or Adaptive no longer requires knowing the terms.

- **Engine health charts apodizing events over time.** A strip under the meters plots how thickly events fall across recent playback, scrolling right to left, so a burst in an opening section reads differently from ten events spread across a track. The time axis covers 30 seconds to 5 minutes or everything recorded, and the strip appears only once a track logs an event.

### Changed

- **The FIR filters gather into one Conventional family, and the families reorder.** Classic oversampling and Minimum ringing become variants of a single family captioned "Cheap, short, low-load filters like those built into most DACs". The Simplified filter dropdowns list Analog-style, Conventional, Polyphase sinc, Pure sinc, Closed form, Polynomial, then Misc.

- **Pseudo multi-bit modulators list under Adaptive.** The two AMSDM entries leave their own family for a pseudo multi-bit group inside Adaptive, beside the fifth and seventh order groups, with base and extended compensation as its rows.

- **Polyphase sinc variants list Gaussian second.** The Simplified filter dropdowns order the family base, Gaussian, extended response, extended response 2, extreme roll-off, half-band, Gaussian half-band, then the MQA and MP3 pair. The two Gaussian groups, previously split by half-band, now sit together.

- **Pure sinc splits its base group by rate flexibility.** The five sinc-L filters become the family base, and sinc-short through sinc-long-h form a Rate-flexible variant captioned "Capable of any rate change at the cost of a higher processing load", replacing the Adaptive length grouping that described every entry in the family. sinc-S reads as Short, sinc-M as Constant length.

- **The quality facet defaults to Any quality.** With each row's rating visible at a glance, the 3/5 floor no longer guards the first look at the menu; a fresh narrow bar starts unnarrowed and only an explicit floor narrows.

### Fixed

- **Simplified dropdown rows line up under the group they belong to.** Header text, group blurb and option rows share one left edge per nesting level, with a single indent step between family and variant, and the apodizing badge, stars and heart hold fixed columns down the list instead of trailing labels of every length.

- **The length facet no longer reads sinc-S and the sinc-M set as extra long.** Their descriptions name an ext2-xla or gauss-xl variant, which states the filter family rather than a length; sinc-S narrows as short, and sinc-M, sinc-Mx, sinc-MG and sinc-MGa carry no length, like the rest of the family documented by tap count alone.

- **Simplified filter names state linear phase where HQPlayer documents it.** The half-band, Ext2, Gaussian and Gaussian half-band poly-sinc families read as linear phase in their Simplified entries, matching the phase already shown for the lp/ip/mp variants.

- **The Simplified blurbs describe the half-band corner and the Gaussian character accurately.** The half-band entry read "reaches close to the cutoff", understating where the corner sits, and now says the response reaches it. The Gaussian entries read "cleanest transients" and the Gaussian half-band entry "Gaussian character", in place of wording that implied slower edges rather than the absence of transient artifacts.

## [1.10.0] — 2026-08-18

### Added

- **Simplified filter dropdowns caption every family and variant.** A one-line blurb under each header says what the group covers, so picking Gaussian or Half-band no longer requires knowing the terms.

### Changed

- **The Simplified dropdowns' Misc catch-all splits into named families.** Analog-style, Classic oversampling, Polynomial and Minimum ringing each become a family with its own blurb, and their entries lose the prefix the header now carries. Misc keeps the three filters that belong nowhere else: no resampling, the frequency-domain brickwall and the asynchronous converter.

- **The "Adaptive taps" wording in Simplified filter names now reads "Adaptive length".**

## [1.9.0] — 2026-08-18

### Added

- **The LIVE page's blocks rearrange to taste.** An "Edit layout" toggle in the LIVE MODE card head opens a mode where Mode and Rate, Engine health, the narrowing and chain group, Playback and Matrix profile drag into any order; LIVE MODE stays pinned at the top. The arrangement is stored per browser and written on leaving the mode. Reordering has no keyboard path.

- **An "Option style" switch on the narrowing bar renders the filter, dither and modulator dropdowns in plain English.** Simplified groups each list under family and variant headers with each entry's distinguishing properties; Standard keeps the raw engine names. The choice persists in the browser; narrowing, favorites and rate graying keep reading the engine names.

### Fixed

- **The length facet drops the lengths HQPlayer never stated.** Filters whose descriptions give no length in words, among them the sinc-L series and the polynomial interpolators, had been guessed into buckets and now carry none; sinc-S reads as extra long alongside the rest of the sinc letter series rather than short.

## [1.8.1] — 2026-08-16

### Changed

- **The genre facet pairs off into "Jazz & blues" and "Pop & rock".** No filter carried either word without its partner, so the separate checkboxes narrowed to the same set.

- **The genre facet combines picks with OR by default, the focus facet with AND.** Two genres read as either one suiting, two focus tags as both wanted. Either switch still flips per facet.

- **Picking "All genres" under AND grays the other genre rows and reads "All genres" on the button.** Those picks could not change the result or the count. Switching the facet to OR makes them live again.

- **The phase and length facets take several picks at once.**

### Fixed

- **A grayed playback volume dial reads against the configured volume range.** It had sat at a position matching no setting on screen, drawn against a range the engine reports for itself. Under a bypassed volume control the dial reads full up.

## [1.8.0] — 2026-08-16

### Added

- **The Output tab's chain cards fold their DSD Sources sections, and a Source format switch on the narrow bar opens both at once.** The sections start closed, since most libraries hold no DSD files. The switch reads PCM only and +DSD, and folding one card's section by hand moves only that card until the switch moves again.

- **The oversampling chain controls carry one-line role glosses under their labels.** The 1x and Nx filter slots say which content each covers (CD quality and 48 kHz versus hi-res ≥88.2 kHz), and the sigma-delta modulator, dither, DSD source controls and DAC bits each state their role in the chain.

### Changed

- **Engine idle time reads in seconds.** The dropdown lists bare numbers, so the unit now sits beside it, and the hover tip describes what idle time controls.

- **LIVE's Narrow filters, Playback, Engine health and Matrix profile cards and the Output tab's DAC correction card fold away.** Each starts open and remembers its state, so a page cut down to the output mode switch and the matrix profile picker keeps that shape across reloads.

- **Every card title bar is one height.** A disclosure triangle, the narrow bar's Reset button and a hero card's larger heading each sit inside the bar rather than setting its height.

- **The hi-res narrowing switches are replaced by one 1x control reading Both, Lossless and Lossy.** It groups the filters that reduce ultrasonic noise, which at 1x only lossy sources carry; the Nx list is no longer narrowed on that axis.

- **The Quality narrowing facet starts at a minimum of 3/5 and names its steps with the denominator.** The dropdown reads Any quality, Quality: ≥ 3/5, Quality: ≥ 4/5 and Quality: 5/5; clearing the narrow bar returns to the 3/5 floor, and picking Any quality counts as a narrowing choice.

### Fixed

- **The pass-through filter now stays in the 1x and Nx menus whatever the narrowing.** Its 1/5 rating and non-apodizing flag describe the absence of resampling rather than poor resampling, and the 1x apodizing default had been dropping it from the menu. Both 1x switches now start neutral, so a fresh narrow bar is unnarrowed.

## [1.7.0] — 2026-08-14

### Added

- **The alert strip warns when Roon is the source and Engine idle time is at Default.** At default idle time Roon stops and restarts the whole playback engine between tracks; the warning recommends 10 seconds or longer and clears once a non-default idle time is applied or Roon stops playing.

### Fixed

- **The Phase narrowing facet now classifies every filter the manual characterises, not just names carrying a phase token.** Token-less families such as poly-sinc-ext2, gauss and sinc count as linear phase per the manual, minphaseFIR as minimum, and minringFIR-lp is no longer misfiled under minimum phase.

## [1.6.0] — 2026-08-14

### Added

- **The genre and focus narrowing dropdowns now combine their picks by AND or OR.** A switch at the foot of each popover chooses whether a filter must carry every picked tag or just one of them. Genre starts on AND, focus on OR, and the choice is stored for the install alongside the rest of the narrowing.

### Changed

- **The Ratio narrowing dropdown is now Rate change: scenario rules instead of ratio classes.** The popover offers hiding output rate-limited filters, showing only downsampling-capable filters, and showing only filters that can resample uncommon source rates such as 32kHz. When the output is SDM and the active backend's DSD rates setting is 44.1kHz only, rate-limited filters hide automatically without marking the facet as changed.
- **On LIVE, the rate pair explains its Auto graying on hover rather than in a caption under the card.** The caption is gone and the Mode switch beside it keeps one size in every mode.

### Fixed

- **The header prints the installed HQPlayer release, not the DSP engine build.**
- **LIVE's filter, modulator, dither and high-frequency filter dropdowns no longer resize themselves to the option selected.** Each keeps one width, sized to fit its options.

## [1.5.0] — 2026-08-13

### Added

- **Enabling Direct SDM now asks first.** The daemon pins PCM volume at a fixed −3 dBFS whenever Direct SDM is on, so the control opens a yes/no warning saying so. The warning appears when Direct SDM turns on from any volume state other than a fixed −3 dB, whether by Fixed level or Auto headroom.

### Changed

- **Six checkboxes became two-button switches with named sides.** DoP is now DSD support (Native DSD / DSD over PCM), 48kHz DSD rates is DSD rates (44.1kHz only / +48kHz family), IPv6 discovery is Discovery (IPv4 / +IPv6), and Gain +6 dB is Source gain (0 dB / +6 dB), on both the ALSA and Network backend cards where each applies. Descriptions quoting the old checkbox labels now quote the new sides.

### Fixed

- **An output mode set live now survives a restart.** A live mode change reached the daemon only until the next restore, which restarted it onto the mode held in the active preset's snapshot — and the mode control, grounded on live truth, staged nothing when re-selected. Restores now carry the running engine's mode, filters, shapers, adaptive volume and rate limits, falling back to the snapshot only where the engine cannot answer.

## [1.4.0] — 2026-08-13

### Added

- **The Matrix tab's speakers/headphones choice now belongs to the preset.** Each preset remembers which half of the tab it is listened through, stored for the install rather than for one browser, so loading a preset puts the tab on its own side. A preset with no remembered side opens on the last one used.

- **Matrix profiles can carry a description** — room, mic position, target curve, date, whatever the name has no room for. The box on the Matrix tab's Profile card binds to the selected profile or to the name being typed into Save as, and saves on each keystroke with no Apply and no restart. LIVE shows the running profile's description under its picker. Descriptions travel in backup download and upload.

- **Setting a buffer to minimum now asks first.** Short buffer at Minimum, or Buffer time at −1, breaks playback on most setups. Changing either now opens a warning over the control: revert, or confirm and stage it as before.

- **A Copy button on the live log tail**, for the lines currently in the window.

- **`HQPTUNER_METERING_ENABLED=0` turns the junk-filter advisor off entirely.** HQPTuner then never opens the metering connection and the advisor's note never appears.

- **Filter hover tips now carry the filter's facts, not just its prose.** Under the manual's description, the tip lists the same facts the narrowing bar filters on — quality, genre, focus, phase, length, ratio class, apodizing and upsample-only — each line present only when the filter has that fact.

### Changed

- **The Volume tab now tracks the engine every second, with no checkbox to tick.** Its "Faster volume updates" opt-in is gone; the knob and the Loudness plot follow the daemon at one-second cadence whenever the tab is open. LIVE and the System page's Quick updates opt-in settle on the same one-second rate, matching how often the daemon's own readings move.

- **Settings tabs reorganized.** The Resampling tab and the Output tab's "General" card are gone: Output now runs Backend / Mode / Rate, Pre-process, filter narrowing, the PCM and SDM chains, Filter length, DAC correction, then the two backend cards; gain compensation moved to the Volume tab ("Adjustments"), idle time / quick pause / short buffer to "Timing" and UPnP freewheel to "UPnP" on the System tab, and Channels to its own card on the Matrix tab.

- **Descriptions now say what the setting does, not what other settings do.** Some had been lifted from the manual too literally and described their neighbours as well.

- **A narrowed filter menu lists only what the narrowing matched.** The selected filter used to be pinned to the top whether or not it matched, which obscured what the facets had found. Closing the menu without picking keeps the filter that was selected.

- **Filter narrowing and favorites are stored for the install, not for the browser.** The narrow bar's facets and the filter stars were kept per browser; both now save with the rest of HQPTuner's state, so reopening the page — or restarting HQPTuner — brings the menus back narrowed and starred the same way on any browser. Existing stars carry over on first load. The favorites-only switch stays per session.

- **The "Matrix engine is bypassed" note now says "Engage it to use this feature."** on a card whose own feature is switched off, instead of "These settings have no effect" about settings that were not in use. The General card carries the note too.

- **The live log tail no longer scrolls itself to the bottom on every poll.** It follows the newest line only when the view is already at the bottom.

### Fixed

- **Auto-save no longer writes the previous preset's settings into the one just loaded.** Loading a preset restarts the daemon, and an auto-save landing in the second that followed stored the readings taken from the engine before the restart — so a switch away and back could leave a preset holding the other one's mode, filters and dither. A load now re-reads the engine before anything saves.

- **Loading a preset no longer stages a rate nobody picked.** A preset whose device carries a higher rate than the one before it could come up with its SDM or PCM rate already dropped to the previous device's ceiling, waiting in the pending bar. Device limits now apply only once both views of the running config name the same device.

- **Static notes now hide with the descriptions switch, and the switches show their real state.** The narrowing card's "Reduce the number of filters" explainer and the narrow bar's apodizing and hi-res captions stayed on screen with descriptions off; both now hide with every other note, the captions moving to a hover tip. Option descriptions renders checked whenever the master forces it on. That master is renamed from Feature descriptions to Setting descriptions.

- **A filter applied after a mode change now lands the filter that was picked.** Applying the output mode on its own, then applying a filter, ran a different filter instead. Re-applying the mode already running also no longer disturbs the output rate.

- **The About card called HQPlayer's DSP-engine version (6.0.4) the "Version", though the installed release is 6.0.2.** Signalyst numbers them separately, so the card now shows both: "Version" and "Engine".

- **Matrix profiles saved before profiles carried a chain no longer blank the DAC correction.** Loading one turned correction off, emptied the DAC model and dropped loudness, and applying while it was loaded stored that blank. Only chainless profiles are filled in, from the running matrix, at the next apply.

- **Rate/shaper warnings no longer report on a chain the pending settings will not use.** Staging a mode change, or selecting an unapplied preset, left the warning reading whichever chain was playing — down to a red "HQPlayer cannot produce output" about a modulator that would never run. The warning now follows the mode the settings run under; in Auto, the loaded chain.

- **Dither and other live-capable settings no longer revert.** Applied alongside a restart-required setting, a live value reached the engine but not the config file, and the restart took it back; such a batch is now stored whole, and the pending bar's live/restart counts follow. Dithers and filters applied from the tabs view are recorded per chain, so switching chains no longer folds a stale value into the preset.

- **Rescanning devices no longer resets the live settings.** With auto-save on, the filter, mode, dither and rate the engine was running come back after the rescan. Matrix profiles are the exception.

- **HQPTuner no longer reads the daemon's metering stream while nothing is playing.** The junk-filter advisor held that connection open around the clock, and hqplayerd sends spectrum frames unconditionally — a few MB/s, unnoticed on loopback but visible as constant network load in Docker. The advisor now connects only while the engine is playing, and reconnects across a pause mid-track.

## [1.3.4] — 2026-08-09

### Internal

- Testing fix caught by the CI gate. A fixture in the control-stall suite let the background poll race the request under test, so the suite passed locally and failed on CI. No user-visible change.

## [1.3.3] — 2026-08-09

### Fixed

- **Settings that leave HQPlayer producing no sound now say so.** A modulator picked below the DSD rate it needs stopped the sound with nothing on screen to explain it. Those modulators are now grayed with the rate they need, and dropping the rate under one raises a red warning naming both. Dithers below their tuned rate get an amber note instead, and stay pickable at every rate.

- **A loaded matrix profile no longer follows you to a different preset.** Switching presets could drag the matrix profile you had loaded along with it, so the new preset came up running the old preset's profile instead of its own matrix.

- **Dragging a knob no longer highlights the text around it.** A press on a dial started the browser's own text-selection gesture alongside the value change, so every drag left a trail of blue-highlighted labels behind it. Dials now take the press without starting a selection; text everywhere else stays selectable as normal.

- **The Matrix tab's Engine and IIR to FIR dropdowns no longer run off the edge of their card.** Both sat at a fixed width wider than the card holding them, so each dropdown hung 50 px past the card's right edge — and the description under IIR to FIR, which is long on the `linear` setting, overran and clipped with it. Both now size to their content and their text wraps inside the card.

### Changed

- **Saving a matrix profile now tells you it isn't finished.** A saved profile isn't kept until you hit Apply and the engine restarts, and the only sign of that was the Apply button lighting up — so a profile could look saved and then be gone. The Profile card now says "Restart the engine (Apply) to finalize the save." under the save box.

## [1.3.2] — 2026-08-07

### Fixed

- **Output rates on the LIVE page no longer get refused.** Every rate tier you picked could come back as "isn't in the engine's live rates list", leaving no way to move the engine off the rate it was already on. Rates now apply as picked.

- **Loudness, crossfeed, DAC correction and pipeline rows now save to matrix profiles properly**. A previous bug made it impossible to enable, e.g., Loudness while also having a DAC correction profile loaded. Loading the matrix profile would wipe out the setting, while applying the setting would wipe out the matrix profile. These settings are now properly stored within matrix profiles and can be saved.

### Changed

- **Matrix profiles now stick after a restart**. If you have a matrix profile loaded and restart the engine, HQPTuner now restores that matrix profile automatically as the default for that preset.

## [1.3.1] — 2026-08-06

### Fixed

- **Setting, filter, dither and modulator descriptions now match the HQPlayer manual.** An audit of every shipped description against Signalyst's own text found prose that had drifted into paraphrase, claims the manual does not make, and warnings it does. Descriptions now quote the manual directly, which restores detail that condensing had dropped — the per-DAC PCM gain compensation figures, the R2R recommended-bit table on DAC bits, every per-algorithm description behind SDM to PCM conversion and the noise-filter list, the 128-channel ceiling, the IIR-to-FIR pre-ringing warning, and the apodizing detection mechanism. Corrections along the way: Bass steepness said higher was sharper when 1 is the maximum; the noise-filter list left out `medium-high` and the rule to use it instead of `medium` when PCM Conversion is `none`; DAC bits said "below 32-bit" where the manual says "something else than 32-bit"; Direct SDM now says it also pins PCM volume to a fixed -3 dBFS, and a zero-width volume range now carries the manual's warning that it causes inter-sample overs and limiting. The manual's caveat sentences — "Not recommended." on ASRC and the polynomial filters, "Only suitable for highest technical quality source materials." on the half-band variants, NS1's ultrasonic-noise warning, the AHM5EC5L/AHM7EC5L limited-SNR note — were held in a field nothing rendered, so a filter the manual advises against described itself in neutral terms; each description now reads description, then caveat, then the two-stage note where one applies. `poly-sinc-mqa/mp3-lp` and `-mp` are marked upsample-only to match the manual's "Integer up" ratio, so checking **Upsample-only** on the narrow bar no longer hides them. References to HQPlayer Desktop's own controls — its Settings dialog, Tools menu, grayed and checked checkboxes — are dropped or renamed to what HQPTuner actually shows.

## [1.3.0] — 2026-08-05

### Added

- **Favorite filters.** Every row in the four oversampling-filter dropdowns (PCM/SDM × 1x/Nx) carries a star — click it to favorite that filter without changing your selection. A **★ Favorites** toggle on the narrow bar then restricts the dropdowns to your starred filters, combining with the other narrowing facets and their live counts; the toggle stays grayed until you've starred something, and unstarring the last filter turns it off. Favorites are keyed by filter name, shared across all four dropdowns and the LIVE page, and saved in the browser — they don't follow you across devices.

- **An append-only event log, off by default.** `HQPTUNER_DEBUG_LOG` names a path and HQPTuner records every durable write there as JSON Lines — staged edits, what each apply was handed, matrix profile writes and whether they replaced a profile, preset writes and what triggered them. Unset, nothing is written. No UI control: set it on the container and read the file with `jq`.

- **`HQPTUNER_LOG_LEVEL` sets the log level**, which was pinned at `INFO` in code. An unparseable value falls back to `INFO`.

### Changed

- **One Playback card on LIVE.** Adaptive volume and the High-frequency (playback) filter sat in a card called Processing, with the volume knob in a card of its own below it. They are now one card: the two level settings on the left, the master volume on the right.

- **The Range bar redrawn.** Gridlines run every 10 dB with a number every 30, instead of five scattered marks, and the labels name the unit. Min and Max are brackets facing inward at the span they enclose, so each names its own end rather than being two identical blocks. With volume-adaptive loudness switched on, its two bounds ride the same axis as draggable parentheses inside those brackets — the settings the Loudness card holds, so editing them in either place lights both cards; they are absent when there is no loudness running. The volume currently playing rides the axis too, as a tuner needle: it reports rather than sets, since the knob above already adjusts it, and it tracks the knob live as you drag rather than waiting on the daemon's next poll. It is absent whenever the engine has the volume control bypassed or has not reported a level. A legend names both marks.

  Handles now sit on the values they hold. Every one of them was drawn up to half its own width away — a Max of -3 dB sat visibly left of the -3 gridline — because the browser insets a slider's thumb while the gridlines and fill were drawn across the full track. `-120` also lost its minus sign into the card edge; the labels at each end of the track now anchor to that end.

- **The "Matrix engine is bypassed" sentence now appears once per card, not under every control.** A bypassed matrix printed the same line under all seventeen post-process controls on top of each card's own note. The card note stays; the controls stay grayed and carry the reason on hover.

### Fixed

- **The playback volume readout no longer cuts off its last digit.** Any level of -10.0 dB or lower overran the box and lost the tenths place: -22.0 dB read as `-22.C`. On the Volume tab and on LIVE.

- **The Loudness plot now follows the volume knob as you drag it.** It drew the level the daemon last reported, which arrives on the poll — every two seconds, or twice a second with Faster volume updates on — so through a whole drag the applied curve and its caption sat still and then jumped on release. The plot now reads the value under the pointer.

- **A knob drag interrupted by a context menu now keeps the value you dragged to.** Right-clicking mid-drag swallows the mouse-up, and the knob abandoned the drag rather than finishing it — so the dial snapped back to where it started and everything reading the live value stayed parked on a level that never landed. It now ends at the value it had reached, exactly as a normal release does.

- **Scrolling the page past a knob no longer changes its value**, in Safari. Keyboard use, dragging, double-click-to-reset, the slider and the box are unchanged.

- **The Loudness Type dropdown is sized to its options.** It stretched the full width of the Bass/Treble strip for three six-character values; it now fits the longest one, like the Matrix flow controls.

- **Naming a live preset no longer spills out of its card.** Clicking Save… under Live preset broke the prompt across six lines, one word each, and pushed the name field and its buttons over the text beside them. The prompt now reads as a sentence with the field and buttons under it.

- **Loading a matrix profile with nothing playing now says why.** HQPlayer refuses the switch when no track is loaded, and the Profile card used to print its C++ diagnostic verbatim (`clHQPlayerEngine::MatrixSetProfile(): clPlaylist::GetTrackFile(): trackn > last`). It now reads `Live playback is needed to load a matrix profile.` Any other refusal still shows the daemon's own words.

- **The structural-crossfeed warning shows a real warning sign.** The message opened with the literal characters `/!\` instead of ⚠.

## [1.2.0] — 2026-08-04

### Added

- **Dropdown options now explain themselves on hover.** Every dropdown whose options carry manual descriptions — the oversampling filter menus, dither, modulator, noise filter, integrator, both SDM/PCM conversions, the junk filter and the matrix engine pair — shows the hovered option's description in a tip beside the open list. Keyboard browsing shows the same tip at the highlighted option. These dropdowns open a page-drawn list instead of the native one, since macOS never shows tooltips on native options. The LIVE page's chain controls use the same dropdowns.

- **DAC bits and 48kHz DSD rates are no longer grayed out in the other output mode.** Both stayed editable settings you could only reach in one mode, so setting them up before switching meant staging the mode change, editing, then unstaging it again. They now stay editable in both modes and simply say which mode they apply to, in a note beside the control where every other note sits.

- **The tab names are a size larger.** The row is the page's top-level navigation and was set at the same size as an emphasised control.

- **The header no longer prints the playback state.** "Playing" / "Stopped" beside the daemon name duplicated what the signal path's chips already show.

### Fixed

- **Chain cards no longer drift in Firefox.** The two-column chain layout relied on a forced CSS column break Firefox has never implemented, so the 1x/Nx filter pair could split across columns there. The split now lives in the markup and lands after the leading pair in every browser.

- **Scrolling over a slider on macOS can no longer change it.** macOS browsers hand a scroll gesture's first ticks straight to the slider without dispatching a wheel event, so the wheel block never saw them and edits kept staging. Sliders and knobs now accept an edit only from a real drag, track click, or slider keystroke — anything else snaps back and stages nothing.

- **A right-click during a slider drag no longer glues the slider to the mouse.** The context menu eats the mouse release, leaving the browser's drag running with no button held. Both sliders and knob dials now notice the button is gone and end the drag.

- **The signal path no longer shows loudness while the volume is pinned.** Loudness is volume-adaptive: with the volume fixed — Fixed level on, Auto headroom engaged, or the volume range collapsed to 0/0 — none of the loudness curve is applied, so an enabled loudness stage is inaudible. The chip (and the combined "DSP" chip) now appears only when loudness is actually in the signal; crossfeed is unaffected.

## [1.1.2] — 2026-08-04

### Fixed

- **Volume range edits now accent the Volume tab.** Moving the minimum, maximum or startup volume lit the DSP tab instead, so an unapplied change looked like it belonged somewhere it wasn't.

- **The signal path no longer shows crossfeed or loudness while the matrix engine is bypassed.** Both plugins run inside the matrix, so a bypassed engine runs neither — but the chain bar kept reading "Loudness: On" off the plugin's own switch. The chip now appears only when the engine is engaged.

- **Matrix profiles now keep their crossfeed, DAC correction and loudness.** Saving a profile stored only its pipeline rows, so loading one handed back less than was saved. A profile saved from now on carries the whole matrix. Profiles saved before this keep nothing — save over them once to give them a chain.

- **Engaging structural crossfeed can no longer wipe your EQ.** Over pipelines it could not read as a plain stereo pair, it used to install anyway and throw the EQ away. It now leaves your pipelines exactly as they are and says so.

- **The mouse wheel no longer changes any control's value.** It was blocked only on a control you had not clicked — a clicked slider still moved under the wheel, and dropdowns took it everywhere. The wheel now scrolls the page over every slider, number box and dropdown.

- **Setting a control back to where it started no longer leaves an edit staged.** The pending count already read zero, but the value still rode the next Apply and restarted the engine to write what it already had.

### Changed

- **A bypassed matrix engine grays what it bypasses.** Crossfeed, DAC correction and loudness all run inside the matrix, so they did nothing while the engine was on BYPASS and nothing said so. Their controls are now disabled with the reason, and the three cards carry a note. The pipeline table stays editable.

- **Engaging crossfeed, DAC correction or loudness no longer switches the matrix engine on.** The matrix switch also carries channel routing, and it is the user's to set. Engage the engine yourself when a card says it is bypassed.

- **Matrix profile card cleaned up.** The Load and Save notes now state what each does bluntly, the "live — no reload" status chip is gone, and the active profile, load and save rows use the same label-and-control layout as the rest of the tab.

- **The crossfeed lens is now a button.** "∿ what you hear" on the Crossfeed card turns it on and off. It used to draw itself whenever crossfeed was running.

## [1.1.1] — 2026-08-03

### Fixed

- **Saved settings survive a restart.** An apply that restarted the engine used to bring it back on its old mode, filters and shapers. It now comes back on the active preset's saved ones.

- **The signal path's MATRIX chip reads "On" instead of the profile name.** A long profile name overran the chip and pushed the chain bar out of shape. The chip now says only whether a matrix is in the path; the active profile name is still on the LIVE matrix profile card.

- **Loading a matrix profile no longer pends an apply.** Loading a profile the daemon knows switched it live and also staged its pipelines, so Apply lit up for a change the engine was already running — the apply restarted the engine and changed nothing. A load is now live only. It lasts until the daemon restarts; save the matrix under a name to keep it. A profile saved in this session and not applied yet still loads by staging its rows, which is the only way to reach it.

## [1.1.0] — 2026-08-02

### Added

- **Save a matrix profile to more than one preset.** Saving or deleting a profile now asks which presets it belongs in.

## [1.0.2] — 2026-08-02

### Fixed

- **LIVE no longer marks a rate unavailable that the engine can play.** A DAC that does DSD at one base rate only — 22.5792 MHz but not 24.576 MHz, say — made the LIVE rate card gray DSD512 as "unavailable" even while DSD512 was playing. A rate tier is now reachable whenever the engine offers either of its two base rates, and LIVE sends the one the engine is actually offering.

## [1.0.1] — 2026-08-02

### Fixed

- **Two-column chain cards keep their controls in place.** In the PCM Chain, SDM Chain and Hardware acceleration cards, a control could jump to the other column and sit a row lower than the one beside it — the SDM Chain's modulator falling below the 1x filter, for instance. The columns no longer shift with feature descriptions turned on, or when a filter with a longer description is picked.

## [1.0.0] — 2026-08-02

### Added

- **A note when the matrix engine is bypassed.** The Pipelines card, the Headphone Auto EQ card and the Crossfeed card in Structural view now say "Matrix engine is bypassed. These settings have no effect." while the General card's switch is on BYPASS. The Matrix response card says "Matrix engine is bypassed. The changes below are not applied." above the curve, and stays quiet when there is nothing plotted. Staging ENGAGE clears it straight away. Nothing is disabled — a profile can still be built against a bypassed engine and engaged afterwards.

- **Violet accent theme.** A fourth swatch on the accent picker, beside blue, phosphor green and amber. Matrix IIR stage chips shift from violet to orchid so they stay distinct from the accent under the new theme.

- **Device-aware rate and mode menus.** Rates the output device cannot play are grayed as unavailable, on the Output tab and on LIVE. SDM is grayed on a device with no DSD path; with DoP on, only the DSD rates the device can carry stay selectable. A setting on an unreachable value falls back to the highest rate the device can play, or to PCM, as a staged change. Nothing is grayed and nothing falls back when the device has not reported what it supports.

- **Auto-save to the active preset.** A new **Auto-save** checkbox on the pending bar. With it on, every successful Apply and every LIVE change is saved into the active preset, so you always pick up where you left off.

- **Apodizing and hi-res narrowing switches.** The Narrow filters card gains two switch groups — **Apodizing filters** and **Hi-res filters** — each with a segmented switch per stage. Counts after each switch preview how many filters every choice would leave, and every narrowable filter dropdown carries an n/total badge of how many survive the active narrowing, in both the tabs and LIVE views.

### Changed

- **The DSP tab is now the Matrix tab.** Resampling is DSP too, so the old name said less than it looked like it did. The card at the top of it, previously **Matrix**, is now **General**.

- **The Matrix tab's mode banner reads as a headline.** SPEAKERS | HEADPHONES is now uppercase and bold on both halves, taller, and each side carries a drawn speaker or headphone icon beside its word.

- **Clearer wording for the feature-description setting on the System tab.** It now says what turning it off does: the descriptions become hover tips.

- **PCM gain compensation fills the right way round.** The slider on the Output tab filled from the right; it now fills from the left like every other slider in the app.

- **Grayed-out reasons sit beside the control.** DAC bits on both output backends, Adaptive volume and Loudness now carry their "why is this grayed" note to the right of the control instead of on a line below it.

- **The DAC correction profile picker is now called DAC model.** It picks the DAC being corrected for, and the old name collided with the matrix profiles on LIVE.

- **Switches are bigger.** All segmented switches now share the large size the card enables use. The hero BACKEND and MODE buttons fill the card's full height, level with the RATE dropdowns; the Matrix tab's SPEAKERS | HEADPHONES banner uses the app's largest text; and the header's LIVE toggle takes a larger label and more padding.

- **Card enables are switches now.** Crossfeed, Loudness, DAC correction, Matrix, Speakers, Fixed volume and Logging each traded their Enable checkbox for a two-button switch — ENGAGE / BYPASS on the five that sit in the signal path, ON / OFF on the other two. Each card's explanation moved out of the switch's row and up under the card's title, where it describes the card rather than the switch.

- **Crossfeed card gets a card-level switch.** ENGAGE / BYPASS now sits at the top of the card and turns the crossfeed on or off in whichever view is showing — the Bauer flag, or install/removal of the Structural matrix block. The Bauer | Structural switch moved out of the card's header to sit beside it, with a short explanation of the two below, and Structural's separate Turn on / Turn off buttons are gone.

- **Cards reflowed.** The DAC correction card's ENGAGE / BYPASS switch sits above the Profile row instead of beside it, and that row dims while the correction is bypassed. The Fixed volume card's ON / OFF switch and dBFS level share one labelled row — **Fixed level** — with **Auto headroom** beneath it. The Speakers card's channel list is indented off the card's left edge.

- **Loudness gets knobs.** Three knobs, sliders and textboxes like the Matrix Response plot's, toggled between Bass and Treble by a switch above, which buys a little vertical space on the Volume tab.

- **LIVE is quieter and safer while writes are in flight.** No more "writing…", "switching…" or "Reloading the engine's lists…" beside a control — it just grays out until the write lands. Changing the output mode, a filter or the rate makes the engine rebuild its menus, so the running chain's filters, the high-frequency filter and both rate columns gray out until the new lists arrive instead of offering entries the engine has already replaced. The other chain's controls, adaptive volume and the mode switch stay usable throughout.

- **EQ file controls consolidated.** The Headphone Auto EQ card no longer carries its own **Load AutoEq / REW .txt…** button — the one in the Pipelines card's action row does the same thing. The **mirror to stereo pair** checkbox moved there too, beside it, and governs the lanes in that card; a library profile load always writes both channels. It starts unticked in Speakers mode. Import messages now report into the card you acted from.

- **DSP pipelines moved.** The DSP pipelines setting now sits at the top of the Pipelines card instead of the Matrix card, beside the pipeline count it governs.

- **The clipping and apodizing-events warnings both wait for ten events** on a track before firing — up from the first event for clipping, and from five for apodizing.

### Removed

- **The staged-changes chip on LIVE.** LIVE no longer carries the reminder that the tabs view holds unapplied edits.

## [0.11.1] — 2026-07-30

### Changed

- **Junk-filter advice no longer guesses at causes, and offers a filter-family alternative.** A persistent ultrasonic tone can be tape bias, but it can also be clipping in an authentic hi-res recording, so the advice now describes what it sees instead of naming a culprit. For persistent tones it also suggests the poly-sinc-gauss-hires and poly-sinc-ext2-hires filter families as an alternative to the junk filter, and goes quiet when one of them is engaged.

- **The apodizing-events warning is quieter.** It now waits for five events on a track before it says anything, instead of firing on the first one.

- **LIVE's rate caption in Auto now explains why, and offers a way out.** The rate limit is tied to the output device and can never change while running, so the caption says so, and points to switching the mode to PCM or SDM to pin a rate on the fly.

### Fixed

- **Preset names accept punctuation and non-English text.** Saving `Headphones — ZMF Ori 3.0` failed with `invalid preset name`, as did any name with an em dash, an accent, non-Latin script, an emoji or most punctuation. Names now take anything hqplayerd and the filesystem accept. Path separators, leading dots, control characters and names too long to store are still refused, and a name too long is now refused with a clear error rather than silently vanishing.

- **Changing the mode and a filter or modulator together no longer restarts the engine.** Applying the two from the tabs view used to take the whole batch through a daemon restart, interrupting playback. The mode now applies first on its own, and the rest follows live — the same order the LIVE view's presets already used.

- **A filter change that worked no longer reports an error.** Changing the filter or the output mode takes hqplayerd's engine down for a moment, and the connection can drop under it — which showed up as `GetShapers: connection failed: Connection lost` on a change the user had just watched land.

- **Errors on LIVE controls clear when the daemon reconnects.** A failed write used to leave its message on the control until the next write. It now goes away once the connection is back, since the control is working again by then.

- **A live setting the daemon never answers now says so.** It used to come back as a bare server error with no message, which is what an output-mode switch looked like when it took hqplayerd's engine down. The control now shows what happened, and re-reads the engine afterwards instead of assuming the write never landed.

- **The junk-filter recommendation no longer disappears when the music starts.** Advice now stays up for the rest of the track once earned, and clears when the track changes or the recommended filter is engaged. Persistent tones are also detected while music plays, not just in quiet passages, after about 30 seconds of listening.

## [0.11.0] — 2026-07-29

### Fixed

- **LIVE's rate menus no longer show every tier as unavailable.** The engine's rate list depends on the output device as well as the mode, so it can come back empty, and HQPTuner kept serving an empty one until the mode changed. It now re-reads the list when playback starts or stops, and a list with nothing in it grays nothing.

- **Cards on the LIVE page stay open once you open them.** They were snapping shut about once a second, so clicking one looked like it did nothing.

- **The LIVE page no longer offers a rate control that cannot work.** In Auto mode the engine chooses the output rate itself and accepts none over the wire, so both rate columns are now grayed there. The caption says what governs instead — the limit, which needs an engine restart to change, so it lives on the Output tab.

- **The LIVE page knows which chain is playing in Auto mode.** It used to claim no chain was loaded even mid-playback, and hold filter and modulator edits that could have gone straight to the engine.

- **Tapping a card heading on a tablet now toggles it once.** On iPad Safari a single tap counted twice, so a collapsed card opened and shut again straight away. Buttons, dropdowns, checkboxes and radios are all affected.

### Changed

- **Both rate columns on the LIVE page take edits under PCM and SDM, whichever family the engine is running.** Setting the DSD rate while PCM plays now works the way the DSD filters and modulator already did: the edit is held and applied when that family loads.

- **Matrix stage chips carry their kind in the label, not the outline.** Violet for EQ and other processing, rose for convolution. The outline is now the hover and selection mark, in the accent; In/Out endpoints are accented too. Kind colours no longer sit on the accent palette, so the amber and green themes stop making chips look selected.

- **Raised elements — chips, buttons, dropdowns, card headings, plots — carry a 1px highlight on their top edge.** No colour or spacing changes.

### Added

- **The signal-path thread animates while the engine plays,** and the output rate readout glows. Both stop with playback, and neither runs under reduced-motion.

- **The stopped signal path's `—` placeholders render in the readout face, dimmed.**

## [0.10.0] — 2026-07-29

### Added

- **HQPTuner now spots junk-dominated "hi-res" sources and says which junk filter to engage.** It listens to the engine's own metering stream while a track plays, and when the source's spectrum shows a known junk signature — upsampled redbook sold as hi-res, an ultrasonic tone riding above the music, or the rising noise of a DSD-to-PCM transfer — a note appears in the alert strip naming the junk filter that treats it (20k, 30k/40k, or 50k). Advice only: nothing is changed for you, and the note clears once you engage a filter that handles it or the track changes.

- **LIVE mode.** All live settings concatenated on a single page. Toggled through a simple button at the top of the page, which drops the tab structure entirely. Also contains live presets which save and load the current live running state.

- **The About card flags a daemon outside the tested version series.** HQPTuner is developed and verified against hqplayerd 6.0; on any other series the System tab's About card says so, under the version the daemon reports. The card is informational and nothing is disabled — the running engine remains the authority for its own filter and modulator lists. Worth including in a bug report if something misbehaves.

### Fixed

- **A staged edit now highlights the control you changed.** The accent outline used to be drawn around the whole row, which on the Output tab's MODE and BACKEND switches ran behind the buttons and came out as an empty loop hanging under the control. Controls with a border of their own — switches, dropdowns, number and text boxes — turn that border accent instead. Checkboxes, knobs and sliders keep the row outline, which was never obscured for them.

- **The signal path's Output chip shows the output bit depth.** It only ever paired the rate with a depth on a DSD output, where the 1 bit is a given — a PCM output read `705.6 kHz` and nothing else, while the Source chip beside it had been reading `44.1 kHz / 24bit` all along. The depth is now taken from what the engine reports it is running, so the two ends of the chain read the same way: `705.6 kHz / 32bit`.

- **The gaps between cards are even again.** The row leading the Output tab — MODE, RATE and BACKEND — and the same pair leading LIVE had four times as much room beneath them as any other card: two separate rules were spacing them and the two added rather than replaced. The same doubling was sitting in forty-odd other places — notes under controls, subheads on Resampling, the log tail, action rows, Matrix pipelines, the speaker and crossfeed cards — so gaps that were quietly double or triple what they claimed are now the figure the layout intended. Spacing is a little tighter under headings and between stacked rows as a result. The build now rejects the second mechanism outright.

## [0.9.2] — 2026-07-27

### Changed

- **The interface now speaks a finite visual vocabulary, and the build enforces most of it.** Every shape, gap, speed, fade and figure used to be chosen by eye at the moment it was written, so the same idea got said a different way on every card: a chip rounder than the chip beside it, an idle control faded harder than the idle bar next to it, a rate written `192 kHz` here and `192.0 kHz` there, a level signed on one card and unsigned on the next. Each of those is now a short named set picked by what a thing *is* rather than how it looked that afternoon, and a stylesheet reaching outside the set fails the build. What you will see is a page that has settled: most controls sit a little tighter, in-between gaps have snapped to the rhythm the layout already used, corners shift by at most a pixel and a half, the signal path reads a little stronger while playback is stopped, plot grid lines recede behind their traces, and collapsible sections are finally the same component as the cards they sit among instead of a lookalike that drifted. The playback volume card was the loudest holdout — with volume control unavailable it faded *itself* rather than its contents, greying its own title along with the notice explaining why it was dead, dimming its dial twice over until it was barely visible, and ending 24 pixels above the bottom of the card beside it; it now dims its dial alone, at the strength every other switched-off section uses, and lines up.

## [0.9.1] — 2026-07-27

### Fixed

- **Cards no longer come in slightly different shades.** A collapsible section — ALSA Backend, Network Backend, and the filter sections on Resampling — drew its frame but never painted its inside, so it sat on the page colour while the ordinary cards above and below it sat on card grey. On the Output tab that put General and DAC correction on one shade and the two backend sections on another. Collapsible sections are now cards like any other, header strip included, and a full-width row inside one no longer paints a dark band across itself. The live log tail and the matrix paste box, which are text you read into a card rather than panels sitting on one, are now both recessed — previously the log tail sat *above* its card and the paste box sat below it, opposite directions for the same kind of surface. Under the hood every surface in the interface is now named for its role (page, card, raised, well) rather than picked by shade, and the build fails if a stylesheet names a shade directly, so a future card cannot quietly land a colour of its own.

## [0.9.0] — 2026-07-27

### Added

- **Dragging an EQ point now tells you what it's doing.** The draggable dots on the matrix response and loudness plots show a live readout while you hold them: which band you have (pipeline and filter type, or which loudness shelf), where it is now (frequency and gain), and how far it has moved since you grabbed it. Release and it disappears.

- **A band strip under the matrix response plot.** A standing block of knob + slider + exact-entry-box trios — frequency (log scale), gain, and Q / bandwidth / slope — always visible under the plot, disabled until a band is bound. Select a parametric stage (click a stage chip, or grab a dot on the plot) and the same slots go live in place, so nothing shifts under your cursor mid-drag. This is the first way to adjust Q visually; dragging the dot only ever moved frequency and gain. Knobs and sliders stream into the plotted curve live and commit on release; the boxes take exact figures. Stereo-paired pipelines move together, same as dot drags, and the strip is named for what it edits ("1+2 · peak"). Grabbing a dot on the plot selects its band, so the strip docks straight from the plot — no trip back to the pipeline chips. Biquad and non-parametric stages keep the docked text editor only.

### Fixed

- **Switching fixed volume off no longer throws away the level.** HQPlayer has no on/off flag for fixed volume — the *presence* of its `<fixed>` line is what "on" means, and when the daemon switches the feature off itself it keeps the old level as a commented-out line, which is its memory. HQPTuner deleted the line instead, so the number went with it: set a level, untick **Fixed volume**, apply, and the level you typed was gone. The box then showed the daemon's own remembered level rather than yours, which reads as the value silently reverting — and the apply reported success, because the setting it had just dropped is the same one it reads back to confirm the write. HQPTuner now parks the level in a commented line exactly as the daemon does, so it survives an off-and-on again, and the level box reads the configuration file rather than the daemon's form, so what you see is your number and not HQPlayer's. Setting a level while fixed volume is off now also switches it on, the way switching on a post-process plugin already switches the matrix on; ticking the box off still switches it off, even in the same apply as a level.

- **Selecting the empty preset option no longer fails with "Not found", and it is now called "(no preset)".** Picking it asked HQPTuner for a preset with no name, and the address that request built matched nothing, so the browser got a bare 404 — `Failed: Error: Not found` — whenever a preset was active. The option itself was labelled `[default]`, borrowing HQPlayer's own word for its unnamed base configuration, which is a different thing: HQPlayer runs one settings file whether a preset is active or not, so `[default]` read as a promise to restore stock settings that nothing could keep. It now says what it is. Selecting it previews your current settings and Apply stops the preset being marked active, leaving what you are hearing untouched — there is no saved "before the preset" version to go back to, and HQPTuner no longer implies there is. Picking it also holds in the picker instead of snapping back to the preset you just left, **Apply & Save** correctly offers no preset to save into while it is selected, and nothing restarts.

## [0.8.3] — 2026-07-26

### Added

- **A beta channel.** `ghcr.io/ohshitgorillas/hqptuner:beta` publishes from the new `beta` branch, so a fix can be handed to a tester before it reaches everyone. Point your compose file's image at `:beta`, pull, and you are on it; set it back to `:latest` to leave. `:latest` is unchanged and still the stable channel.

### Changed

- **The default branch is now `main`** (was `master`). `:latest` follows it as before. If you have a clone, `git branch -m master main && git fetch --prune && git branch -u origin/main main`.

### Fixed

- **Turning structural crossfeed off no longer throws away your headphone EQ.** Crossfeed is a transform layered on top of your EQ: turning it on applies the transform, turning it off removes it, and the EQ underneath is untouched either way. Turn off was not doing that. It restored a copy of pipelines 1+2 recorded in your browser at the moment the block was installed, so any EQ you loaded or adjusted *while* crossfeed was on — the supported way to do it, and what the EQ import does — was discarded when you turned it off; a block installed over empty rows handed back empty rows. The copy also outlived Applies and page reloads without ever being checked against the configuration, so it could be badly out of date by the time it was used. There is no copy any more, and nothing to be out of date: the crossfeed transform is fully described by the speaker angle, head radius and λ, so removing it is arithmetic on the rows themselves. Turn off now hands back exactly the EQ the block is carrying at that moment, on the channels it was built on, with the preamp at the precision the block actually holds instead of rounded to two decimals.

- **A preset save that worked no longer reports itself as failed.** A save writes HQPTuner's own copy of the preset first, then mirrors it into hqplayerd's native profile list — but a failure planting that mirror was reported as the entire save failing, and it also skipped marking the preset active. The mirror is the step that runs while the daemon is still restarting from the apply the save rode in on, so a single attempt routinely lost its connection and came back `save to "…" failed: All connection attempts failed` for a preset that was already on disk — sending you looking for something that was already there. The mirror now retries the way every other write path does, the active pointer is set together with the save instead of after the daemon round-trip, and a mirror that still doesn't land reports the save as done with a note that hqplayerd's own profile list is behind. A save that reached disk is never reported as a failure.

- **The top-bar HQPTuner icon no longer sits flush against the header's edge.** Missing horizontal padding on the header let the brand glyph touch the bar's own background edge, unlike every other card in the app.

- **Settings for features you've never used now save.** HQPlayer only writes the parts of its configuration file it has had a reason to write, and never fills the rest back in — so if you'd never set up loudness, or never switched matrix processing on, your file simply had no loudness or matrix section in it. HQPTuner could edit what was there but couldn't add what wasn't, so every one of those settings was refused, and because one refused setting fails the whole apply, an unrelated change staged alongside it never landed either — and the save riding on it was skipped, leaving the preset holding stale settings. HQPTuner now creates the missing section in the right place, carrying only the setting you actually changed, and leaves every other byte of your configuration exactly as it was. This is the cause behind "my presets won't save" and changes that go stale after an apply.

- **A setting that genuinely can't be placed says which setting it was.** The message named the XML element — in angle brackets, which the browser swallowed as markup, leaving "Config not applied: absent from this snapshot" with the one useful word missing. It now names the setting you changed, and carries no markup for a browser to eat.

- **An apply no longer refuses on a configuration HQPTuner couldn't recognise.** HQPlayer names the working configuration inside its backup archive after whichever profile is active, and HQPTuner could only find it when the archive held exactly one candidate. Anything else read as "no working configuration at all" and every apply refused — permanently, because nothing about it changes on a restart. It now resolves the member by the active profile's name, which is what HQPlayer names it after.

- **That refusal used to blame the wrong thing.** The message asserted a known HQPlayer 6.0.4 bug (an empty backup archive after a profile load or save, which a service restart clears) — but an archive HQPTuner merely couldn't resolve produced exactly the same message, and restarting does nothing for it. It now reports what was actually observed, names both possibilities, and lists what the archive contained; the same detail goes to HQPTuner's log.

- **A restarting daemon no longer produces a server error.** While HQPlayer is coming back up it answers the backup request with an error page rather than an archive. Reading that as an archive crashed the request instead of taking the normal wait-and-retry path.

- **A failed apply now tells you it failed.** When an apply doesn't take, HQPTuner keeps your changes staged so you can retry — but the pending bar showed only the staged count and swallowed the reason, so the changes read as if they had never been sent. An apply that fails also skips the save riding on it, which is how **Apply & Save** could leave a preset holding stale settings with nothing on screen to say why. The failure is now shown alongside the staged count, and it names the settings that wouldn't take instead of saying only "unconverged"; the full detail goes to HQPTuner's log.

- **Apply no longer wedges on a setting you never touched.** An apply confirmed itself by reading the whole configuration back and requiring *every* setting in it to match what was sent — so one value the daemon writes back in its own format was enough to fail every apply, forever, on every tab, with nothing to say which value was at fault. An apply now confirms the settings it actually wrote.

- **Adaptive volume is saved into a preset.** It applies live and so never reaches the configuration file; a preset saved with it switched on stored it as off. A save now captures it from the running engine, the way the filter, modulator and mode settings already were.

- **Settings hidden behind a commented-out element are reachable again.** HQPlayer leaves a superseded element in the configuration file as a comment, above the live one — so on a machine whose output device had ever changed, every ALSA setting (device, DAC bits, period time, channel offset, DoP) was read from and written into that dead comment. Changing one reported success and did nothing. Reads and writes now skip commented elements.

- **An apostrophe in a filter path or a profile name no longer breaks the apply.** HQPlayer writes it as an XML entity HQPTuner didn't decode, so the value never matched what had been sent and the apply could never confirm itself.

- **"Save as New…" saved nothing.** Clicking it opened the name field, but the field never took focus, so everything typed went to the button that had just been clicked — and pressing Enter re-clicked that button, which withdrew the question. The preset was never written and nothing said so. The field is now focused outright; browsers block the attribute that used to do it whenever something else already has focus, which is always the case one click after opening the question. The same field is used by every prompt in the app, so **Save**, the overwrite confirmation and the header's delete confirmation are all fixed with it.

- **A blank name is refused out loud.** Saving with an empty field left the question open and said nothing, which reads exactly like a save that worked. It now says so.

## [0.8.2] — 2026-07-25

### Fixed

- **A saved matrix profile now survives a restart.** Saving one on the DSP tab's **Profile** card handed the name to HQPlayer, which listed it back and appeared to have kept it — but HQPlayer Embedded 6.0.4 registers a saved matrix profile in memory only. It never writes it into its configuration file, not on save and not on shutdown, so every profile saved on this path was gone the next time the daemon started, with nothing having said so. HQPTuner now writes the profile into the daemon's configuration itself, the same persistent path every other setting takes, and the daemon reads it back at startup, so a saved profile survives a restart. Delete goes the same way, and removes it for good rather than until the next start.

- **Saving over an existing profile name works.** It used to be refused, with the tooltip explaining that HQPlayer quietly ignores a save to a name it already knows and pointing you at deleting the old profile first. Now that HQPTuner is the one writing the profile, saving onto a name replaces it, and the delete-then-save detour is gone.

### Changed

- **Loading a matrix profile no longer interrupts playback.** **Load** went through HQPlayer's configuration form, which reloaded the engine for about three seconds — and then a second time, because HQPlayer's own load wipes the post-process settings that share the matrix (crossfeed, DAC correction, loudness), so HQPTuner had to put them back and pay for another reload. Load now rides the live control lane: the switch takes effect immediately, whatever is playing keeps playing, the post-process settings are left alone, and the profile's pipeline rows are staged as well so the choice is still yours after the next apply. Together with the persistence fix, none of **Load**, **Delete** or saving reloads the engine any more; the only restart left is the apply you choose to make.

  One consequence of HQPTuner owning the profiles: HQPlayer only knows the ones it read when it started. A profile you have saved but not yet applied therefore loads by staging its rows — it lands at your next apply instead of instantly. Nothing is refused for it, and nothing waits on playback stopping.

## [0.8.1] — 2026-07-25

### Fixed

- The facet dropdowns in **Narrow filters** stayed open until their own button was clicked again — clicking the page, or another facet, left them hanging over the filter cards. A click anywhere outside a popover now retracts it, and opening one facet closes whichever was open.

- Two controls were rendering with no tooltip and no description at all: **PCM gain compensation** on the Volume tab, and **Pipelines** on the Matrix tab. Both were drift between the table that describes a control and the file that holds its prose — the gain control's text sat under a slightly different key, and the matrix pipeline table had simply never been given any. Both now carry their text. The matrix one is newly written: it says what a pipeline is (a source channel routed through an ordered chain of processing stages and a gain into a target channel, with several pipelines able to sum into the same target) and says plainly that it is not the same setting as **DSP pipelines**, which only sets how many are available — two controls one word apart in the UI.

### Added

- The **About HQPTuner** card now closes with its own version and licence: `HQPTuner <version> · Released under the MIT License`, the licence name linking to the MIT text. The version is read from the running package over `/api/health` rather than written into the page, so it cannot drift from what is installed.

## [0.8.0] — 2026-07-25

### Added

- **High-frequency filter** on the Output tab. HQPlayer 6's playback filter — a source-side cut for noise, errors and distortion in bad-quality or fake-hires material — had no control in HQPTuner at all, despite the backend having spoken to it since the write path landed. It offers the engine's own list (`20k`, `30k`, `40k`, `50k` roll off at that frequency; `2x`, `4x`, `8x` cut steeply at that multiple of the base rate), each with the manual's description of what it is for, and takes effect immediately — the filter is switchable during playback. Named for what it does rather than HQPlayer's "playback filter", which does not say; HQPlayer's own name is carried underneath as a sublabel, the way **Auto headroom (Optimal ISO)** does, so the manual stays findable from it.

- **Speaker processing on the DSP tab.** HQPlayer's `/speakers` page — a level trim (dBFS) and a distance (cm) for each of its eight channel slots — had no representation in HQPTuner at all; the DSP tab was headphone-only. It now has both halves, behind a **🔊 Speakers | 🎧 Headphones** switcher at the top of the tab. The switcher is a *view* selector: it decides which setup's controls are on screen and never turns processing on. Switching to Speakers suppresses crossfeed — a real speaker pair already reaches both ears, so synthesizing more leakage is wrong — and takes the whole of it out of the path: HQPlayer's Bauer flag, a structural block, and Bauer's compensation rows, whose entire purpose is to correct for a crossfeed that is no longer running. Those eight rows are also where a loaded headphone EQ lives, so dismantling them hands the profile back to pipelines 1+2 exactly as it was. The suppression is a staged edit the pending bar counts and Discard undoes, and it is suppression rather than abandonment: switching back to Headphones puts back exactly what was taken — a structural block as a block, Bauer's flag and its compensation rows together, a crossfeed that was already off left off. Nothing is restored over pipelines edited on the speaker side; that work is yours and the snapshot is dropped instead. The snapshot rides in browser storage beside the mode itself, so reloading the page on the speaker side does not strand the headphone setup. The matrix, the pipelines and the response chart are common to both setups and stay put below the switcher.

  The Speakers card carries the master switch, a **speaker set** picker (2.0 / 2.1 / 5.1 / 7.1 — your choice of which channels to configure, not a reading of the engine's channel count; the daemon keeps all eight either way), per-channel level and distance boxes, and a top-down room plan that draws each speaker at its layout angle, at a radius following its distance setting, with its level labelled. Channels outside the chosen set are drawn dimmed rather than hidden. Under Direct SDM the level column grays — Direct SDM bypasses the volume control — while the distances stay editable, because the delays still apply.

  Applying reloads the engine (~3 s), interrupting playback if any — it is never refused for that, like every other write; the write is checkbox-safe (the daemon persists a stray `0`/`on` verbatim into its XML and wedges engine init) and range-validated server-side, and the result is verified by reading `/speakers` back rather than assumed.

- The filter narrowing bar's **genre** menu now offers **All genres** — the tag the manual gives filters that suit every genre. Nineteen of the shipped filters carry it, and it was the one genre value with no way to select it; picking it narrows the menus to exactly those filters. It is not the same as selecting nothing, which the button calls "Any genre" and which narrows by genre not at all.

- The browser tab's favicon now follows the DSP tab's mode — 🔊 for speakers, 🎧 for headphones. It used to sniff the *active preset's name* for the words "headphone"/"speaker", which was only ever true for people who named their presets that way.

- **Ratio narrowing.** The filter narrowing bar gains a sixth facet — **ratio** — beside genre, quality, focus, phase and length. It narrows the menus to filters of a chosen resampling-ratio class (**Integer**, **2×** or **1:1**); the manual's any-ratio filters survive every selection, the same escape hatch genre's "All genres" uses. The dropdown also carries an **Upsample-only** checkbox — the manual fuses this ("Integer up") into the ratio column — narrowing to filters that only upsample, ANDed with any ratio class picked. The classes are transcribed from the manual's filter table into the static overlay, for every filter.

- **About HQPTuner** — a collapsed-by-default card at the foot of the System tab, saying what the project is, giving credit to Jussi Laako/Signalyst for the engine it drives, and noting that HQPTuner is free and stays that way. It carries the project's only donation link: an inline Ko-fi anchor inside a sentence, not a button or a badge. Nothing is fetched from off-box, so the subsection renders identically on a LAN-only install with no outbound route.

### Changed

- **Captions, notes and hints are one grey again.** Every explanatory line under a control set its own colour *and* its own opacity, and opacity multiplies a colour rather than replacing it — so the page carried five different effective greys for what is one kind of text. Field notes, descriptions, gray-out reasons, section notes, the alternate-name glosses, plot captions and the matrix library credits now share a single tier. The visible effect is small and goes both ways: the italic gray-out reasons and section notes come up slightly brighter, plot captions and library credits settle slightly dimmer, and everything else lands where it already looked. Group labels (the small uppercase ones over knob clusters and meters) likewise share one tier now, where the knob clusters had been a shade darker than the meters.

- **Text sizes snapped to a scale.** The stylesheet had drifted to 24 different font sizes with no steps between them — 0.78rem and 0.8rem for the same kind of text, 0.9rem and 0.917rem for the same control. They collapse to a named ladder of twelve. No text moves by more than three quarters of a pixel; the point is that new text now has an obvious size to take instead of a plausible-looking one.

- The preset **delete** button used an off-palette red found nowhere else; it takes the standard one.

- **Pre-process before metering moved to the Output tab**, into **General** beside the high-frequency filter it is usually set for — the one option it decides the visibility of. It was alone in a **Metering** card of its own on the System tab, a card for a single checkbox. The System tab's **HQPTuner** preferences card takes that slot beside **About**, so the tab opens on identity and preferences rather than on a one-line card.

- **Nothing is refused for being mid-playback any more.** Applying engine hardware settings, restoring a settings archive, applying speaker processing, and matrix profile Load / Save-as-new / Delete all used to answer *"daemon is not idle (stop playback first)"* and do nothing, because each one reloads or restarts the engine and so interrupts whatever is playing. Whether that interruption is worth it is the listener's call, not HQPTuner's: the cost is stated in each control's caption, and the click is now honoured whether or not music is playing.

- **The slider-and-number-box control is now one control everywhere it appears.** Crossfeed's three structural sliders (speaker angle, head circumference, center character) and the crossfeed-correction strength slider were each their own hand-rolled markup with their own CSS namespace; they now render the same control the rest of the app uses, so a wheel guard, a drag-versus-release distinction or a fix to any of it reaches all of them at once. The visible differences are small and deliberate: the number box picks up the standard field width every other numeric control has (it was carrying a hardcoded one of its own, a little narrower), and its unit now sits inside the box's own chrome. The structural sliders keep their full-width track, and the fill still grows from the left as the value grows.

- **Apodizing narrowing moved under each 1x dropdown, and is now per-chain.** It was one global **Show apodizing only** toggle in the narrowing bar, narrowing the PCM and SDM 1x filter lists together. Each 1x dropdown now carries its own **Show apodizing only** / **Show ½ apodizing** pair, independent of the other — narrow one chain's list without touching the other. Moving it also freed the bar for the new ratio facet (six facet menus do not fit beside the toggle). The manual's description of what apodizing is, previously only a hover tooltip, now sits visibly beneath the checkboxes for anyone unsure whether to leave it on.

- **Loading an EQ file now loads the EQ.** The **Load AutoEq / REW .txt…** button used to only drop the file's text into a box and wait for you to find a pipeline row and press its **Import EQ** — a button that appeared to do nothing, and a workflow nobody would guess. It now applies the profile on the one click, to pipeline 1 and its stereo pair, exactly as the AutoEq library's "Load profile" already did. The paste box is gone: with two one-click load lanes there was nothing left for it to do, and it had no way to apply what you pasted into it. A row's own **Import EQ** still works for putting EQ on a specific pipeline.

- The Resampling tab's **SDM Sources** subsections are now labelled **DSD Sources**, in both the PCM and SDM output cards.

- The System tab's About card labels HQPlayer's build string **Version** rather than **Engine**, which is what the value has always been.

- **The top chrome now lines up with the cards.** The header band, the signal-path row, the alert strip and the tab bar took their horizontal inset as padding, so their *content* sat on the card lane while their background and bottom rule ran 15px past it on both sides, out to the container edge. The inset is now margin against a named `--gutter` token, so every painted edge in the chrome stops where the cards stop. The brand glyph's viewBox is trimmed to the circle's painted extent for the same reason — it was drawing 2px inside the lane.

- **Head circumference** moves in 0.25 cm steps on the slider (was 0.5 cm), and its number box takes any value in range instead of snapping to the slider's detent. The readout carries two decimals, so a quarter-centimetre setting reads as itself rather than rounding to 55.3.

### Fixed

- The **gray-out warning** boxes on the filter narrowing bar referenced a colour variable that was never defined, and had been drawing on their hardcoded fallback since they landed. The variable exists now, so they follow the palette like everything else.

- **A staged high-frequency filter now accents the Output tab, not DSP.** The field→tab map that lights a tab holding unapplied edits never listed `junk_filter`, and unlisted keys fall through to the DSP tab — so changing the filter and switching away pointed at a tab the control isn't on. `pre_before_meter` is mapped to Output too, following its move there.

- **A failed request now says what went wrong instead of showing a number.** Every error the backend answered with — "no hqplayerd credentials configured", "GET /matrix failed: …", a rejected level or distance — was thrown away at the fetch layer and reported as the URL and the status code (`/api/speakers -> 502`), on every tab. The reason the backend gave is now the message; the path and status remain as the fallback for a response that carries no reason at all.

- **Loading an EQ profile no longer breaks a structural crossfeed block.** The import knew about Bauer's compensation block — eight rows it owns as one unit — and routed into it, but not about the structural block's sixteen. A profile loaded while structural crossfeed was on landed on pipelines 1+2, which are the left ear's centre path: the block stopped being recognized, its badge and controls vanished, the card fell back to Bauer, and the new profile sat on two rows out of sixteen while the other fourteen went on carrying the old one. Nothing said so. An import now recompiles the block with the new EQ — both ears, the Preamp line folded into the gains the way the block wants it, on whichever channels the block was built for — so the profile lands whole and the crossfeed stays exactly as it was. A pipeline past the block still takes the plain import path, unchanged.

- **The crossfeed mode segment no longer switches processing on by itself.** Bauer | Structural was derived from the pipelines rather than stored, which made a view selector into a mutator: selecting Structural *installed* the sixteen-row block (there was no other way for the selection to stick), selecting Bauer *enabled* HQPlayer's crossfeed outright, and pressing **Turn off** under Structural dropped the card into Bauer, since with the block gone the rows read as Bauer. None of that was asked for by the click that caused it.

  The mode is now the user's own choice, remembered per browser, and it obeys one rule: selecting a mode disables the one being left and enables nothing. Leaving Structural removes its block; leaving Bauer switches the crossfeed off *and* dismantles its compensation rows, which would otherwise go on correcting for a crossfeed that is no longer running. Arriving anywhere turns nothing on — **Turn on**, and the Bauer **Enable** checkbox, stay the only things that do, and each keeps whatever it was last set to. **Turn off** now only turns that crossfeed off; the card stays on the mode you were reading. Every one of these disables stages like any other edit, so the pending bar counts it and Discard puts it back.

- **Filters, dither, modulator and output mode no longer restart the daemon.** Changing any of them meant a full `hqplayerd` restart — roughly six seconds of silence, and playback stopped — even though HQPlayer's Control API can set every one of them instantly. HQPTuner spoke that API already; nothing in the UI ever reached it, so the settings people change most were the slowest ones in the app. Staging and **Apply** work exactly as before — Apply now sets them through the Control API instead of rewriting the config and restarting, so the change takes effect at once and playback is never interrupted.

  Persisting is unchanged and still explicit — **Save** writes the running config, and it now captures what you are actually hearing rather than what happened to be on disk.

  Getting there needed two translations HQPlayer does not do for you. The config file and the Control API name the same filter with different numbers (the file stores an enumeration id, the setters take a list position), and the PCM and SDM chains number their own lists differently again — `poly-sinc-gauss-long` is 40 on one and 38 on the other — so a value is only meaningful against the chain the engine is currently running. HQPTuner resolves both from the engine's own enumerations, including under **Auto** output mode, where it reads which chain is live rather than guessing. Anything it cannot resolve falls back to the old restart path, which is slower but never wrong.

  Output rate is deliberately excluded: the per-family rate control sets a *ceiling* that the engine follows from the source, while the Control API's rate setter forces a fixed rate outright. They are not the same setting, and treating them as one would quietly break auto-family rate following.

- **Filter narrowing lost the focus facet on the whole SDM chain.** The engine separates a filter's quality/focus head from its ratio class with a direction glyph that **differs by chain** — `⥮` on PCM filters, which resample both ways, and `⥣` on SDM oversampling filters, which only ever go up. The parser matched `⥮` alone, so on the SDM chain the **focus** facet (transients / timbre / space) silently matched nothing: 50 of the 77 SDM filters carry a focus token that was being thrown away, and focus is the one facet with no static fallback to cover the gap. Both glyphs are read now.

- **Filter narrowing no longer shows a bogus list for the output mode you are not in.** The narrowing facets were built only from the engine's *live* filter enumeration, which carries the filters of the mode the daemon is currently in and no others. HQPTuner shows both the PCM and SDM filter chains at all times, so the inactive mode's exclusive filters — `poly-sinc-hb-*`, `closed-form-M`, `ASRC` and the like when the engine is in an SDM mode — had no facet data and slipped through every narrowing choice unfiltered: pick **Short** by length and you would still see extra-long and unrelated filters in the list. Facets now fall back to the static overlay (transcribed from the manual) for any filter the live enum omits, so narrowing is correct in both chains regardless of the engine's current mode. The live enum stays the authority for the mode it is in; static fills only the gap it cannot see.

## [0.7.0] — 2026-07-23

### Added

- **Export EQ** as a REW / Equalizer APO text file — the write-side twin of the AutoEq/REW importer. A master button exports the whole pipeline set, a per-row button exports one pipeline. Peaking, shelf and pass/notch/all-pass stages export frequency, gain and Q verbatim; the pipeline's dB gain becomes the `Preamp:` line. A stereo-identical pair collapses to one block; differing channels get `# Pipeline N` headers. Stages with no parametric form (raw biquads, first-order slopes, delay, convolution) are omitted and counted in the tooltip.

### Changed

- Tab labels turn the accent colour while that tab holds staged edits — the pending bar says *that* changes exist, the coloured tab says *where*. Live edits that already reached the daemon do not light a tab.
- The Matrix response chart is titled **Matrix response**, so it and the Crossfeed response plot no longer read as the same card when collapsed.
- The Buffer time tooltip explains the `−1` = minimum setting: never for normal playback, only attemptable for realtime inputs on the input backend. (Guidance from Jussi.)
- The standalone "DSD sources" card is gone; its six controls moved into the PCM and SDM cards, split into "PCM Sources" and "SDM Sources" subsections. Per-field mode graying dropped — the card already collapses when the output mode doesn't use it; expanding the wrong card shows a plain note instead.
- Preset naming and overwrite/delete confirmation happen inline instead of through the browser's `prompt()`/`confirm()`, which are blocked outright in some embedded browsers — in a wrapped webview, saving a preset simply did nothing. Enter commits, Escape cancels, a blank name is refused in place; one question open at a time.
- The Bauer | Structural switch fills the Crossfeed card header instead of sitting undersized in it.
- The Pipelines card collapses, keeping the row count on its header — with rows in it, it ran most of the page length and pushed everything below out of view.

### Fixed

- No more false "Output buffer at 0% — starvation" warning on outputs that never populate an output buffer (SDM/DSD direct paths report a flat 0 the whole time they play). A genuine underrun is transient by design, so a *sustained*-low alert could only ever misfire. The meter now reads **N/A** on such outputs instead of a misleading 0%.
- The Resampling PCM/SDM cards handle a manual collapse correctly. A hand-collapsed card used to stay shut permanently, and the reset that clears a manual toggle fired on every field edit rather than on a mode change — so staging any change slammed a hand-opened card shut.
- The Docker container could fail to start after a host reboot with `error mounting "/tmp/hqplayerd.log" ... not a directory` — the compose file bind-mounted the daemon's log file, and Docker created the missing source as a directory. The log tail now reads the daemon's `GET /log` over port 8088, so the bind mount is gone and the tail works for any `<log file>` setting (file, journal, custom path). No configuration change on upgrade.
- The far-ear paths in the structural crossfeed diagram ended at the listener's nose — drawn as straight lines through the head, which the filled head disc painted over. Each is now a continuous curve from speaker round the head to the far ear, which is the path whose extra length *is* the interaural delay the model encodes. Solved against the full range of both sliders, not tuned at one setting.
- The signal path bar showed a filter and modulator that were not in the path during DSD playback. HQPlayer runs four conversion chains by source/output type and reports its *configured* filter and shaper whichever is live. The bar now follows the real path: DSD→DSD shows the integrator and SDM→SDM; DSD→PCM the noise filter and SDM→PCM ahead of the resampling filter and dither; PCM→DSD the modulator; PCM→PCM the dither. Direct SDM collapses to a bit-perfect pass-through and drops the matrix, crossfeed and DAC-correction chips (manual §4.5).
- Volume range and startup volume gray when the volume control they bound is bypassed, and say which reason. Min and max both at 0 is deliberately excluded — graying there removes the only controls that get you out of it.
- Unreadable browser storage warns once instead of falling back to defaults silently, distinguishing absent storage from storage that refused the read.
- The Python wheel ships the frontend and metadata JSON. `pip install hqptuner` previously carried neither `hqptuner/static/` nor the filter/shaper/settings JSON; Docker only worked because the working directory shadowed the installed copy.
- Docker images no longer bake in stray bytecode — `.dockerignore` root-anchored `__pycache__`/`*.pyc`, so nested copies still entered the build context.
- Turning structural crossfeed off could rewrite rows without saying so: with no install-time stash available it rebuilt the pair from the block, canonicalizing row order and reformatting gains, and both paths looked identical from outside. The rebuild path now says what it did and asks you to check rows 1 and 2 before applying.
- Crossfeed compensation regained its label and hover explanation — merging the crossfeed and compensation cards dropped the wrapper whose header carried them, leaving a slider and buttons with nothing saying what they were.

## [0.6.0] — 2026-07-22

### Added

- **Structural crossfeed** — a second crossfeed implementation alongside Bauer, on a segmented toggle in the Crossfeed card. Where Bauer exposes a crossover frequency and a level in dB (coefficients of its own filter), this models an actual head and an actual speaker pair: speaker angle, head circumference, centre character. It compiles to sixteen literal matrix pipelines carrying an explicit interaural delay and a head-shadow filter from Brown & Duda's structural HRTF model; the shadow filter factors exactly into a flat row plus a first-order lowpass, so nothing is numerically fitted and nothing is sample-rate-bound. Rows stay hand-editable and badged; an edit that breaks the pattern drops the badge rather than being blocked or rewritten. Derivation in the new `docs/crossfeed-math.md`.
- Centre character has no hardware equivalent. Real speakers colour centred sound darker than the sides and notch it — at 30° the centre response dips 11.6 dB at 1426 Hz. In a room reflections fill that; headphones reproduce it bare. The control scales the colouration from literal to none with the stereo image byte-identical at every setting. Presets come from the measured ripple curve: Standard 30°/70%, Anechoic 30°/100%, Intimate 22°/70%, Wide 45°/50%, Neutral center 30°/0%. Head size is excluded from presets and persists across them — anatomy, not taste.
- The card shows a live top-down geometry diagram, computed ear-to-ear delay (high- and low-frequency), far-ear treble level, centre shift, and a collapsible response plot. Headphone EQ rides through untouched and per ear, so asymmetric measured corrections are carried rather than refused.

## [0.5.0] — 2026-07-22

### Changed

- Crossfeed compensation no longer reads as if the treble tilt it removes were a fault. Centred sound really is ~1.8 dB duller in the treble than the sides, close to what a real ±30° speaker pair does — so compensation is a tonal choice (speaker-like vs neutral centre), not a repair. Grounded in Brown & Duda, whose ±30° centre tilt of 1.80 dB matches bs2b's default preset at 1.81 dB.
- "Optimal ISO" is now **Auto headroom**, keeping `(Optimal ISO)` as a sublabel so the manual stays findable. The description drops the jargon: loud tracks can peak above 0 dBFS between samples after resampling, and the margin leaves room instead of clipping.
- Three two-column cards group related controls down a column instead of pairing unrelated ones across the divider — DSD sources by conversion path, hardware acceleration by CUDA/CPU, preferences by what gates what.
- Volume tab layout: the playback knob shares the top row with Fixed volume, the Range bar spans full width below, Automatic moved to full width. Auto headroom sits at the top of Fixed volume as an independent control, with only the dBFS level indented under the enable.
- The Response plot shows data by default instead of an empty frame: every pipeline carrying processing is plotted without toggling ◉, and selecting a stage chip plots its row. A recognized compensation block draws as the single headphone-EQ curve it was built from rather than its eight internal pipelines; byte-identical stereo pairs collapse to one trace (`1+2`). Traces take evenly-spaced computed hues so any number stays distinct, replacing a four-colour cycle that repeated.
- Every full-width two-column card draws a hairline between its columns, all on the card's centre line so they stack down the page. Full-width rows are not struck through, and competing section-marker borders were dropped so each split shows exactly one divider.
- The crossfeed / loudness knob readout moved from beside the slider to directly under the dial, freeing horizontal space.

### Fixed

- Loading a headphone profile while compensation was on silently broke it. Import appended filters to pipelines 1+2 only and overwrote their gain with the profile's preamp in dB, dropping the mid/side factor — centred sound came out ~6 dB louder in the left ear, those rows carried the EQ twice, and the block stopped being recognized, taking badge, slider and Turn off with it. Imports now route into the block when one is installed: the EQ joins its shared chain and the preamp folds into its gains.
- The compensation strength slider rendered in the browser's default blue — the accent rule was scoped to a `.slider` wrapper the bare input doesn't have.
- The mouse wheel no longer changes a control's value while paging past it. Knob dials don't bind the wheel at all; range sliders and number boxes let the page scroll.
- Hardware-acceleration fields show their hover tooltip when Feature descriptions are off — built outside the shared Field component, they never carried a `title`.
- Fixed volume and Auto headroom no longer trap the volume control. Auto headroom was greyed whenever Fixed volume was off, as if it were a sub-option — so turning Fixed volume off left it stuck on at −3 dB, still bypassing the live volume, with the one control that could clear it greyed. It is now gated only by Direct SDM, and enabling either mode clears the other as a visible staged edit.

### Added

- Per-page "quick updates" opt-ins bumping the live status/volume poll from 2 s to 0.5 s while the page is open (System → Engine health, and under the Volume knob). Off by default, remembered per browser; only the page you are looking at polls faster.

## [0.4.0] — 2026-07-21

### Added

- **Crossfeed EQ compensation** (DSP tab): headphone EQ profiles assume listening without crossfeed, but Bauer dulls centred sound by ~1–2.7 dB toward the treble. One click rebuilds the stereo EQ pair into eight mid/side pipelines correcting only the centred part, leaving the stereo width effect untouched. Strength slider (0 % off · 100 % neutral · up to 150 %, with a content guide), a mini correction plot, a "what you hear" overlay on the Response plot, and staleness detection with one-click rebuild when crossfeed settings change. The block is literal badged pipelines, fully hand-editable; edits that break the pattern return it to plain rows. Cascade accurate to ≤0.05 dB against the exact inverse.

### Fixed

- All response plots label their axes (dB / Hz, ° on the phase scale), and trace labels right-align inside the frame with a halo instead of clipping ("center, c…").
- Loading a matrix profile no longer loses post-process settings. HQPlayer's `/matrix/load` replaces the whole matrix context — crossfeed, DAC correction and loudness were silently cleared. HQPTuner snapshots them before the load and re-applies afterwards, verified by readback (cost: a second ~3 s engine reload per load).

### Changed

- Tab reorganization: Loudness moved to Volume (it is volume-adaptive), Crossfeed to the matrix tab as its own collapsible card. That tab is now DSP and its General card is now Matrix; the old post-process DSP tab is gone — five tabs total.
- The CUDA DSP-device id grays in Convolution-only offload mode, with the reason captioned (`cuda_dev` drives filters/DSP tasks, which that mode never offloads).
- The Engine health card is a full-width meter cluster: VU-style needle for process speed (red below 1.00×, amber to 1.05×, pegs past 4×), tick-marked bar meters for buffer fill (amber under 15%), and clip / apodizing counters with per-track deltas. Values sweep between polls instead of jumping.

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
