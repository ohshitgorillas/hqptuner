# Junk-filter advisor: binding for the recommendation system

The advisor reads the metering stream, identifies junk above the music, and shows the user a note that names the junk, teaches what it is, and recommends the HQPlayer setting that treats it. The advisor never writes to the engine. The user acts or ignores. Detector arithmetic, scores and the corpus live in `docs/research/junkfilter/junk-filter-autopilot-resource-20k.md`; this document holds the rules every detector, grade and note obeys.

## Words

| Word | Meaning |
|---|---|
| **Junk** | Anything above the music that the recording did not need: fake hi-res, spurs, rising HF noise. |
| **Fake hi-res** | Content from a lower-rate source carried in a higher-rate container. Above the source Nyquist it carries images, a noise floor, or nothing. |
| **Spur** | A steady discrete tone above 20 kHz, from recording or playback equipment. |
| **Rising HF noise** | A noise floor that climbs with frequency, from noise shaping or a DSD transfer. |
| **Content ceiling** | The highest frequency the music has reached in the stream. |
| **Roll-off start** | Where a filter setting begins to cut, read on HQPlayer's meter: 20k about 22 kHz, 30k about 35 kHz, 40k about 42 kHz, 50k about 60 kHz. A tone 2 kHz above a start is reduced; 6 kHz or more above it is gone. Nothing here is a measurement of the filter. |
| **Corner** | The HF Filter setting a note recommends: 20k, 30k, 40k, 50k, or the rate-relative 2x, 4x, 8x. |
| **Window** | The span of recent stream the live decision reads. |
| **Note** | The text the user sees. It carries a recommendation or nothing. |

## Constraints

**Three junk types, one system.** Every rule, constraint and grade in this document applies to fake hi-res, spurs and rising HF noise alike. A grade table names the type it reads.

**Continuous stream, no track identity.** Roon sends no track or album information to HQPlayer. The engine knows no track boundary and no metadata. Nothing is keyed on `track_serial`, `position`, metadata, or a boundary of any kind. Every rule reads a window over the stream.

**The live decision window is 45 s at most**, for every type. A clear-cut case decides near at once; a borderline one takes up to 30 to 45 s; nothing takes minutes. Grading reports time-to-note against this limit. Offline analysis may read whole files to build and grade a rule; the rule that ships decides inside the window.

**Zero real content called junk.** A cut that fires on any real track under leave-one-album-out grading is rejected, whatever it buys on the junk side. The score of a candidate is junk caught at that cut, per type.

**Every fake hi-res shape is a target.** A wall of any steepness, a wall with an empty band above it, and a source floor imaged across the band with no shelf at all. A fake album the rule stays silent on is a miss.

**Do no harm.** A recommendation to engage needs conclusive evidence. A recommendation to disengage needs positive evidence. Unsure says nothing and leaves the user's setting alone.

**Standard mathematics only.** The source spectrum on the wire is measured freely. HQPlayer's filters are never measured: no corner, width, attenuation or tap count, with the filter engaged or not. Where HQPlayer's documentation is silent on a filter the answer is "undocumented".

## The corner

The corner is the highest setting whose roll-off start sits clear under the junk. Where there is more than one piece of junk, the lowest piece sets the corner and the corner treats everything above it. Fake hi-res from a 1x source takes 20k in any container. A source at a higher tier than 1x inside a still higher container takes the rate-relative setting of its own tier; 2x, 4x and 8x cut at a multiple of the base rate.

Where the content ceiling reaches above the chosen corner's roll-off start, the junk sits within the music. No HF Filter cuts it without cutting real content, and the note recommends a `hires` upsampling filter in the Nx slot instead, whose slow roll-off is the mitigation.

A rising floor under the music takes no corner. A rising floor above the content ceiling takes the corner set by where the floor begins to rise.

## The content ceiling is a one-way reading

The ceiling is a property of the recording, not of the moment. A loud passage that reaches 30 kHz proves the content reaches 30 kHz. A quiet passage after it proves nothing. The ceiling therefore only rises. It never falls on a quiet passage, a fade, or digital silence. It resets on a sample-rate change and on nothing else.

Consequences. A junk-filter recommendation for a spur or for rising noise is made only after the music has shown itself: the window carries loud passages, with the ceiling under the corner's start. The budget for these types is spent watching the content, not the tone; the tone itself is read in seconds.

Once the ceiling crosses the corner's start the junk is within the music and stays there for the stream; a stream carries at most one transition, from the junk filter to the `hires` filter, and never the reverse. Where the window expires with no loud passage seen, nothing is said about the junk filter; a conclusive spur may still take the `hires` note, which is safe whatever the ceiling turns out to be.

