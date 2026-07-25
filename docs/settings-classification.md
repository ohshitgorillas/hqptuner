# Settings classification — live vs restart

Phase 0.2 deliverable. Every architecture §4 control tagged with its lane:

- **live** — a Control API (4321) setter exists; the change takes effect immediately, no daemon restart.
- **http** — no live setter; the setting is persisted by the **restore lane**: HQPTuner fetches `/backup`, surgically edits the field's element/attribute in the running config XML (`presetconf.FIELD_MAP`), and pushes the archive with `POST /restore` (`scope=system`, Digest auth), on which the daemon self-restarts in **~5.6 s** (`lanes/httplane.py`). The field names below are still the daemon's own `/config` form field names — they are the read side and the staging key — but the **write is not a form POST**.

  > **Corrected 2026-07-24.** This lane was previously documented as `POST /config`, and the label stuck after the implementation moved. There is no `POST /config` anywhere in the codebase — `/config` is GET-only (`conf/httpconf.py`), and the only `POST /config/...` call is `/config/profile/delete` for removing a preset mirror. The restore lane is what everything persistent actually rides, which is also why `volume_fixed` can carry `2`: a form submit could not express it. The ~3 s figure quoted for a config apply was the `/config` form's reload; the real cost is the restore restart, ~5.6 s.

  Genuine **form** POSTs do exist, but only for three routes outside this table's scope: `POST /matrix`, `POST /matrix/{load,save,delete}` and `POST /speakers` (~3 s engine reload each).
- **file (read)** — the `/config` form carries the field but renders it with a widget narrower than its XML domain, so the form's value is lossy. The write still goes through the http lane; only the **baseline read** comes from the config file (`manager.file_config`, exposed as `file` on `GET /api/config`). `volume_fixed` is the only such field today.
- **file (restore)** — no `/config` form field **and** no live setter; the setting lives only in the `<engine>` element of the config XML (hardware acceleration). Applied by editing a `/backup` archive's `<engine>` tag (surgical, byte-faithful) and pushing it via `POST /restore` (`scope=system`), which the daemon re-reads on a self-restart (~5.6 s) that **preserves the active preset** — no `systemctl`, plain Digest auth. Grounded on 6.0.4 on Opal (idle-gated probe, 2026-07-18). See `protocol.md` §3.6.

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
| Quick pause | http | field `quick_pause` (checkbox) → `<engine quick_pause>` |
| Short buffer | http | field `short_buffer` (select 0/1/2 = Normal/Short/Minimum) → `<engine short_buffer>` |

**Correction (Phase 4, verified live 6.0.4): transport params are per-backend, not mode-gated.** The Embedded `/config` form scopes device / DAC bits / DoP / 48k-DSD / buffer per backend (`alsa_*` vs `net_*`), with independent values — the architecture §4/§5 "DAC bits grays in SDM / DoP grays in PCM" annotations describe the *desktop* app, not this form. HQPTuner surfaces these in collapsible ALSA / Network sections keyed on `backend` (Combo shows both), not via mode-graying.

**Rate is per-family and friendly.** Persistent rate lives in two fields — `defaults_samplerate` (PCM) and `defaults_bitrate` (SDM) — each a target/ceiling. HQPTuner shows both as fixed friendly menus (`1x…32x` / `DSD64…DSD2048`) mapped to the **48k-base** ceiling value.

