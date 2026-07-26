# Changelog

Notable changes to HQPTuner. Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/) once out of beta.

## [Unreleased]

### Added

- **A beta channel.** `ghcr.io/ohshitgorillas/hqptuner:beta` publishes from the new `beta` branch, so a fix can be handed to a tester before it reaches everyone. Point your compose file's image at `:beta`, pull, and you are on it; set it back to `:latest` to leave. `:latest` is unchanged and still the stable channel.

### Changed

- **The default branch is now `main`** (was `master`). `:latest` follows it as before. If you have a clone, `git branch -m master main && git fetch --prune && git branch -u origin/main main`.

### Fixed

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

- The Matrix tab can **export EQ** as a REW / Equalizer APO text file — the write-side twin of the AutoEq/REW importer, so an EQ you tuned here drops straight into REW, Equalizer APO, Peace, CamillaDSP, and anything else that reads that format. Two buttons: a master **Export AutoEq / REW .txt…** beside the Load button, which sends the whole pipeline set at once (`hqptuner-matrix-eq.txt`), and a per-row **Export EQ** beside each row's Import EQ (`hqptuner-pipeline-N.txt`). Peaking, low/high shelf, and pass/notch/all-pass stages export with their frequency, gain, and Q verbatim; a pipeline's dB gain becomes the `Preamp:` line. A stereo-identical pair collapses to one clean filter block; channels carrying different EQ are written under `# Pipeline N (In i -> Out j)` section headers so nothing is dropped or silently merged. Stages with no parametric form (raw biquads, first-order slopes, non-EQ stages like delay or convolution) are omitted and counted in the button's tooltip. Both buttons disable when there is no exportable EQ.

### Changed

- Tab labels now turn the accent colour while that tab holds staged, unapplied edits, so a change made on one tab is not lost when you move to another — the pending bar tells you *that* changes exist, the coloured tab tells you *where*. Only the staged/pending set (what Apply commits) lights a tab; live edits that already reached the daemon do not.

- The Matrix tab's standing response chart is now titled **Matrix response** instead of just "Response", so when it and the Crossfeed card's "Crossfeed response" plot are both collapsed the two headers no longer read as the same card.

- The Buffer time tooltip (both the ALSA and Network output backends) now explains the `−1` = minimum setting: never use it for normal playback — it can be attempted only for realtime inputs using the input backend. (Guidance from Jussi.)

- The Resampling tab's standalone "DSD sources" card is gone; its six controls now live inside the PCM and SDM cards they actually belong to. Each card is split into a "PCM Sources" subsection (the existing filter/dither or filter/modulator chain — how a PCM source is handled for that output) and an "SDM Sources" subsection (Direct SDM, Integrator, SDM→SDM conversion in the SDM card; Noise filter, SDM→PCM conversion, +6 dB gain in the PCM card — how a DSD/SDM source is handled for that output). None of the six are individually grayed by mode any more — the card itself already collapses when the current output mode doesn't use it, so a per-field reason was redundant; expanding the "wrong" card anyway now shows a plain note ("Output mode is PCM/SDM. These settings have no effect.") instead. Each subsection packs its dropdowns into the left column and its checkbox into the right, matching the existing filter-chain layout.

- Naming a preset and confirming an overwrite or a delete happen inline now, instead of through the browser's own `prompt()` and `confirm()` boxes. Those never matched the rest of the app, were awkward to back out of, and are blocked outright in some embedded browsers — in a wrapped webview, saving a preset simply did nothing. The name field opens in the pending bar where the action was taken: Enter commits, Escape cancels, and a blank name is refused in place rather than silently dismissing the question. The delete confirmation opens beside the preset picker. One question is open at a time, and asking a second supersedes the first rather than leaving it stranded.

- The Bauer | Structural switch in the Crossfeed card header fills the header instead of sitting undersized in it — measured at 1280, it now occupies 96.9% of the header's content box and takes its type size from the header rather than the browser's default button font.

- The Pipelines card on the DSP tab collapses. Once a matrix has rows in it the card ran most of the length of the page and pushed everything below it out of view; it now carries the same header toggle the Headphone Auto EQ and Crossfeed cards already use, open by default, and keeps the row count on the header so a collapsed card still says how many pipelines are configured.

### Fixed

- The System tab no longer raises a false "Output buffer at 0% — starvation" warning on outputs that do not populate an output buffer. Some outputs (SDM/DSD direct paths were the observed case) report a flat `output_fill` of 0 the whole time they play, exactly as `input_fill` reports a flat −1 for network audio — the buffer simply does not apply to that path. The old alert fired on any *sustained* low fill, but a genuine output-buffer underrun is transient by design (the buffer drains to 0, playback skips for an instant, then it refills to 100%), never a sustained low — so the sustained-low alert could only ever misfire on a non-applicable buffer. The alert is gone, and the Output buffer meter now reads **N/A** (blank, like the input meter already does) on an output that never populates a buffer, instead of a misleading 0%. An output that does run a buffer still shows its live fill.