The cost is named: on a stream where one passage reaches above the corner's start, the junk-filter recommendation is withheld until the rate changes. That is a missed benefit, and the `hires` filter the user holds does no harm. Without track identity no reset is principled; a timer or a guess would be hysteresis, and there is none.

## The note

The note has three states: recommend engaging, recommend disengaging, silent. Silent leaves the user's setting alone.

**Engage** only on conclusive evidence of one junk type inside the window, with the detectors in agreement. The note goes quiet under treatment: the engaged setting's roll-off start at or below the recommended corner, or any rate-relative setting, or a `hires` filter for junk within the music.

**Disengage** only on positive evidence that the junk the filter treats is gone, read where that junk would show, or that the filter is cutting real content. Each type shows under its own conditions, and each has its own visibility rule.

| Type | Where it shows | Disengage evidence | Says nothing |
|---|---|---|---|
| Spur | Quiet passages; loud music masks it | A quiet window whose local baseline around the held bin sits at or below the baseline at engage, and no excess at that bin | Loud passages, fades, digital silence |
| Rising HF noise | Quiet passages; loud music reaches into the band | A quiet window where the top band reads flat or falling; or the content ceiling reaching the engaged setting's roll-off start | Loud passages, fades, digital silence |
| Fake hi-res | Loud passages; images follow the music | Loud frames with no wall at 20 to 24.5 kHz and real content above the fold; or the content ceiling reaching the engaged setting's roll-off start | Quiet frames, fades, digital silence |

Junk that merely does not show is not evidence. A fade or a silence between tracks says nothing, because junk leaves with the music and returns with it. A sample-rate change empties the window: the note is withdrawn and the setting is left alone.

## Agreement across detectors

No single statistic is certain. The note shows only when independent readings agree that the junk is there; one dissenting reading withholds it. Readings are combined by agreement, never by taking the larger of two.

| Type | Readings that must agree |
|---|---|
| Fake hi-res | The wall at 20 to 24.5 kHz on the running curve; the step at the source fold; the content edge read as the highest bin whose frame-to-frame variation follows the music, which on a 1x upsample sits at 20 to 22 kHz in every loud window whatever the wall's steepness; images, read as mirror correlation across the fold. A mirror reading calls fake and its absence calls nothing. A spur never vetoes fake hi-res. |
| Spur | Excess over the local baseline on the window minimum; persistence of the same bin across the window; the partner test, which classes a tone against an image and vetoes nothing. |
| Rising HF noise | The slope rank of the top band; the content ceiling against the band where the floor rises. |

## Time budget by type

| Type | Expected time-to-note | What the budget is spent on |
|---|---|---|
| Fake hi-res, every wall shape | Seconds | Nothing; a fake album that needs more than about 5 s is a miss to explain |
| Spur | Up to the full window | Seeing the content, not the tone |
| Rising HF noise | Seconds for the signature; up to the full window for the corner | Seeing the content |

## Grading

**Ground truth** is the owner's label per album, from knowledge of the master, in the filter-named scheme: the target setting alone, `20K`, `30K`, `40K`, `50K`, `2X`, `4X`, `8X`, `OFF`, `SKIP`, with a column for where the content stops and a column for what sits above it. A spectrum rule is never the answer key.

**Offline spectra from the source files.** Labeled albums are decoded from their FLAC files and transformed at the wire's geometry: 1025 bins and a hop of about one frame per 94th of a second at the source rate, channels summed, dB per frame. Whole tracks and whole albums are read, and albums are concatenated into streams with real fades for the stream grades below.

**Parity against the wire.** The raw metering bursts held under `/srv/hqptuner/state/junkburst/` join to a track and an offset, and the same span computed offline is compared per bin. A rule that passes offline and fails parity does not ship.

**Measures**, each per type:

- Junk caught at the zero-real-called-junk cut, leave-one-album-out.
- Time-to-note per album against the 45 s limit.
- False engage recommendations per hour of real content on the concatenated streams.
- False disengage recommendations during fades, and time-to-disengage after clean content arrives.

## Note catalog

The copy below is the owner's, verbatim. Placeholders in braces are filled by the engine. The engine supplies, per type: the wall, tone or ramp frequency, what sits above the content, how long the evidence has held, which setting and why that corner.

**Fake hi-res, 1x source**

> This content has been identified as fake hi-res, or 1x content forced into an Nx container through upsampling. Recommend engaging the 20k HF Filter to cut noise and restore time-domain accuracy.

> Reason: {images,lack of content,brickwall} found above {cutoff} kHz.

