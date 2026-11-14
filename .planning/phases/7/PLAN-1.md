---
phase: 7
plan: 1
requirements: []
files:
  - scripts/probes/meter/capture_meter_start.py
  - tests/support/fixtures/meter_start_capture.json
  - .planning/phases/7/CAPTURE.md
---

# Phase 7: Visuals stay in sync after a track starts - Plan 1: Measure a track start off port 4322

## Goal

After a track starts, the visuals keep the same lag behind the sound that they hold for the rest of the track, whatever the track's sample rate. This plan supplies success criterion 3: the cause is confirmed or refuted on the live system before any fix is planned against it.

## Must be true when done

- A read-only capture taken straight off port 4322 is saved in the repo. It starts before a track starts, and it covers a start from stopped, a same-rate track change and a rate change, at two sample rates.
- For every metering frame, the capture holds its arrival wall time beside its stamp. It also holds every geometry change, every connect and stream end, and Status position, track serial and `output_delay` sampled across the window.
- A report states, from the capture, two things. First, whether the stamps run ahead of wall time after a start, and for how long at each rate. Second, whether each kind of track change restarts the stream.
- Nothing was written to hqplayerd, and no transport command was sent.

## Context

- D-05 binds the capture. It is new, direct off `127.0.0.1:4322`, and run by the `meter-probe` agent. The owner starts the tracks. The capture writes nothing to the daemon, so no idle gate applies. `scripts/probes/capture_meter_feed.py` and `scripts/probes/probe_metering_stream.py` are not used as they stand.
- D-03: a stamp counts metered samples from the moment the reader opened 4322, and stamp 0 is the connect moment. D-04: the capture measures whether every track start re-anchors. D-02: the opening rush and poll-phase connect timing are both measured.
- Out of scope: any write or transport command to hqplayerd, any measurement of HQPlayer's filter design, and the repo-root `spectstutter.json` and `fuckedspecrogram.jpg`.
- The probing rule (`hqptuner2/CLAUDE.md`): frame arrival times, stamps and Status fields are wire-protocol behavior and fair to measure. No filter parameter is measured, inferred or plotted.

## Tasks

### Task 1: A direct start-capture probe for port 4322

- **Files:** scripts/probes/meter/capture_meter_start.py
- **Reads:** scripts/junkcal/junkcal_burst.py#main, hqptuner/engine/meterfeed.py#MeterFeed, hqptuner/engine/meterfeed.py#reduce_frame, hqptuner/engine/metering.py#HEADER, hqptuner/engine/control.py#ControlClient.get_status, scripts/probes/capture_meter_feed.py#capture
- **Decisions:** D-03, D-05
- **Action:** Write a read-only probe script that connects straight to the metering port at `127.0.0.1:4322`. The connection is a bare TCP connect with no control-channel command, the same way `scripts/probes/probe_metering_stream.py` and `scripts/junkcal/junkcal_burst.py` connect.
  - **Per-frame record.** Read frames using the header struct and the payload sizing those scripts use: `HEADER`, `MAX_CHANNELS` and `MAX_BINS` from `hqptuner/engine/metering.py`. For every frame, record its arrival time and the count of metered samples since this connection opened, `bins - 1` per frame (D-03). Also record the frame's header geometry: channels, bins, bandwidth and transform time.
  - **Feed events.** Pass each frame through the repo's own `reduce_frame` and `MeterFeed` from `hqptuner/engine/meterfeed.py`, on a subscriber the script attaches and drains itself. Record every `geometry` and `frame` event `MeterFeed` emits, with the arrival time of the frame that completed it. For `frame` events, keep only `at` and `n` and drop the channel bins, because the timing alone is the payload and the bins would multiply the file size. This makes the capture's event stamps the ones a page gets, with no second stride implementation.
  - **Connects and stream ends.** Record every connect, end of stream and refused connect with its time. After a stream ends or a connect is refused, wait `RECONNECT_DELAY` from `hqptuner/engine/metering.py` before the next connect, the same backoff the repo's reader uses, so the probe never loops connects against the production daemon. Call `MeterFeed.reset` on each connect, as the reader in `hqptuner/engine/metering.py` does. The script never holds more than one connection to 4322 at a time.
  - **Status samples.** Throughout the run, sample Status through `ControlClient.get_status` in `hqptuner/engine/control.py`, built the way `junkcal_burst.py` builds it from `Config`. Record each sample with its time and the status attributes as the read returns them, including `position`, `track_serial`, `output_delay` and `state`. Also record the metadata `samplerate`. Use a named sampling interval of no less than 200 ms, so the probe adds little load to the production daemon. This choice is the planner's discretion: 200 ms is five times the app's own 1 s status cadence, and it bounds how precisely a start can be timed. No other control command is sent.
  - **Time base.** All times are wall ms from the run's start on one monotonic clock.
  - **Two connect modes, chosen on the command line.** In the first mode, the probe connects at once and holds the connection through whatever starts the owner makes. In the second mode, it holds no connection until Status shows a start: `state` turns to playing, or `track_serial` changes while playing. It then connects a given number of seconds after that Status sample. The second mode is the planner's discretion: D-02 requires the connect-timing cause to be measured, and only a late connect shows what a late reader receives.
  - **Output.** The run window is a command-line argument in seconds. The output path is an argument that defaults under `tempfile.gettempdir()`, as the other probes do. Each run is appended to that file's list of runs, so several runs share one file. Each run carries its mode, its connect offset and its window. The spectrum offset the owner's page shows is a required command-line argument in seconds, recorded as `owner_spectrum_offset_s`, as `scripts/probes/capture_meter_feed.py` takes it, so a replay can run at the page's effective delay.
  - **Constraints.** Follow the docstring and usage style of the existing probes. The script must pass ruff, black and strict mypy, which cover `scripts/`. Do not import a `_private` name from `hqptuner`. Do not name a filter or measure anything about one.
