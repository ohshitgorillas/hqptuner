---
phase: 7
plan: 17
requirements: []
files:
  - hqptuner/engine/metering.py
  - tests/engine/test_metering_frame.py
  - scripts/junkcal/junkcal_burst.py
  - scripts/probes/probe_metering_stream.py
  - scripts/junkburst/jbconfig.py
  - scripts/junkburst/jbunpack.py
  - tests/support/fake_metering.py
  - tests/api/test_meter_feed_route.py
  - tests/engine/test_meterfeed.py
  - tests/e2e/test_playing_readings_keep_flowing.py
  - tests/e2e/test_spectrogram_header_no_scroll_bar_at_quarter_span.py
  - scripts/probes/kit/probekit.py
  - scripts/probes/gen_kaiser_oracle.py
  - scripts/sweep.py
  - scripts/probes/restore_pristine.py
  - scripts/probes/probe_switch_post_effect.py
  - scripts/probes/probe_cleanup_profiles.py
  - scripts/probes/probe_post_reassert.py
  - scripts/probes/probe_daemon_save_post.py
  - scripts/probes/probe_iir_q.py
  - scripts/probes/probe_profile_post_process.py
  - scripts/probes/absent_plugin/probe_absent_plugin.py
  - tests/support/wave.py
  - tests/conftest.py
  - tests/presets/test_filter_park.py
  - tests/e2e/test_pipelines_filter_upload.py
---

# Phase 7: One time base - Plan 17: The last repeats live once

## Goal

The app keeps time on one time base, and duplicated code is not allowed anywhere: wherever two places derive the same value, both use one shared structure. This plan closes UAT item 12, the repeats under jscpd's 50-token floor.

## Must be true when done

- The junkcal burst capture reads a metering frame, refuses an implausible header and lets go of a pending read through the engine's own code, and still stores each frame's header and body bytes exactly as the daemon sent them.
- The metering frame's wire layout (the header struct and the payload sizing) has one home in production code, `hqptuner/engine/metering.py`, and every script that reads frames takes it from there.
- The tests' metering frames are packed in one place, `tests/support/fake_metering.py`, independent of the engine's own struct.
- One `CliError` class and one runner that turns it into a printed reason and exit code 1 serve every script that had its own.
- The tests' WAVE containers are built in one place under `tests/support/`, and every test that needs one builds it there.

## Context

- D-03 binds every task: all unjustified repeats go, in production code, tests and scripts. Item 12's verifier named `junkcal_burst.py` `_read_frame`, `gen_kaiser_oracle.py`'s `CliError` and synchronous `main()`, and `sweep.py`'s `CliError`. Tasks 3 and 4 are same-cause instances found while verifying those lines (`~/dev/CLAUDE.md` 10.2): the header struct `"<4I3fI"` is defined in five places and the frame packing in five more.
- Sharing the frame read changes production engine code, a testing strong area (`hqptuner/engine/`). Tests-first, with a red run as the bite proof (`docs/spec/testing.md` rule 8).
- No task runs anything against hqplayerd. `junkcal_burst.py`, `probe_metering_stream.py capture` and the eight probes all talk to the live daemon; they are checked by lint, import and offline runs only.
- Python layering holds: scripts import `hqptuner.engine`, never the reverse.

## Tasks

### Task 1: The engine's frame read hands back the header bytes as they arrived

