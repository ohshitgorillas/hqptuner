# Settings classification — live vs restart

Phase 0.2 deliverable. Every architecture §4 control tagged with lane:

- **live** — Control API (4321) setter exist; change take effect now, no daemon restart.
- **http** — no live setter; setting persist by **restore lane**: HQPTuner fetch `/backup`, surgically edit field's element/attribute in running config XML (`presetconf.FIELD_MAP`), push archive with `POST /restore` (`scope=system`, Digest auth). Daemon self-restart in **~5.6 s** (`lanes/http/restore.py`). Field names below still daemon's own `/config` form field names — read side and staging key — but **write not form POST**.

  > **No `POST /config` exist.** `/config` GET-only (`conf/httpconf.py`); only `POST /config/...` call is `/config/profile/delete` for removing preset mirror. Everything persistent ride restore lane — also why `volume_fixed` can carry `2`; form submit cannot express it. Real **form** POSTs exist only for three routes outside this table's scope: `POST /matrix`, `POST /matrix/{load,save,delete}`, `POST /speakers` (~3 s engine reload each).
- **file (read)** — `/config` form carry field but render it with widget narrower than its XML domain, so form value lossy. Write still go through http lane; only **baseline read** come from config file (`manager.file_config`, exposed as `file` on `GET /api/config`). `volume_fixed` only such field today.
- **file (restore)** — no `/config` form field **and** no live setter; setting live only in `<engine>` element of config XML (hardware acceleration). Applied by editing `/backup` archive's `<engine>` tag (surgical, byte-faithful) and pushing via `POST /restore` (`scope=system`), which daemon re-read on self-restart (~5.6 s) that **preserve active preset** — no `systemctl`, plain Digest auth. Grounded on 6.0.4 on Opal (idle-gated probe, 2026-07-18). See `protocol.md` §3.6.

Empirical basis: spike runs against hqplayerd 6.0.4 on Opal (engine idle, `state=0`), 2026-07-16. Wire details in `protocol.md`.

Rules this table assume — no shutdown persistence, live-vs-file divergence, list-index/enum-ID split, `result="OK"` not proof — stated once in `architecture.md` §2, wire evidence in `protocol.md` §1/§4.

## Output

| Control | Lane | Evidence / notes |
|---|---|---|
| Output mode (PCM/SDM) | live | `SetMode` verified: index domain (0=[source], 1=PCM, 2=SDM); immediate; reset rate to auto, swap enumeration lists. HTTP field `mode` (`auto`/`pcm`/`sdm`) also set it persistently |
| Backend (ALSA/Network) | http | field `backend` (`alsa`/`network`/`combo`) |
| Rate | http | `defaults_samplerate` / `defaults_bitrate`, always the tier's 48k member. **`SetRate` is never sent**: it writes the FIXED slot (`samplerate`/`bitrate`) and an exact rate there overrides automatic base-rate selection, so 44.1k material goes out at a 48k base and the engine refuses the filter (measured on 6.0.4: pin 24576000 under a 44.1 kHz source held 24576000; clearing it gave 22579200) |
| Auto rate family | http | `auto_family`, forced on with the fixed slots at 0 (`FORCED_CONFIG`); what picks the tier member matching the source, per track |
| Output device | http | **per-backend**: `alsa_device` / `net_device` (select) |
| DAC bits | http | **per-backend**: `alsa_bits` / `net_bits` (0–32). Independent values (live: `alsa_bits=24`, `net_bits=20`) |
| DoP | http | **per-backend**: `alsa_dop` / `net_dop` (checkbox) |
| 48k DSD | http | **per-backend**: `alsa_anydsd` / `net_anydsd` (checkbox) |
| Buffer time | http | **per-backend**: `alsa_period` / `net_period` (−1–250 ms; −1=minimum, 0=default) |
| Channel offset | http | ALSA only: `alsa_offset` (0–31) |
| IPv6 | http | Network only: `net_ipv6` (checkbox) |
| Idle time | http | field `idle_time` — **milliseconds** on wire (0=default, 10000=10 s, … 60000) |
| UPnP freewheel | http | field `upnp_freewheel` (checkbox); input-side, backend-independent |
| Quick pause | http | field `quick_pause` (checkbox) → `<engine quick_pause>` |
| Short buffer | http | field `short_buffer` (select 0/1/2 = Normal/Short/Minimum) → `<engine short_buffer>` |

**Correction (Phase 4, verified live 6.0.4): transport params per-backend, not mode-gated.** Embedded `/config` form scope device / DAC bits / DoP / 48k-DSD / buffer per backend (`alsa_*` vs `net_*`), independent values — architecture §4/§5 "DAC bits grays in SDM / DoP grays in PCM" annotations describe *desktop* app, not this form. HQPTuner surface these in collapsible ALSA / Network sections keyed on `backend` (Combo show both), not via mode-graying.