**Forced on every write (HQPTuner policy).** `auto_family=1`, `samplerate=0`, `bitrate=0` are merged into every `/restore` payload (`FORCED_CONFIG`, `lanes/httplane.py`), so the friendly per-family ceiling holds (auto-family follows the source's 44.1/48 base; the fixed sample/bit rate stays on Auto). Not exposed in the UI. Enforced on write only.

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
| Optimal ISO | http (write) + file (read) | field `volume_fixed` → `<engine volume_fixed>`. **Domain is 0/1/2** (off / −3 dB / −6 dB, readme §1.2) but the daemon's `/config` form renders a bare **checkbox**, so the form can neither express nor report `2`. See the note below |
| Max/min volume | http | fields `volume_max` / `volume_min`; `VolumeRange` (4321) is read-only |
| Startup volume | http | field `defaults_volume` |
| PCM gain compensation | http | field `gain_comp` (step 0.1) |
| Adaptive volume | live | `SetAdaptiveVolume` verified: `adaptive` flag toggles and reads back; `VolumeRange adaptive` mirrors it. Response is a bare `<SetAdaptiveVolume/>` with no `result` attribute. HTTP field `adaptive_volume` for the persistent value |
| Playlist album gain | http | field `playlist_album_gain` |

**Optimal ISO is a lossy-form field (verified live on 6.0.4, 2026-07-19).** `volume_fixed` is the one owned setting whose XML domain is wider than the widget hqplayerd renders for it. Consequences, both load-bearing:

- **Write.** `2` (−6 dB) is writable **only because the persistent lane is `POST /restore` with surgically-edited config XML**, not a `/config` form POST — a form submit cannot carry a third state. The lane edits the **running** working config (`hqplayerd.xml`) with the staged edits and pushes that (`presetconf.restore_zip_from_running`, 2026-07-20) — it used to rebuild from the active preset's snapshot, which reverted any field not staged in the same apply. Verified live: applied `volume_fixed="2"`, read back `2` from a fresh `/backup`, restored to `1`, restore confirmed, no collateral config changes. If the persistent lane ever reverts to form-posting, −6 dB silently becomes unwritable (`tests/test_file_config.py` fails in that case, by design).
- **Read.** The form reports only a bool, so `1` and `2` are indistinguishable there. The baseline comes instead from `manager.file_config` — the running config parsed from the `/backup` archive's working `hqplayerd.xml`, served on `GET /api/config` as `file` and preferred by frontend schema entries flagged `fileTruth`. Refreshed on connect and by the apply's verify step; never per poll (the archive is ~5 MB).

HQPTuner therefore exposes it as a three-way control (Off · −3 dB · −6 dB) rather than the tri-state checkbox HQPlayer Desktop uses.

**Live playback volume (Phase 4).** Beyond the persistent volume config above, the running engine's current volume is a real-time control on its own lane: `Volume` (4321) writes immediately, `VolumeRange` reports the live bounds + `enabled` flag, `State.volume` the current level. HQPTuner exposes this as `GET/POST /api/volume` — a dedicated immediate-write path, never staged and never restarting. It's usable only when `VolumeRange enabled=1` (volume control active — not fixed volume, and an active stream); the UI grays the slider otherwise.

## System

| Control | Lane | Evidence / notes |
|---|---|---|
| CUDA offload | file (restore) | `<engine cuda>` (`0`/`1`/`convolution`) — **not** on the `/config` form; verified 2026-07-18 |
| Multicore DSP | file (restore) | `<engine multicore>` (`auto`/`0`/`1`) |
| E-core allocation | file (restore) | `<engine ecores>` (`default`/`pool`/`filter`) |
| Blocks/cycle | file (restore) | `<engine nblocks>` (int, `0`=default) |
| CUDA device ids | file (restore) | `<engine cuda_dev>` / `<engine cuda_cdev>` (int, `-1`=automatic) — the GPU used for filters/general DSP and the one used for convolution; different values split the workload across two cards (manual §4.7) |
| Pre-process before metering | http | field `pre_before_meter` (checkbox) → `<engine pre_before_meter>` |
| Backup/restore config | http | daemon's own `/backup/settings.zip` (GET) / `/restore` (multipart POST, Digest auth) |
| Trial/license/version | read-only | `GetLicense` (`valid`/`name`/`fingerprint`) / `GetInfo` (4321), verified |
| Enable log / log path | http | fields `log_enabled` (checkbox) / `log_file` (text), verified |
| Live log tail | n/a | file/journal stream, not a daemon setting |

**Config model (verified 2026-07-18, idle-gated probes on 6.0.4).** `hqplayerd.xml` is the live **working** config; `data/cfgs/<name>.xml` are saved **snapshots**. `POST /config/profile/load` copies a snapshot into the working config **from memory** — it does *not* re-read the snapshot file from disk (a disk edit followed by `load` has no effect; only a full daemon restart re-reads disk). `POST /config` writes the working file and **preserves** the active preset — it does *not* reset to `[default]`; only a full `systemctl restart` drops the active label to `[default]`. `POST /restore` (`scope=system`) writes the whole archive and triggers a self-restart that re-reads from disk **while keeping the active preset** — this is the lane HQPTuner uses for the form-absent `<engine>` hardware settings and for user-initiated backup restore. `scope=user` writes `~/.hqplayer`, which is not the running config on Opal, so it has no effect there.

## Additional live controls on the wire (not in architecture §4)

| Command | Status | Notes |
|---|---|---|
| `SetJunkFilter` | live, verified | index domain; index 1 = 20k set both `filter_junk` and `filter_20k` state flags |
| `SetConvolution` | out of scope | setter exists but standalone convolution-engine access is an `architecture.md` §1 non-goal — dropped per user decision |

## Preset switching (HTTP lane)

Preset CRUD is not a 4321 Control API operation for HQPTuner — it goes through the port-8088 HTTP interface under Digest auth (see `protocol.md` §3.6):

| Operation | Route | Field |
|---|---|---|
| Switch | `POST /restore` (`scope=system`) onto `[default]` | the preset's XML as the working config, mirrored into `data/cfgs` |
| Save (create/overwrite) | `POST /restore` (`scope=system`) | the running config as the working config, mirrored into `data/cfgs` |
| Delete | `POST /config/profile/delete` | `profile=<name>` |
| List / active | 4321 `ConfigurationList` / `ConfigurationGet` (unauth) or `GET /config` | — |

The 4321 `ConfigurationLoad` crypto path (auth-gated by `SessionAuthentication`) is **not used** — the daemon rejects self-generated client keys, but the HTTP route does the same job with ordinary Digest auth.

## Open items

- `SetAdaptiveVolume` verified live; `SetConvolution` is out of scope (dropped).
- `POST /config/profile/load` **restarts the daemon** (verified: 4321 refused ~0.3 s after POST, back ~3.4 s — a lighter config-reload restart than `systemctl restart`). Routed through the connection manager's restart-resync path, same as `POST /config`. Note: a daemon restart resets the active config to `[default]` (the unnamed base = `hqplayerd.xml`); the active-profile name is not persisted across a full service restart, only a profile `load` sets it.
- Whether live setters behave differently during active playback (all spikes ran with the engine stopped).
