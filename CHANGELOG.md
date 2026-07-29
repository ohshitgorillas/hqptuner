# Changelog

Notable changes to HQPTuner. Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/) once out of beta.

## [Unreleased]

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
