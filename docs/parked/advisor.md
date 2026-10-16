# Junk-filter advisor and auto-pilot (parked)

**A build constant keeps the advisor and auto-pilot off**: the metering reader, built whenever `HQPTUNER_METERING_ENABLED` is on, runs without the advisor, auto-pilot never starts, switching auto-pilot writes nothing, `/api/status` reports `advisor` false and auto-pilot off whatever its store holds, and the UI renders neither; every stored state stays where it is for the build that turns the constant back on.

## The advisor advises and never acts

The advisor classifies the playing track's spectrum and surfaces a note on the HF filter stage: its lamp blinks and its drawer pins the line under the head. The note has no apply button and no dismiss: the user acts or ignores it. Auto-pilot is the one thing that acts on it.

Detection and treatment are separate and the caller combines them: the note goes quiet under treatment, while auto-pilot needs the untreated signature to know what to engage and what to let go of. The note clears once the engaged junk filter treats it (corner at or below the recommended one, or any rate-relative choice); `none` never clears it. Rate-relative filters (2x/4x/8x) are never recommended.

Each verdict holds differently:

- **Ramp**: a property of the spectrum in front of the rules, recomputed as each block closes and held by nothing, so the note clears at the first closed block whose minimum stops carrying the signature.
- **20k**: a run over closed block readings, engaging on the second block that reads junk within three blocks of the first, standing through blocks that read nothing at all, and clearing on the first block that reads real.
- **Spur**: held per bin, each bin engaging when its excess over the local baseline crosses the engage split and releasing once that excess falls under the lower release split or the bin stops standing clear of the floor, so a loud passage that lifts the baseline over a tone does not drop the advice and bring it back.

Where more than one rule fires, the lowest corner wins, among the held spur bins too. The hold has no track boundary of its own: a held bin releases when the rules stop seeing it, not when the track changes, and the aggregate behind it is rebuilt only when the frame geometry changes or the stream breaks.

## Auto-pilot is the advisor's write path, off by default

With it on, auto-pilot moves the junk filter to what the playing track's signature asks for and back again. It is a **background task of its own**, started by the lifespan beside the metering reader whose verdict it acts on, and only where that reader is, so `HQPTUNER_METERING_ENABLED=0` means auto-pilot never runs. It is not a route: `GET /api/status` only fires while a browser is open, and auto-pilot has to keep working for someone who is only listening. Its cadence follows the status poll, because everything the decision reads is refreshed by it. The switch grays when the metering reader is off.

**Auto-pilot's resting state is nothing engaged, and it stores no baseline.** The junk filter is a corrective rather than a preference, so with auto-pilot on it is engaged for the signature that calls for it and released the moment that signature clears; a filter that happened to be engaged when the switch was flipped is released too, rate-relative filters included.

The one thing that stays its hand is treatment: a spur verdict is also treated by a main filter from one of its families, so switching to a hires filter drops the junk filter and switching away brings it back. Auto-pilot engages as soon as the stream carries a signature it can read, and follows each verdict's hold as the advisor defines it.

**Setting the junk filter by hand switches auto-pilot off** (`POST /api/config/live` carrying `junk_filter`): the user taking the control back, before the write rather than after, so no poll can revert the choice they just made, and the only way to hold a filter of one's own. The write is the ordinary live lane, readback-verified and audited like any other; it costs the stream nothing.
