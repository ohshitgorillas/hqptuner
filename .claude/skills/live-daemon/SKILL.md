---
name: live-daemon
description: Conduct against the production hqplayerd and the dev container's staging buffer: idle gate and restore, the tested HTTP lane, EQ sessions that stage and never apply, probe cleanup, the excised LIVE rate control, and the secrets presence test. Load before any write against hqplayerd or the staging buffer.
---

# Live daemon

hqplayerd runs bare metal on the dev host, that host's top-priority service (Roon plus HQPlayer audio path). Treat it as live production.

## Idle gate and restore

Write ops against the production daemon: idle-gate first (`State state="0"`), restore what you change, verify the restore by `State` readback. `scripts/probes/capture_pcm_enums.py` is the pattern. This protects the host's listener; it never becomes a gate in HQPTuner's own write path.

## The tested lane

Every hqplayerd HTTP interaction goes through the repo's own lane: `httpconf.HttpConfigClient`, the manager lanes, `serialize_matrix_form` and friends. Never hand-roll curl against the daemon: a `curl --digest` POST with a body hangs on the digest-plus-body handshake while the daemon is fine. When a daemon call fails, suspect the invocation before the engine. `/speakers` applies exactly like `/config` and `/matrix`, through the same lane.

## EQ sessions: stage, never apply

The agent only ever stages (`POST /api/config/stage`) and never calls `POST /api/config/apply`. Apply is the owner's write gate; it restarts the engine and interrupts playback, the listener's call alone. Hand back "staged, ready for your Apply" and stop.

This is corrective EQ, not taste EQ. Trace the whole measured response from the first fit, every region including above 8 kHz. No band rationing, no deferred regions pending better data, no ablation ladders: the owner has the Apply gate, saved matrix profiles and their ears, so an overcorrection costs one discarded profile. Peaks are judged against local terrain, not the absolute target; a bump below flat still gets a notch when pointed at. Uniform preamp across concurrently auditioned profiles. Linear-gain Bauer matrices stage through the `sessions/<hp>/stage-variant.mjs` compileRows lane, since eqstage cannot fold preamp there.

## Probe cleanup

Before a probe writes anything, read and record the current value of every field it will touch. Clean up by restoring exactly those fields. Never click Discard, Apply, Apply & Save, Save as New or any other global control on the dev container: the staging buffer is server-side state shared with whoever is using the page, staged-but-unapplied edits are unrecoverable, and Discard clears the whole buffer, not the field you touched. A probe that genuinely needs a clear buffer runs against a local instance. Never assume a count in the status bar is all yours.

## LIVE has no rate control

Removed by owner decision (option 1) because hqplayerd offers no live route that is family-safe: a `SetRate` pin is exact, `auto_family=1` does not fold a 48k-member pin, so 44.1k material re-clocks to a 48k base, and the limit slot (`defaults_samplerate` / `defaults_bitrate`) is config-only with every route to it restarting the daemon. Rejected on sight: per-source member selection, anything rerouting 44.1 to a 48k base, writing rate to the XML from LIVE. Rate selection is the Output-tab config path only. `RATE_LIMIT_FIELD` and `rate_family` survive in `lanes/live/chain.py` for restore preservation and chain detection; legacy live presets carrying `rate` apply their other fields and drop the rate (`api/routes/livepreset.py`). Do not reintroduce a live rate write in any form.

## Secrets in the shell

`HQPTUNER_HQP_USERNAME` / `HQPTUNER_HQP_PASSWORD` are not secret (binding exception in `CLAUDE.md`) and print freely; they live in the unblocked `hqpcreds` file. Every other credential on the host: presence test only, `[ -n "$VAR" ] && echo set || echo unset`. `${VAR:-no}` prints the value when set, and mixing it with `${VAR:+yes}` looks like a presence test and is a value dump. A blocked command is a signal to find a safer path, not a cleverer phrasing. The ambient shell on the host carries `HQPTUNER_HQP_*` from the user's profile, so a run that "works with no credentials configured" may be inheriting them; prove which credentials are in play by setting them explicitly.