- The Resampling tab's PCM and SDM cards now handle a manual collapse correctly. Each card auto-opens or closes with the output mode; collapsing or expanding one by hand overrides that until the next actual output-mode change, when automatic disclosure re-asserts. Two faults are gone: a hand-collapsed card used to stay shut permanently — closed in Auto, it would not reopen even after switching to the mode that uses it — and the reset that clears a manual toggle was firing on *every* field edit, not just on a mode change (it reads staged-edit state, which changes whenever any control does), so staging any change slammed a hand-opened card shut. The reset now runs only when the resolved output mode actually changes, so a manual toggle survives unrelated edits and clears only on a real mode change.

- The Docker container could fail to start after a host reboot with `error mounting "/tmp/hqplayerd.log" ... not a directory`. The compose file bind-mounted the daemon's log file straight off the host, and if that file did not exist when the container came up (its path is on `tmpfs`, wiped every boot, and the daemon may not have written it yet — or may log to the journal, or to a path you configured), Docker created the mount source as an empty *directory* and the mount then failed. The log tail now reads the daemon's `GET /log` page over the same port-8088 web interface it already uses for everything else, so the bind mount is gone entirely: the tail works regardless of your `<log file>` setting (file, journal, or a custom path) and no longer depends on a host file existing at container start. No configuration change is needed on upgrade.

- The far-ear paths in the structural crossfeed diagram ended at the listener's nose. They were drawn as straight lines to the opposite ear, which run through the head, and the filled head disc paints over them — so each dashed line visibly died where it met the skull. Each is now a single continuous curve from the speaker round the head to the far ear: no straight segment, no join, no corner. This is the path whose extra length *is* the interaural delay the structural model encodes, so the diagram illustrates the maths in `docs/crossfeed-math.md` instead of contradicting it. Its shape is solved against the full range of both sliders rather than tuned at one setting — an earlier version cut 2.2px into the head at a 60° speaker angle with the largest head size.

- The signal path bar showed a filter and a modulator that were not in the path while DSD content played. HQPlayer runs four different conversion chains depending on whether the source and the output are PCM or DSD, and the engine reports its *configured* filter and shaper whichever one is actually live — hqplayerd's own web UI shows the same pair regardless — so a DSD track going to a DSD output displayed a modulator (`AMSDM7EC 512+fs`) and an oversampling filter that neither touch it. The bar now follows the real path: DSD→DSD shows the integrator and the SDM→SDM conversion, which are the only two stages the manual names for remodulation; DSD→PCM shows the noise filter and the SDM→PCM conversion ahead of the resampling filter and dither; PCM→DSD names the modulator, and PCM→PCM the dither. Direct SDM collapses the chain to a bare bit-perfect pass-through and drops the matrix, crossfeed and DAC-correction chips with it, because it disables all processing (manual §4.5).

- Volume range and startup volume stayed editable while the volume control they bound was bypassed. They now gray for the same reasons the master volume knob does — Direct SDM, fixed volume, auto headroom — and say which one. The one bypass case deliberately left out is min and max both sitting at 0: graying the range there would take away the only controls that get you out of it.

- Unreadable browser storage no longer fails silently. `prefs.js` fell back to defaults with no signal at all when `localStorage` was missing or threw, which is invisible in a private-mode browser and would quietly defeat any persistence test under node. It now warns once, distinguishing storage that is absent from storage that is present but refused the read.

- The Python wheel ships the frontend and the metadata JSON. `pip install hqptuner` previously produced a package carrying neither `hqptuner/static/` nor the filter/shaper/settings JSON, so it could not serve the SPA and had no prose to join against the live enumerations; Docker only worked because the working directory shadowed the installed copy, and if that shadowing ever stopped the SPA mount was skipped with nothing logged. Verified against a built wheel: 84 static assets and all three metadata files are in it.

- Docker images no longer bake in stray bytecode. `.dockerignore` root-anchored `__pycache__` and `*.pyc`, so every nested `hqptuner/**/__pycache__` still entered the build context; both patterns are recursive now.

- Turning structural crossfeed off could rewrite rows without saying so. Removal normally restores the exact rows the block was built over, stashed when it was installed; when there is no stash — another browser, cleared storage, a block installed before the stash existed — it rebuilds the pair from the block instead, which canonicalizes row order to In 1-first and reformats the gains. Both paths looked identical from the outside. The rebuild path now says what it did and asks you to check rows 1 and 2 before applying. `docs/crossfeed-math.md` §8.1 also claimed the stash was lost after an Apply and a reload; it is persisted alongside the remembered controls and survives both, and the section now says so along with the consequence — a stash is browser-local and is not invalidated when the configuration changes under it.

- The Crossfeed compensation controls regained their label and its hover explanation. Merging the crossfeed and compensation cards into one two-mode card inlined the compensation strip and its plot but dropped the card wrapper whose header carried the name and its description, leaving a slider and buttons in Bauer mode with nothing saying what they were. It is now a "Crossfeed compensation" section header alongside "Response plot" — collapsible, open by default — and hovering it describes what compensation does again.

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