- **Files:** hqptuner/engine/metering.py, tests/engine/test_metering_frame.py
- **Reads:** hqptuner/engine/metering.py#read_frame, hqptuner/engine/metering.py#_discard, hqptuner/engine/metering.py#MeteringReader, scripts/junkcal/junkcal_burst.py#BurstReader, scripts/probes/meter/capture_meter_start.py
- **Decisions:** D-03
- **Pins:** tests/api/test_metering_dial.py, tests/engine/test_metering_dial_deadline.py, tests/api/test_meter_feed_route.py, tests/core/test_junkcal.py, tests/api/test_junk_verdict_timing.py
- **Action:** `hqptuner/engine/metering.py` gains the one frame read that both `MeteringReader` and the burst capture need. It reads the fixed `HEADER`, refuses a channel or bin count outside `MAX_CHANNELS` and `MAX_BINS` with `ImplausibleMeteringHeaderError`, reads `channels * (16 + 8 * bins)` payload bytes, and hands back the header bytes it read beside the unpacked header and the body. `read_frame` keeps its signature and return value and reads through it, so its callers (`MeteringReader._stream` and `scripts/probes/meter/capture_meter_start.py`) do not change. The payload sizing from a channel and bin count is written once and is importable by scripts, since Task 3's probe needs a frame's byte length from those two counts. The cancel-and-collect of a pending read in `_discard` is what the burst capture repeats, so it becomes importable too: ruff's `PLC2701` refuses an import of another module's private name, so it loses its leading underscore, and its type accepts the burst's pending read as well as the reader's under strict mypy. Caller-side delta: one call site changes, the `_discard` call in `MeteringReader._stream`; `read_frame` has zero. The raw header must be the bytes read, never `HEADER.pack(*header)`: a float32 field does not always survive a round trip through a Python float, and the burst file promises the daemon's bytes. Write the tests first. The test writer picks the unit, the inputs and the values.
- **Verify:** Testing scope: the outcomes are (a) a frame read hands back the header bytes it was sent, byte for byte, with the body sized from that header's channels and bins, and (b) a header whose channel or bin count is out of range is refused with `ImplausibleMeteringHeaderError`. Neither is tested today: `grep -rn "Implausible" tests` prints nothing. The smallest check is one case per outcome at the engine lane over a real `asyncio.StreamReader` fed bytes. Existing callers of `read_frame` are pinned by the Pins suites. Testing stops there. (1) Red run: the new cases fail against `metering.py` as at HEAD. (2) After the change, `scripts/gate.sh .venv/bin/pytest tests/engine/test_metering_frame.py tests/api/test_metering_dial.py tests/engine/test_metering_dial_deadline.py tests/api/test_meter_feed_route.py tests/core/test_junkcal.py tests/api/test_junk_verdict_timing.py -q` passes. (3) `grep -n "def _discard" hqptuner/engine/metering.py` prints nothing. (4) `scripts/gate.sh make lint` passes.

### Task 2: The burst capture reads and lets go of frames through the engine

- **Files:** scripts/junkcal/junkcal_burst.py
- **Reads:** scripts/junkcal/junkcal_burst.py#BurstReader, scripts/junkcal/junkcal_burst.py#ImplausibleMeteringHeaderError, hqptuner/engine/metering.py#read_frame
- **Decisions:** D-03
- **Action:** `BurstReader` drops its own `_read_frame` and its own `ImplausibleMeteringHeaderError` and reads each frame through Task 1's engine read, storing the raw header bytes it hands back. The cancel-and-collect block in `BurstReader.capture` calls the engine's discard from Task 1. The module docstring and the `_read_frame` docstring name `MeteringReader._read_frame`, which does not exist; the module docstring names the engine function instead. The `body_layout` string written into each burst file stays as it is: it is a field of the file format, not a derivation. Caller-side delta: one call site, in `capture`, plus the one discard.
- **Verify:** Testing scope: no behavior change. The raw-bytes outcome is pinned at the engine lane by Task 1. `capture` runs on the wall clock against the live daemon, so it gets no test here (`docs/spec/testing.md` rule 7), and the script is not run. Testing stops there. (1) `grep -nE "class ImplausibleMeteringHeaderError|def _read_frame|self\._read_frame\(|readexactly\(|read\.cancel\(\)" scripts/junkcal/junkcal_burst.py` prints nothing. The pattern matches code only: the docstrings that name `readexactly` and `MeteringReader._read_frame` in prose are not hits, and a docstring the change makes untrue is corrected in the same edit. (2) `PYTHONPATH=scripts/junkcal .venv/bin/python -c "import junkcal_burst"` exits 0. (3) `scripts/gate.sh make lint` passes.

