# Junk-filter recommender — implementation plan

Investigation done 2026-07-28; wire facts below are live-verified — build, don't re-probe. Read `docs/protocol.md` §7 and project `CLAUDE.md` first.

## Goal

Analyze the daemon's metering stream, detect junk-dominated HF content in the playing source, surface a recommendation chip in the top-bar alert strip (`AlertStrip.js`, under the signal-path chips, present in both modes — user-corrected 2026-07-28 from the original Live-view placement). **Advice only** (user-corrected 2026-07-28): the chip tells the user what to change ("Fake hi-res detected — engage the 20k filter"), with no apply button and no write-path involvement. Never auto-engage. Rendering a spectrogram is out of scope.

## Verified facts

- Metering stream: TCP port 4322, streams on bare accept, ~43 frames/s. Layout + decoding in `docs/protocol.md` §7; working decoder in `scripts/probe_metering_stream.py`.
- Metering taps at **source rate** (`bandwidth` header = source Nyquist even while upsampling) — detector sees the source spectrum directly.
- Junk filter enum (`GET /api/enumerations` → `data.junk_filters`): `none/20k/30k/40k/50k/2x/4x/8x`. Join by name, never hardcode indices.
- Write path exists: `hqptuner/writer.py:67`, live-lane field `hqptuner/lanes/livemap.py:293`. No new write plumbing.
- Track context from `Status`: `metadata` child (`samplerate`, `sdm`), `track_serial` for change detection.

## Filter semantics (manual.txt:2036-2065)

20k = sharp cut for fake hi-res; 30k/40k = slow roll-off for HF disturbances above the music (tape transfers); 50k = very slow roll-off for excessive noise shaping (ADC / DSD-to-PCM). 2x/4x/8x rate-relative — leave manual, no auto-recommendation.

## Design

1. **Metering reader** (async backend task): decode 4322 frames, accumulate per-track spectral aggregate (band powers, content ceiling, HF slope), reset on `track_serial` change. Reconnect with backoff; stream absence = "no recommendation", never a user-facing error.
2. **Classifier** (pure function over the aggregate, separately testable): brick wall ≤ ~24 kHz with container ≥ 88.2k → 20k; spurs/disturbance above natural decay → 30k/40k; rising HF noise ramp → 50k; else none. Exempt SDM/DSD sources and containers ≤ 48k. ASSUMED: thresholds need tuning against real captures — start conservative, recommend only unambiguous signatures.
3. **API**: recommendation object (filter name, reason, ceiling summary) in the `/api/status` payload — the poll `AlertStrip`'s store already consumes.
4. **UI**: advisory text in the top-bar alert strip — no controls of any kind (no apply, no dismiss; user-corrected 2026-07-28). It appears while the verdict stands and clears itself on track change or once the engaged junk filter treats the signature (corner at or below the recommended one, or any rate-relative choice; `none` never clears it — user-corrected 2026-07-28).

## Open items

- ~~Reader always-on vs only while Live view open~~ — resolved: always-on; the chip lives in chrome present in both modes.

## Done

Per project `CLAUDE.md`: `/tests` chain (fakes speak 4322 framing), `make check`, `/task-check`, hand-back at URL, `CHANGELOG.md` entry.
