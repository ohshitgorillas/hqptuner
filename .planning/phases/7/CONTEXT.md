# Phase 7: Visuals stay in sync after a track starts - Context

Gathered: 2026-11-13

Feeds: /cad-plan 7

## Scope boundary

In: a read-only live capture off port 4322 that confirms or refutes the opening-rush cause and the reader-connect-timing cause at a same-rate track change and a rate change, at two sample rates; the owner's ruling on how the playhead's lag is set after a start, written into `docs/spec/timing.md`; the fix to the one playhead so its lag after a start matches its lag later in the track, at every rate and wherever the reader connected.

Out: per-view corrections for meters, spectrum, spectrogram or the apodizing strip; per-rate delay offsets; any write or transport command against hqplayerd; any measurement of HQPlayer's filter design; the repo-root `spectstutter.json` and `fuckedspecrogram.jpg` (owner: for issues already dealt with).

Deferred: None

Plan shape: multiple plans (owner: big, planning splits the work into several plans inside this phase; measure, then the owner's ruling, then the fix).

## Durable decisions

- D-01 (gate on the fix): the playhead's lag is set once, at the first paint after a restart, to the newest frame end less the delay, and moves only on wall `dt` after that; any correction after the anchor changes the owner's v2.0.0 D-01 rule ("wall speed, arrivals do not steer it; drift and stall handling only if a measurement shows them needed"), so no fix is planned until the live capture (AC1) is in and the owner has ruled, and the ruling lands in `docs/spec/timing.md` ("The two clocks", Rule 1) with the decision in the commit. Evidence: `hqptuner/static/model/gauges/playhead.js:99-123`, `hqptuner/static/store/meter/loop.js:118-130,191-203`, `docs/spec/timing.md:29,37`, `.planning/_archive-v2.0.0/5/CONTEXT.md:19`.
- D-02 (what the fix must deliver): the lag after a start is the same at every sample rate and does not depend on when the server's reader or the browser loop connected; it comes from the one shared playhead, never from per-rate offsets or a per-view correction. Both candidate causes, the opening rush and poll-phase connect timing, are measured and fixed. Evidence: owner answer 2026-11-13; `hqptuner/static/store/meter/delay.js:320-327`, `hqptuner/static/store/meter/playhead.js`, `hqptuner/static/store/meter/spectrogram.js:187,196`, `hqptuner/static/store/apodhistory.js:180`, `docs/spec/timing.md:39`, `hqptuner/engine/metering.py:45,252-265`, `hqptuner/config.py:129-132`.

## Decisions

- D-03 (stamps): frame stamps are a server-side count of metered samples from the moment the reader opened port 4322 (`_fed += bins - 1`, reset on connect), not the engine's playback position; stamp 0 is the connect moment. Evidence: `hqptuner/engine/meterfeed.py:197-222`, `hqptuner/engine/metering.py:40,278-279`, `docs/spec/protocol.md:403-406`.
- D-04 (restarts): the anchor restarts on the browser loop starting, a server reconnect (State leaves playing, a subscriber comes or goes), a geometry change (every rate change), and a dropped event (`QUEUE_DEPTH = 8`, partial stride); a gapless same-rate track change restarts nothing as far as the code shows, and the capture measures whether every track start re-anchors. Evidence: `hqptuner/static/store/meter/feed.js:108-121`, `hqptuner/engine/meterfeed.py:83,111-113,203-230`, `hqptuner/engine/metering.py:243-297`, `hqptuner/static/store/meter/loop.js:229-258`; owner answer 2026-11-13 ("don't know, measure it").
- D-05 (capture): a new direct capture off port 4322, run by the `meter-probe` agent, records each frame's arrival wall time next to its `at`/`n` stamps, the geometry events, and Status position, track serial and `output_delay` sampled across the window; it starts before a track starts and covers a same-rate change and a rate change at two rates, with the owner starting the tracks. It writes nothing to the daemon, so no idle gate applies; it is wire-protocol measurement under the probing rule. The existing `scripts/probes/capture_meter_feed.py` (through `:8090`, after the container's reader connects, `output_delay` read once) and `scripts/probes/probe_metering_stream.py` (no per-frame arrival times) are not used as they stand. Evidence: owner answer 2026-11-13; `scripts/probes/capture_meter_feed.py:1-23,48-58,108-120`, `scripts/probes/probe_metering_stream.py:1-75`, `.claude/agents/meter-probe.md:16-36`.
- D-06 (tests pinning today's behavior): a fix that moves the anchor or adds a correction rewrites these, each rewrite red against the old code: `tests/js/model/gauges/playhead.test.js:477,593-599,609,630,680` and `tests/js/store/meter/loop.test.js:166`; no test covers a feed that starts faster than real time. Evidence: those files; `docs/spec/testing.md` rule 8.
- D-07 (nothing closes lag today): the v2.0.0 UAT line "playhead closes lag after a long burst gap" tested the target-tracking design that `c89ed07a` deleted with `CATCH_UP_MS`; the PROJECT.md key decision "capped at the newest stamp less the delay" is stale the same way, since the cap is now the newest end. Evidence: `.planning/_archive-v2.0.0/5/UAT.md:11-17`, `hqptuner/static/model/gauges/playhead.js:5-11`, `.planning/PROJECT.md:76`.

## Acceptance criteria

- [ ] AC1: A read-only capture off port 4322 is saved that starts before a track starts and covers a same-rate track change and a rate change at two sample rates, holding per-frame arrival times, stamps, geometry events, and Status position, track serial and `output_delay` sampled across the window; its report states whether the stamps run ahead of wall time after a start, for how long at each rate, and whether each kind of track change restarts the stream. (human-verify: needs owner starting tracks on live hqplayerd)
- [ ] AC2: `docs/spec/timing.md` states the owner-approved rule for how the lag is set after a start, and the commit changing it cites the AC1 report; if the capture refutes the rush, the report says so and no anchor fix lands this phase.
- [ ] AC3: In a test replaying a captured track start, the playhead's lag behind the sound after the opening stretch is within one metering frame of its lag later in the same track.
- [ ] AC4: Replays of captured starts at two sample rates give lags within one metering frame of each other.
- [ ] AC5: Replays where the reader connects at different points in the opening stretch give lags within one metering frame of each other.
- [ ] AC6: At the hand-back URL, with tracks at two sample rates, the visuals hold the same lag behind the sound right after a track starts as later in the track. (human-verify: needs owner's eyes and ears)
- [ ] AC7: `scripts/gate.sh make check` prints `exit=0`.

## Flagged assumptions

- Part of the rate dependence may sit in `output_delay` itself mis-reporting per rate rather than in the anchor timing - Likely not; if wrong: an anchor-only fix leaves a per-rate residue, which AC4 and AC6 catch.
- Re-anchoring during the rush may come mostly from queue-overflow breaks (`QUEUE_DEPTH = 8`) rather than the geometry break - Unclear; if wrong: the fix's trigger set is wrong; AC1's capture shows which.
- Where hqplayerd taps metering relative to output, and whether it runs faster than real time at a start - unresearched, no repo doc; the live capture and the hqpdoc tools answer it.
- What Status `position` and `output_delay` mean (heard or processed position; whether `output_delay` holds steady across a start) - unresearched; `docs/spec/protocol.md:299-300` lists the fields without semantics.
- Phase 7 serves no requirement ID in `REQUIREMENTS.md` - Confident; if wrong: `/cad-audit` finds an orphan.
