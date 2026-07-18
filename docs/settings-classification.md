# Settings classification — live vs restart

Phase 0.2 deliverable. Every outline §4 control tagged with its lane:

- **live** — a Control API (4321) setter exists; the change takes effect immediately, no daemon restart.
- **http** — no live setter; the setting is applied via `POST /config` on the port-8088 HTTP interface (Digest auth), which makes the daemon rewrite `hqplayerd.xml` and restart itself. (Formerly called the "restart / XML lane"; the daemon owns the file write — HQPTuner just POSTs the form. See `protocol.md` §3.6.) Observed `POST /config` form field name given where known.

Empirical basis: spike runs against hqplayerd 6.0.4 on Opal (engine idle, `state=0`), 2026-07-16. Wire details in `protocol.md`.

## Ground rules (verified)

- **Shutdown persistence: none.** hqplayerd never writes in-memory Control API changes to `hqplayerd.xml` — not while running and not at shutdown. Evidence: with a deliberate unsaved filter change in memory, the config file was md5-identical (`f58aa9a2…`) before and after `systemctl stop`. Consequences: the XML lane's stop → write → start sequence cannot be clobbered by the daemon, and every live (Control API) change is lost on restart.
- **Live-vs-file divergence is real.** Because live changes are never persisted, the running engine's settings can differ from `hqplayerd.xml` indefinitely — observed in practice on Opal (running filters differed from the file's stored filters before any spike ran). HQPTuner must read both lanes and surface divergence instead of assuming the file reflects reality.
- **Value domain: list index, not enum ID.** `Set*` commands and `State` responses use enumeration **list indices**; `hqplayerd.xml` stores **enum IDs** (the `value` attribute of enumeration items). Translating between the two lanes requires the live enumeration lists. Never mix the domains.
- `result="OK"` is not proof of application — always verify by `State` readback.

## Output

| Control | Lane | Evidence / notes |
|---|---|---|
| Output mode (PCM/SDM) | live | `SetMode` verified: index domain (0=[source], 1=PCM, 2=SDM); immediate; resets rate to auto and swaps enumeration lists. HTTP field `mode` (`auto`/`pcm`/`sdm`) also sets it persistently |
| Backend (ALSA/Network) | http | field `backend` (`alsa`/`network`/`combo`) |
| Rate | live | `SetRate` verified: `RatesItem` index; immediate effect even while stopped; index 0 = auto |
| Auto rate family | http | live-adjacent: `SetRate` index 0 selects auto/source-based rate |
| Output device | http | **per-backend**: `alsa_device` / `net_device` (select) |
| DAC bits | http | **per-backend**: `alsa_bits` / `net_bits` (0–32). Independent values (live: `alsa_bits=24`, `net_bits=20`) |
| DoP | http | **per-backend**: `alsa_dop` / `net_dop` (checkbox) |
| 48k DSD | http | **per-backend**: `alsa_anydsd` / `net_anydsd` (checkbox) |
| Buffer time | http | **per-backend**: `alsa_period` / `net_period` (−1–250 ms; −1=minimum, 0=default) |
| Channel offset | http | ALSA only: `alsa_offset` (0–31) |
| IPv6 | http | Network only: `net_ipv6` (checkbox) |
| Idle time | http | field `idle_time` — **milliseconds** on the wire (0=default, 10000=10 s, … 60000) |
| UPnP freewheel | http | field `upnp_freewheel` (checkbox); input-side, backend-independent |

**Correction (Phase 4, verified live 6.0.4): transport params are per-backend, not mode-gated.** The Embedded `/config` form scopes device / DAC bits / DoP / 48k-DSD / buffer per backend (`alsa_*` vs `net_*`), with independent values — the outline §4/§5 "DAC bits grays in SDM / DoP grays in PCM" annotations describe the *desktop* app, not this form. HQPTuner surfaces these in collapsible ALSA / Network sections keyed on `backend` (Combo shows both), not via mode-graying.

**Rate is per-family and friendly.** Persistent rate lives in two fields — `defaults_samplerate` (PCM) and `defaults_bitrate` (SDM) — each a target/ceiling. HQPTuner shows both as fixed friendly menus (`1x…32x` / `DSD64…DSD2048`) mapped to the **48k-base** ceiling value.