- **Verify:** `scripts/gate.sh make lint` prints `exit=0`. `.venv/bin/python scripts/probes/meter/capture_meter_start.py` with no arguments exits non-zero and prints the usage, connecting to nothing. Testing scope: this is a measurement tool outside `hqptuner/`, so it gets no unit tests. Its stamps come from `MeterFeed`, which `tests/engine` already covers, and its read path follows the probes that were confirmed live. The live run in Task 2 is the evidence that it reads correctly, and testing stops there.

### Task 2: Capture track starts on the live engine and save the capture as a fixture

- **Files:** tests/support/fixtures/meter_start_capture.json
- **Reads:** .claude/agents/meter-probe.md, scripts/probes/meter/capture_meter_start.py
- **Decisions:** D-02, D-04, D-05
- **Action:** The `meter-probe` agent runs the Task 1 script while the owner starts the tracks. The executor never sends transport, and nothing writes to hqplayerd.
  - **The brief.** Brief `meter-probe` with the bare measurement question and the commands, nothing more. Example question: "at what wall time does each metering frame arrive beside its stamp, across these starts, with Status sampled". The brief must not state a cause, a hypothesis or an expected result. The agent refuses a steering brief with `REJECTED: STEERING`, and a refused agent is retired, so a rejected brief goes bare to a fresh one.
  - **Run 1 (held connection).** One run in the held mode, started before any of the starts. It covers: a start from stopped at a first sample rate; a same-rate track change at that rate; a rate change to a second sample rate; and a same-rate track change at the second rate. The owner chooses the tracks and how each change is made, and the run records the owner's account of each change. Let each start run long enough that the frames reach steady wall-rate arrival afterward, so a later stretch of the same track is in the capture.
  - **Late-connect runs: cut by the owner.** The owner declined them on 2026-11-13. The capture is Run 1 alone, and the late-connect measurement is an open item.
  - **Window and footprint.** Each run goes under `timeout`. Run 1 covers four starts, each followed by a steady stretch, and 60 s cannot hold them. Before Run 1, ask the owner for a window sized to the four starts (for example 180 to 300 s); that is an authorization ask naming what it blocks. Other runs use 60 s unless the owner grants longer. Before each run, meter-probe records whether a `junkcal_burst.py` process and the dev container's own metering connection are present (`ps`, and `ss -tn` on port 4322). meter-probe reports its PIDs killed by PID and confirmed gone with `ps -p`.
  - **Save.** Copy the resulting runs file from scratch into the fixture path as captured, with no edits, trims or reordering. A capture that misses a required start is rerun; it is not patched.
- **Verify:** human-verify. This needs the owner starting tracks on the live hqplayerd while meter-probe runs the capture. Afterwards, `.venv/bin/python -c` reading the fixture as JSON shows:
  - one held-mode run with frame records at two distinct metering rates;
  - at least one geometry change between them;
  - Status samples whose `track_serial` takes at least four values.

  meter-probe's report shows no command other than reads, and every PID it launched gone.

### Task 3: Report what the capture shows about a track start

- **Files:** .planning/phases/7/CAPTURE.md
- **Reads:** tests/support/fixtures/meter_start_capture.json, .planning/phases/7/CONTEXT.md, docs/spec/protocol.md
- **Decisions:** D-02, D-03, D-04, D-05
- **Action:** Write the AC1 report from the fixture's numbers, using `Write`, soft-wrapped, with no em dashes. For each start in the capture, state:
  - **Stamp lead over wall time.** Whether the stamps run ahead of wall time after the start, measured as the stamps' playback ms against the arrival wall ms. If they do, state by how much, for how long, and at which metering rate.
  - **Steady stretch.** The lead or lag in a later steady stretch of the same track.
  - **What the change does to the stream.** Whether that kind of change ends the stream, emits a geometry event or breaks the stamps (an `at` that is not the previous `at + n`). This is D-04's question: does every track start re-anchor?
  - **Status fields.** What Status `position` and `output_delay` did across the start, and `output_delay` at each rate. This covers the flagged assumption that `output_delay` may misreport per rate.

  Also give the peak event arrival rate during any rush against `QUEUE_DEPTH` 8 in `hqptuner/engine/meterfeed.py`. This bears on the flagged assumption about queue-overflow breaks.

  For what Status `position` and `output_delay` mean, and where hqplayerd taps metering, cite HQPlayer's own docs through the hqpdoc MCP tools (`hqp_find` first). Where the docs are silent, write "undocumented".

  Each number carries the command that produced it from the fixture. The report states measurements and their plain reading against the two candidate causes, confirmed, refuted or mixed. It proposes no fix and no rule; the ruling is Plan 2's. Pass `.claude/hooks/md-softwrap.py --check` on the file.
- **Verify:** `.planning/phases/7/CAPTURE.md` names, for each of the two rates, a stamp lead over wall time after a start (a number, or "none" with its measurement). It names, for each kind of change captured, whether the stream restarted. Every number in it is reproduced by the command it cites, run against the fixture. Testing scope: none; this is a measurement record.

## Notes

- Plan shape: CONTEXT orders measure, then ruling, then fix. This plan is the measurement. Plan 2 (the ruling) and Plan 3 (the fix) depend on it in sequence.
- The late-connect runs were the planner's reading of D-02: "connect timing measured" needs a reader that connects after a start. The owner cut them, so D-02's connect-timing half stays unmeasured and is an open item.
- The owner's presence is required for Task 2. Run 1 needs a window longer than 60 s for its four starts, so the executor asks the owner for that window before Run 1.