**Fake hi-res, Nx source in a higher container**

> This content has been identified as upsampled: {source} kHz content forced into a {container} kHz container. Recommend engaging the {2x,4x,8x} HF Filter, which cuts at the source rate.

> Reason: {images,lack of content,brickwall} found above {cutoff} kHz, the Nyquist of a {source} kHz source.

**Spurs, all above the music**

> This content has {a spur|spurs}, or steady ultrasonic tones like from a SMPS, in the recording above the music. Recommend engaging the {junk}k HF Filter to cut {it|them}.

> Reason: {Tone|Tones} at {freq, freq, ...} kHz; content only reaches up to {freq} kHz, so cutting {it|them} with the junk filter is safe.

**Spurs, all within the music**

> This content has {a spur|spurs}, or steady ultrasonic tones like from a SMPS, in the recording riding within the music. Recommend engaging one of the `hires` filters in the Nx slot to mitigate {its|their} effects.

> Reason: {Tone|Tones} at {freq, freq, ...} kHz steady over {time} seconds, but content reaches up to {freq} kHz. Engaging the {junkfilter}k junk filter would cut real content.

**Spurs, some within and some above the music**

> This content has spurs, or steady ultrasonic tones like from a SMPS, in the recording, some riding within the music and some above it. Recommend engaging the {junk}k HF Filter to cut the tones above the music, and one of the `hires` filters in the Nx slot to mitigate the rest.

> Reason: Tones at {freq, freq, ...} kHz above the content, which reaches up to {freq} kHz; tones at {freq, ...} kHz within it, where no junk filter reaches without cutting real content.

**Rising HF noise above the music**

> This content has rising HF noise, e.g., from excessive noise shaping or DSD transfers, above the music. Recommend engaging the {junk}k HF Filter to cut it before it reaches the DAC.

> Reason: Noise floor rising from {freq} kHz to the top of the band; content only reaches up to {freq} kHz, so cutting it is safe.

**Rising HF noise within the music**

> This content has rising HF noise, e.g., from excessive noise shaping or DSD transfers, reaching into the music. No HF Filter cuts it without cutting real content; the slow roll-off of a `hires` filter in the Nx slot is the mitigation.

> Reason: Noise floor rising from {freq} kHz; content reaches up to {freq} kHz.

**Fake hi-res with a spur**

> This content has been identified as fake hi-res, or 1x content forced into an Nx container through upsampling, and it also carries {a spur|spurs}, or steady ultrasonic tones like from a SMPS. Recommend engaging the 20k HF Filter, which cuts both.

> Reason: {images,lack of content,brickwall} found above {cutoff} kHz; {tone|tones} at {freq, ...} kHz above that.

**Fake hi-res with rising HF noise**

> This content has been identified as fake hi-res, or 1x content forced into an Nx container through upsampling, and it also carries rising HF noise, e.g., from excessive noise shaping or DSD transfers. Recommend engaging the 20k HF Filter, which cuts both.

> Reason: {images,lack of content,brickwall} found above {cutoff} kHz; noise floor rising from {freq} kHz above that.

**Spurs with rising HF noise, both above the music**

> This content has {a spur|spurs}, or steady ultrasonic tones like from a SMPS, and rising HF noise, e.g., from excessive noise shaping or DSD transfers, above the music. Recommend engaging the {junk}k HF Filter, which cuts both.

> Reason: {Tone|Tones} at {freq, ...} kHz and noise floor rising from {freq} kHz; content only reaches up to {freq} kHz, so cutting them is safe.

**Disengage, fake hi-res**

> Real content now plays above {cutoff} kHz, and the 20k HF Filter is cutting it. Recommend disengaging it.

> Reason: Content with no wall and no images reaching {freq} kHz over {time} seconds of loud passages.

**Disengage, spurs**

> The {tone|tones} the {junk}k HF Filter was engaged for {is|are} gone. Recommend disengaging it.

> Reason: No tone at {freq, ...} kHz over {time} seconds of quiet passages, where {it|they} would show.

**Disengage, rising HF noise**

> The rising HF noise the {junk}k HF Filter was engaged for is gone. Recommend disengaging it.

> Reason: Noise floor flat above {freq} kHz over {time} seconds of quiet passages, where it would show.

**Disengage, junk now within the music**

> The music in this content now reaches above the {junk}k HF Filter's passband, and the filter is cutting it. Recommend disengaging it and using one of the `hires` filters in the Nx slot instead.

> Reason: Content reaches {freq} kHz over {time} seconds; the {tone|noise} at {freq} kHz now sits within it.