**Forced on every write (HQPTuner policy).** `auto_family=1`, `samplerate=0`, `bitrate=0` are pinned on every `POST /config` (`_FORCED_CONFIG`), so the friendly per-family ceiling holds (auto-family follows the source's 44.1/48 base; the fixed sample/bit rate stays on Auto). Not exposed in the UI. Enforced on write only.

## DSP

| Control | Lane | Evidence / notes |
|---|---|---|
| 1x filter | live | `SetFilter value1x` verified (index domain) |
| Nx filter | live | `SetFilter value` verified; `value` alone sets **both** 1x and Nx |
| Channels | http | field `channels` (2–32) |
| DSP pipelines | http | field `pipelines` (2–128) |
| FFT filter length | http | field `fft_size` (128–16384) |
| Dither/Modulator | live | `SetShaping` verified (index domain); list is mode-dependent |
| Bauer crossfeed (enable/preset/params) | http | no live setter |
| DAC correction | http | no live setter; `Status correction` is read-only state |
| DSD sources (Direct SDM, Gain +6 dB, Integrator, SDM-SDM, Noise filter, SDM-PCM) | http | no live setters |

## Volume

| Control | Lane | Evidence / notes |
|---|---|---|
| Fixed volume level | live* | `Volume` verified to respond; errors (`result="Error"`, level unchanged) while volume control is disabled (`VolumeRange enabled="0"`) — live only when volume control is enabled. HTTP fields `volume_fixed` / `fixed_volume` for the persistent value |
| Volume enabled | http | field `fixed_volume_enabled`; gates the live `Volume` command |
| Optimal ISO | http | no live setter |
| Max/min volume | http | fields `volume_max` / `volume_min`; `VolumeRange` (4321) is read-only |
| Startup volume | http | field `defaults_volume` |
| PCM gain compensation | http | field `gain_comp` (step 0.1) |
| Adaptive volume | live | `SetAdaptiveVolume` verified: `adaptive` flag toggles and reads back; `VolumeRange adaptive` mirrors it. Response is a bare `<SetAdaptiveVolume/>` with no `result` attribute. HTTP field `adaptive_volume` for the persistent value |
| Playlist album gain | http | field `playlist_album_gain` |

## System

| Control | Lane | Evidence / notes |
|---|---|---|
| CUDA offload | http | no live setter |
| Multicore DSP | http | no live setter |
| E-core allocation | http | no live setter |
| Blocks/cycle | http | no live setter |
| Backup/restore config | http | daemon's own `/backup` / `/restore` routes (Digest auth) |
| Trial/license/version | read-only | `GetLicense` / `GetInfo` (4321), verified |
| Enable log / log path | http | no live setter |
| Live log tail | n/a | file/journal stream, not a daemon setting |

## Additional live controls on the wire (not in outline §4)

| Command | Status | Notes |
|---|---|---|
| `SetJunkFilter` | live, verified | index domain; index 1 = 20k set both `filter_junk` and `filter_20k` state flags |
| `SetConvolution` | out of scope | setter exists but convolution engine access is an outline non-goal — dropped per user decision |

## Preset switching (HTTP lane)

Preset CRUD is not a 4321 Control API operation for HQPTuner — it goes through the port-8088 HTTP interface under Digest auth (see `protocol.md` §3.6):

| Operation | Route | Field |
|---|---|---|
| Switch | `POST /config/profile/load` | `profile=<name>` |
| Save (create/overwrite) | `POST /config/profile/save` | `profile_name=<text>` |
| Delete | `POST /config/profile/delete` | `profile=<name>` |
| List / active | 4321 `ConfigurationList` / `ConfigurationGet` (unauth) or `GET /config` | — |

The 4321 `ConfigurationLoad` crypto path (auth-gated by `SessionAuthentication`) is **not used** — the daemon rejects self-generated client keys, but the HTTP route does the same job with ordinary Digest auth.

## Open items

- `SetAdaptiveVolume` verified live; `SetConvolution` is out of scope (dropped).
- `POST /config/profile/load` **restarts the daemon** (verified: 4321 refused ~0.3 s after POST, back ~3.4 s — a lighter config-reload restart than `systemctl restart`). Routed through the connection manager's restart-resync path, same as `POST /config`. Note: a daemon restart resets the active config to `[default]` (the unnamed base = `hqplayerd.xml`); the active-profile name is not persisted across a full service restart, only a profile `load` sets it.
- Whether live setters behave differently during active playback (all spikes ran with the engine stopped).