**Two rate slots per family, and they differ (measured 2026-07-28, `scripts/probes/probe_rate_slots.py`).** Daemon's own `/config` form label them apart: `defaults_samplerate` / `defaults_bitrate` = "Rate limit" (no Auto entry), `samplerate` / `bitrate` = "Sample rate" / "Bit rate" (Auto = `0`, and the slot `SetRate` writes). Measured against 44.1 kHz source with limit at DSD512 — request unset → 22579200 (limit caps, follow source base family); request `12288000` → 12288000 (exact, 44.1k source out at 48k base); request `49152000` → 49152000 (exact, override limit). So limit = family-following cap, request = exact rate ignoring both.

**Rate per-family and friendly.** HQPTuner rate menus write the **limit** only, as fixed friendly menus (`1x…32x` / `DSD64…DSD2048`) mapped to **48k-base member of each tier**. No Auto entry: limit slot has none, and naming the tier reach same outcome.

**Forced on every write (HQPTuner policy).** `auto_family=1`, `samplerate=0`, `bitrate=0` merged into every `/restore` payload (`FORCED_CONFIG`, `lanes/http/restore.py`). Not exposed in UI, enforced on write only. Request slot pinned to `0` is **binding, not cosmetic**: config write have no source to take base family from, so writing it would send 44.1k material out at 48k base and override user's own `alsa_anydsd` / `net_anydsd` decision.

**LIVE write the request slot, family-aware.** `SetRate` is the only live rate setter, so LIVE carry it — but engine report what is playing, so `store/live/rates.js` resolve the picked tier to that source's own member before sending (DSD512 on 44.1k track → 22579200) — falling back to the tier's other member when engine's rates list hold only that one, since device doing DSD in one base family only enumerate one member of every DSD tier and tier is reachable through either. Same rule govern graying: tier count as offered when list hold EITHER member, never only the member LIVE would have preferred. Reverse direction: `overrides.live_overrides` bring the pin back as its tier in the limit field, so tab agree after LIVE switch off, Apply stay unlit, Save persist it.

**One pin, and `SetMode` clear it (measured 2026-07-28, `scripts/probes/probe_mode_rate_pin.py`).** Request slot is NOT per family in the engine — daemon hold one, mode switch drop it: pin DSD64 in SDM, switch to PCM (`State.rate` = 0), switch back (`State.rate` = 0 still). So `State` answer only for family engine currently run, and only until next mode switch. HQPTuner keep the per-family memory itself (`ConnectionManager.live_rates`, Hz): `lanes/live/lane` record verified LIVE rate write under its family, re-assert it with `SetRate` after verified mode write (resolved against the **post-switch** rates list, mode-dependent per manual §4.6), and drop family whose tier the entered mode not offer rather than pin nearest. `live_overrides` report **both** families' limit fields off that memory, engine's own reported pin winning for family it run. Both LIVE rate columns and Output tab's Rate box read that one overlay (`runningValue`, `store/live/rates.js`), so two views cannot drift. Memory is process-lifetime — daemon restart drop the pins anyway.

## DSP

| Control | Lane | Evidence / notes |
|---|---|---|
| 1x filter | live | `SetFilter value1x` verified (index domain) |
| Nx filter | live | `SetFilter value` verified; `value` alone set **both** 1x and Nx |
| Channels | http | field `channels` (2–32) |
| DSP pipelines | http | field `pipelines` (2–128) |
| FFT filter length | http | field `fft_size` (128–16384) |
| Dither/Modulator | live | `SetShaping` verified (index domain); list mode-dependent |
| Bauer crossfeed (enable/preset/params) | http | no live setter |
| DAC correction | http | no live setter; `Status correction` read-only state |
| DSD sources (Direct SDM, Gain +6 dB, Integrator, SDM-SDM, Noise filter, SDM-PCM) | http | no live setters |

## Volume

| Control | Lane | Evidence / notes |
|---|---|---|
| Fixed volume level | live* | `Volume` verified to respond; error (`result="Error"`, level unchanged) while volume control disabled (`VolumeRange enabled="0"`) — live only when volume control enabled. HTTP fields `volume_fixed` / `fixed_volume` for persistent value |
| Volume enabled | http | field `fixed_volume_enabled`; gate live `Volume` command |
| Optimal ISO | http (write) + file (read) | field `volume_fixed` → `<engine volume_fixed>`. **Domain 0/1/2** (off / −3 dB / −6 dB, readme §1.2) but daemon's `/config` form render bare **checkbox**, so form can neither express nor report `2`. See note below |
| Max/min volume | http | fields `volume_max` / `volume_min`; `VolumeRange` (4321) read-only |
| Startup volume | http | field `defaults_volume` |
| PCM gain compensation | http | field `gain_comp` (step 0.1) |
| Adaptive volume | live | `SetAdaptiveVolume` verified: `adaptive` flag toggle and read back; `VolumeRange adaptive` mirror it. Response bare `<SetAdaptiveVolume/>`, no `result` attribute. HTTP field `adaptive_volume` for persistent value |
| Playlist album gain | http | field `playlist_album_gain` |