### Task 3: The metering probe and the junk-burst tools take the frame layout from the engine

- **Files:** scripts/probes/probe_metering_stream.py, scripts/junkburst/jbconfig.py, scripts/junkburst/jbunpack.py
- **Reads:** scripts/probes/probe_metering_stream.py#capture_main, scripts/probes/probe_metering_stream.py#analyze_main, scripts/junkburst/jbconfig.py, scripts/junkburst/jbunpack.py
- **Decisions:** D-03
- **Action:** `probe_metering_stream.py` and `jbconfig.py` each define `HEADER = struct.Struct("<4I3fI")`, a copy of `hqptuner.engine.metering.HEADER`. Both drop it. `jbunpack.py`, the one importer of `jbconfig.HEADER`, imports the engine's `HEADER` directly, so no forwarder is left in `jbconfig.py`. The probe's two frame-length computations, in `capture_main` and `analyze_main`, read `32 + channels * (16 + 8 * bins)`: they become `HEADER.size` plus Task 1's payload sizing. A fifth site in `analyze_main` carries the same layout: `base = i * frame + 32 + 16`, the header size and one channel's level block. It takes the header size from `HEADER.size`, and the level block's size from the engine's own home for it, made importable in Task 1 beside the payload sizing if it has no importable name today (then `hqptuner/engine/metering.py` is edited there, under Task 1's tests-first rule, not here). Printed output and arithmetic stay the same. Caller-side delta: three files, five sites.
- **Verify:** Testing scope: no behavior change; no test exists for either script; the check is that the probe's offline mode prints the same output and the junk-burst tools still import. Testing stops there. (1) `grep -rn 'Struct("<4I3fI")' scripts` prints nothing, and `grep -nE "\b32 \+" scripts/probes/probe_metering_stream.py` prints nothing (at HEAD it prints lines 71, 102 and 111). (2) Write a synthetic capture of several stereo frames to a temp file with a scratch script (not committed). Run `.venv/bin/python scripts/probes/probe_metering_stream.py analyze <file>` with the probe as at HEAD and again after the change: the two outputs are byte-identical. The `capture` mode reads the live daemon and is not run. (3) `PYTHONPATH=scripts/junkburst .venv/bin/python -c "import jbunpack"` exits 0. (4) `scripts/gate.sh make lint` passes.

### Task 4: The tests' metering frames are packed in one place

- **Files:** tests/support/fake_metering.py, tests/api/test_meter_feed_route.py, tests/engine/test_meterfeed.py, tests/e2e/test_playing_readings_keep_flowing.py, tests/e2e/test_spectrogram_header_no_scroll_bar_at_quarter_span.py
- **Reads:** tests/support/fake_metering.py#mono_frame, tests/api/test_meter_feed_route.py#_frame, tests/e2e/test_playing_readings_keep_flowing.py#_frame, tests/e2e/test_spectrogram_header_no_scroll_bar_at_quarter_span.py#_frame, tests/engine/test_meterfeed.py
- **Decisions:** D-03
- **Action:** `fake_metering.mono_frame` is the test home of the wire layout, and it packs one channel. Four other files pack frames themselves. `test_meter_feed_route._frame` and the two e2e `_frame` builders pack multi-channel frames and carry their own copies of the layout constants. `test_meterfeed.py` packs `"<4I3fI"` headers to get header tuples. One builder in `fake_metering.py` packs a frame for any channel count, and the four files use it. Whether `mono_frame` generalizes or calls the new builder is the executor's choice, but no second packing expression may remain. The layout constants used only to feed the builder move into it. The tests keep their wire layout independent of `hqptuner/engine/metering.py`: a fake that packs with production's own struct agrees with production when both are wrong (`docs/spec/testing.md` rule 13), so no test imports the engine's `HEADER`. Every frame each suite puts on the wire stays byte-identical, and no assertion and no expected value changes. The `test_meterfeed.py` module docstring says "Every case packs its own frames"; that stops being true here, so it is corrected in the same edit.
- **Verify:** Testing scope: no behavior change in any suite. The check is that each suite's frames are byte-identical and that its tests pass. Testing stops there. (1) `grep -rnE 'Struct\("<4I3fI"\)|struct\.pack\("<4I3fI"|= "<4I3fI"' tests` prints lines in `tests/support/fake_metering.py` only. At HEAD it prints five files. The pattern matches code only: the `struct.unpack("<4I3fI")` the `test_meterfeed.py` module docstring names in prose is not a hit. (2) A scratch script (not committed) prints the sha256 of every frame the five files build, once at HEAD and once after: the digests match. (3) `scripts/gate.sh .venv/bin/pytest tests/api/test_meter_feed_route.py tests/engine/test_meterfeed.py tests/core/test_junkcal.py tests/api/test_metering_dial.py tests/api/test_junk_verdict_timing.py tests/api/test_advisor_hidden.py -q` passes with the same test count as at HEAD. (4) `scripts/gate.sh .venv/bin/pytest -m e2e tests/e2e/test_playing_readings_keep_flowing.py tests/e2e/test_spectrogram_header_no_scroll_bar_at_quarter_span.py --no-cov -q` passes. Name the headless chromium and app subprocess before they run (`~/dev/CLAUDE.md` 3.1).

### Task 5: One CliError and one runner serve every script that stops cold

- **Files:** scripts/probes/kit/probekit.py, scripts/probes/gen_kaiser_oracle.py, scripts/sweep.py, scripts/probes/restore_pristine.py, scripts/probes/probe_switch_post_effect.py, scripts/probes/probe_cleanup_profiles.py, scripts/probes/probe_post_reassert.py, scripts/probes/probe_daemon_save_post.py, scripts/probes/probe_iir_q.py, scripts/probes/probe_profile_post_process.py, scripts/probes/absent_plugin/probe_absent_plugin.py
- **Reads:** scripts/probes/kit/probekit.py#CliError, scripts/probes/kit/probekit.py#run_cli, scripts/probes/gen_kaiser_oracle.py#main, scripts/sweep.py#CliError, scripts/sweep.py#main, scripts/probes/restore_pristine.py
- **Decisions:** D-03
- **Action:** Three `CliError` classes exist: `probekit.py`, `gen_kaiser_oracle.py` and `sweep.py`. There are also three copies of the catch-print-return-1 body: `probekit.run_cli`, `gen_kaiser_oracle.main` and `sweep.main`. `probekit.py` stays the one home for both, since eight probes already use its `CliError` and `run_cli`. `gen_kaiser_oracle.py` and `sweep.py` import from it the way the probes do, by putting `scripts/probes/kit` on `sys.path`. The catch-print-return-1 body is written once. `run_cli` awaits an async callable, while `gen_kaiser_oracle._run` and the body of `sweep.main` are synchronous. An `async def` with no `await` is refused by ruff's `RUF029`, so the sync scripts cannot simply become async. The executor shapes the one runner so that both kinds of caller go through it, for example a synchronous runner that the async probes hand their `asyncio.run` to. Every caller then follows that one shape. Caller-side delta: up to ten entry lines, the eight probes' `__main__` lines (only if the runner's call shape changes) plus the `main` of `gen_kaiser_oracle.py` and of `sweep.py`. Exit codes and printed messages stay as they are. `probekit` is the probe kit, so `sweep.py` importing it couples a UI sweep to it. That is the cost of one home without a forwarder.
- **Verify:** Testing scope: no behavior change; none of these scripts has a test, and the probes and the sweep reach the live daemon or a browser, so the check is the greps, an offline run of the generator and an import of every probe. Testing stops there. (1) `grep -rn "class CliError" scripts` prints one line, in `scripts/probes/kit/probekit.py`, and `grep -rn "errors: list\[CliError\]" scripts` prints one line, in the same file. At HEAD each prints three. (2) `.venv/bin/python scripts/probes/gen_kaiser_oracle.py <tmp path>` writes the same bytes as the HEAD version writes to another temp path. It is pure scipy and touches no daemon. (3) `.venv/bin/python scripts/sweep.py --help` exits 0. (4) Read each of the eight probes first and confirm it does no I/O at import. Then load each by path with `importlib.util.spec_from_file_location` under a module name other than `__main__`: each loads, so every `probekit` name it imports exists. Their `__main__` lines are not run. (5) `scripts/gate.sh make lint` passes.

### Task 6: The tests' WAVE containers are built in one place

- **Files:** tests/support/wave.py, tests/conftest.py, tests/presets/test_filter_park.py, tests/e2e/test_pipelines_filter_upload.py
- **Reads:** tests/conftest.py#minimal_wave, tests/presets/test_filter_park.py#_chunk, tests/presets/test_filter_park.py#_riff, tests/e2e/test_pipelines_filter_upload.py#_wav
- **Decisions:** D-03
- **Action:** A same-cause repeat the plan review found (`~/dev/CLAUDE.md` 10.2). Three test files build a RIFF/WAVE container by hand: `conftest.minimal_wave`, the chunk-by-chunk containers of `test_filter_park.py` (`_chunk`, `_riff` and the `FMT_*` payloads), and `_wav` in the e2e upload test. `tests/conftest.py:158` and `tests/presets/test_filter_park.py:77` hold the same expression, `struct.pack("<HHIIHH", 1, 1, 44100, 88200, 2, 16)`, and the e2e file packs the same `fmt ` payload from its own constants. One home, a new `tests/support/wave.py`, owns the `fmt ` payload packing and the chunk and form assembly, and the three files build through it. `test_filter_park.py` keeps saying which field of a container is wrong (zero channels, zero rate, a cut payload, a lying size field), because that is what its cases are about; only the packing and the assembly move. `minimal_wave` stays importable from where its five importers take it, with its signature unchanged, so no importer changes. The builder stays independent of `hqptuner/presets/store/filterpark.py` (`docs/spec/testing.md` rule 13). Every container each file builds stays byte-identical, and no assertion and no expected value changes. Caller-side delta: three files; `_chunk` and `_riff` leave `test_filter_park.py` and their call sites there name the shared home.
- **Verify:** Testing scope: no behavior change in any suite. The check is that each container is byte-identical and that the suites pass. Testing stops there. (1) `grep -rn '"<HHIIHH"' tests` prints lines in `tests/support/wave.py` only. At HEAD it prints three files. (2) A scratch script (not committed) prints the sha256 of `minimal_wave()` at its default and at one larger size, of every module-level container `test_filter_park.py` builds, and of the e2e file's `_wav(FRAMES)`, once at HEAD and once after: the digests match. (3) `scripts/gate.sh .venv/bin/pytest tests/presets/test_filter_park.py tests/presets/restore/test_restore_store_hooks.py tests/matrix/test_filter_upload.py tests/api/test_filter_upload_guards.py tests/api/test_api_config_ops.py -q` passes with the same test count as at HEAD. (4) `scripts/gate.sh .venv/bin/pytest -m e2e tests/e2e/test_pipelines_filter_upload.py --no-cov -q` passes. Name the headless chromium and app subprocess before they run (`~/dev/CLAUDE.md` 3.1). (5) `scripts/gate.sh make lint` passes.

## Notes

- Same-cause candidate left out, for the owner: `scripts/authority.py` `main` repeats the catch-print-return-1 body around its own `EnumerationFetchError`. Whether that domain error should become `CliError` is an unclear boundary (`~/dev/CLAUDE.md` 10.2), so it is a question, not a task.
- Most of these repeats sit under jscpd's 50-token floor, but Task 4's frame builders may be one of the 15 Python clones still counted, and removed lines move the percentage either way. Plan 19 re-measures the threshold floor after this plan lands.