**Optimal ISO lossy-form field (verified live on 6.0.4, 2026-07-19).** `volume_fixed` the one owned setting whose XML domain wider than widget hqplayerd render for it. Consequences, both load-bearing:

- **Write.** `2` (−6 dB) writable **only because persistent lane is `POST /restore` with surgically-edited config XML**, not `/config` form POST — form submit cannot carry third state. Lane edit **running** working config (`hqplayerd.xml`) with staged edits and push that (`presetzip.restore_zip_from_running`). Verified live: applied `volume_fixed="2"`, read back `2` from fresh `/backup`, restored to `1`, restore confirmed, no collateral config changes. If persistent lane ever revert to form-posting, −6 dB silently become unwritable (`tests/test_file_config.py` fail in that case, by design).
- **Read.** Form report only bool, so `1` and `2` indistinguishable there. Baseline come instead from `manager.file_config` — running config parsed from `/backup` archive's working `hqplayerd.xml`, served on `GET /api/config` as `file`, preferred by frontend schema entries flagged `fileTruth`. Refreshed on connect and by apply's verify step; never per poll (archive ~5 MB).

HQPTuner therefore expose it as three-way control (Off · −3 dB · −6 dB) rather than tri-state checkbox HQPlayer Desktop use.

**Live playback volume (Phase 4).** Beyond persistent volume config above, running engine's current volume real-time control on own lane: `Volume` (4321) write immediately, `VolumeRange` report live bounds + `enabled` flag, `State.volume` current level. HQPTuner expose this as `GET/POST /api/volume` — dedicated immediate-write path, never staged, never restarting. Usable only when `VolumeRange enabled=1` (volume control active — not fixed volume, and active stream); UI gray slider otherwise.

## System

| Control | Lane | Evidence / notes |
|---|---|---|
| CUDA offload | file (restore) | `<engine cuda>` (`0`/`1`/`convolution`) — **not** on `/config` form; verified 2026-07-18 |
| Multicore DSP | file (restore) | `<engine multicore>` (`auto`/`0`/`1`) |
| E-core allocation | file (restore) | `<engine ecores>` (`default`/`pool`/`filter`) |
| Blocks/cycle | file (restore) | `<engine nblocks>` (int, `0`=default) |
| CUDA device ids | file (restore) | `<engine cuda_dev>` / `<engine cuda_cdev>` (int, `-1`=automatic) — GPU used for filters/general DSP and one used for convolution; different values split workload across two cards (manual §4.7) |
| Pre-process before metering | http | field `pre_before_meter` (checkbox) → `<engine pre_before_meter>` |
| Backup/restore config | http | daemon's own `/backup/settings.zip` (GET) / `/restore` (multipart POST, Digest auth) |
| Trial/license/version | read-only | `GetLicense` (`valid`/`name`/`fingerprint`) / `GetInfo` (4321), verified |
| Enable log / log path | http | fields `log_enabled` (checkbox) / `log_file` (text), verified |
| Live log tail | n/a | file/journal stream, not daemon setting |

`<engine>` settings above reachable only by editing config XML in `/backup` archive and pushing with `POST /restore` — daemon's configuration model and behavior of each write route in `protocol.md` §3.6.

## Additional live controls on the wire (not in architecture §4)

| Command | Status | Notes |
|---|---|---|
| `SetJunkFilter` | live, verified | index domain; index 1 = 20k set both `filter_junk` and `filter_20k` state flags |
| `SetConvolution` | out of scope | setter exist but standalone convolution-engine access is `architecture.md` §1 non-goal — dropped per user decision |

## Preset switching (HTTP lane)

Preset CRUD not 4321 Control API operation for HQPTuner — go through port-8088 HTTP interface under Digest auth (see `protocol.md` §3.6):

| Operation | Route | Field |
|---|---|---|
| Switch | `POST /restore` (`scope=system`) onto `[default]` | preset's XML as working config, mirrored into `data/cfgs` |
| Save (create/overwrite) | `POST /restore` (`scope=system`) | running config as working config, mirrored into `data/cfgs` |
| Delete | `POST /config/profile/delete` | `profile=<name>` |
| List / active | 4321 `ConfigurationList` / `ConfigurationGet` (unauth) or `GET /config` | — |

4321 `ConfigurationLoad` crypto path (auth-gated by `SessionAuthentication`) **not used** — daemon reject self-generated client keys, but HTTP route do same job with ordinary Digest auth.

## Open items

- Whether live setters behave differently during active playback (all spikes ran with engine stopped).