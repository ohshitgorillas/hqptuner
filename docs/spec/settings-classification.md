# Settings classification — live vs restart

Every control is tagged with a lane:

- **live** — a Control API (4321) setter exists; the change takes effect now, with no daemon restart.
- **http** — there is no live setter; the setting persists by the **restore lane**: HQPTuner fetches `/backup`, surgically edits the field's element/attribute in the running config XML (`presetconf.FIELD_MAP`), and pushes the archive with `POST /restore` (`scope=system`, Digest auth). The daemon restarts itself in **~5.6 s** (`lanes/http/restore.py`). The field names below are still the daemon's own `/config` form field names — the read side and the staging key — but **the write is not a form POST**.

  > **`POST /config` exists; HQPTuner never calls it.** HQPTuner uses `/config` GET-only (`conf/httpconf.py`); the only `POST /config/...` call is `/config/profile/delete`, for removing a preset mirror. Everything persistent rides the restore lane — that is also why `volume_fixed` can carry `2`, which a form submit cannot express. Real **form** POSTs exist only for three routes outside this table's scope: `POST /matrix`, `POST /matrix/{load,save,delete}` and `POST /speakers` (~3 s engine reload each).
- **file (read)** — the `/config` form carries the field but renders it with a widget narrower than its XML domain, so the form value is lossy. The write still goes through the http lane; only the **baseline read** comes from the config file (`manager.file_config`, exposed as `file` on `GET /api/config`). `volume_fixed` is the only such field today.
- **file (restore)** — there is no `/config` form field **and** no live setter; the setting lives only in the `<engine>` element of the config XML (hardware acceleration). It is applied by editing the `<engine>` tag of the `/backup` archive (surgical, byte-faithful) and pushing the archive via `POST /restore` (`scope=system`); the daemon re-reads it on a self-restart (~5.6 s) that **lands on `[default]`** — no `systemctl`, plain Digest auth. See `docs/spec/protocol.md` "HTTP configuration routes (port 8088)".

Wire details are in `protocol.md`.

The rules this table assumes — no shutdown persistence, live-vs-file divergence, the list-index/enum-ID split, `result="OK"` not being proof — have wire evidence in `docs/spec/protocol.md` "Transport and framing" and "Response conventions".

## Output

| Control | Lane | Evidence / notes |
|---|---|---|
| Output mode (PCM/SDM) | live | `SetMode` verified: index domain (0=[source], 1=PCM, 2=SDM); immediate; reset rate to auto, swap enumeration lists. HTTP field `mode` (`auto`/`pcm`/`sdm`) also set it persistently |
| Backend (ALSA/Network) | http | field `backend` (`alsa`/`network`/`combo`). Windows daemon: `asio` and `wasapi` in place of `alsa` |
| Rate | http | `defaults_samplerate` / `defaults_bitrate`, always the tier's 48k member. **`SetRate` only as a pin the user asks for** (LIVE field `rate`, opt-in, §Rate slots below): it writes the FIXED slot (`samplerate`/`bitrate`) and an exact rate there overrides automatic base-rate selection, so 44.1k material goes out at a 48k base and the engine refuses the filter (measured on 6.0.4: pin 24576000 under a 44.1 kHz source held 24576000; clearing it gave 22579200) |
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

**Windows daemon local backends.** A Windows hqplayerd has ASIO and WASAPI where a Linux one has ALSA. Each carries the six ALSA-section fields under its own prefix: `asio_device` / `asio_offset` / `asio_bits` / `asio_period` / `asio_dop` / `asio_anydsd`, and the same six as `wasapi_*`. HQPTuner writes them to an `<asio>` or `<wasapi>` element under `<engine>` with the `<alsa>` attribute names.

Basis: field names and default config in the 6.0.2 Windows installer (`hqplayerd.exe`, `hqplayerd.xml`); the `<wasapi>` element, the `any_dsd` attribute on both and the `backend` values are not yet confirmed against a running Windows daemon. HQPTuner shows a local backend's section when the daemon's form carries its device field, and offers the backends the form's `backend` select lists.

**Transport params per-backend, not mode-gated.** Embedded `/config` form scope device / DAC bits / DoP / 48k-DSD / buffer per backend (`alsa_*` vs `net_*`), independent values — "DAC bits grays in SDM / DoP grays in PCM" annotations describe *desktop* app, not this form. HQPTuner surface these in collapsible ALSA / Network sections keyed on `backend` (Combo show both), not via mode-graying.

**Rate per-family and friendly.** HQPTuner rate menus write the **limit** only, as fixed friendly menus (`1x…32x` / `DSD64…DSD2048`) mapped to **48k-base member of each tier**. No Auto entry: limit slot has none, and naming the tier reach same outcome.

**Forced on every write (HQPTuner policy).** `auto_family=1`, `samplerate=0`, `bitrate=0` merged into every `/restore` payload (`FORCED_CONFIG`, `lanes/http/restore.py`). Not exposed in UI, enforced on write only. Request slot pinned to `0` is **binding, not cosmetic**: config write have no source to take base family from, so writing it would send 44.1k material out at 48k base and override user's own `alsa_anydsd` / `net_anydsd` decision.

**LIVE pin the request slot, exactly as asked, opt-in.** `SetRate` is the only live rate setter. LIVE field `rate` carry the rate in Hz, `"0"` clearing the pin; `lanes/live/rate` join it to the `RatesItem` index of the running list, and refuse a rate that list lack, any rate in `[source]` (engine ignore it there), and `rate` beside any other field (mode and filter both swap the rate list). No family member chosen for the user and no source rerouted to the other base: the pin is the exact Hz tapped.

Store send it only while Allow pinned rates is on (`store/live/pin.js`, preference in `store/ui/prefs.js`), and turning that preference off clear a standing pin. Pending buffer refuse `rate` (`writer.stageable_live_settings`), so a staged raw index cannot skip the join. Pin never reach `overrides.live_overrides`: it sit in the fixed slot, not the limit, so Output tab Rate box never show it and Save never persist it.

**HQPTuner keep no memory of the pin.** `lanes/live/lane` record nothing for it, so once a mode switch clear it on the engine (`docs/spec/protocol.md` "SetRate / GetRates") nothing put it back, and `store/live/pin.js` read it off `State` joined to the running rates list rather than hold it. No saved snapshot hold it (`snapshot.live_state` never read it). Config file's fixed slot stay forced to `0` (`FORCED_CONFIG`), so a daemon restart drop it too.

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

**Optimal ISO lossy-form field (6.0.4).** `volume_fixed` the one owned setting whose XML domain wider than widget hqplayerd render for it. Consequences, both load-bearing:

- **Write.** `2` (−6 dB) writable **only because persistent lane is `POST /restore` with surgically-edited config XML**, not `/config` form POST — form submit cannot carry third state. Lane edit **running** working config (`hqplayerd.xml`) with staged edits and push that (`presetzip.restore_zip_from_running`). `volume_fixed="2"` written this way read back as `2` from a fresh `/backup`, with no collateral config changes. If persistent lane ever revert to form-posting, −6 dB silently become unwritable (`tests/apply/test_file_config.py` fail in that case, by design).
- **Read.** Form report only bool, so `1` and `2` indistinguishable there. Baseline come instead from `manager.file_config` — running config parsed from `/backup` archive's working `hqplayerd.xml`, served on `GET /api/config` as `file`, preferred by frontend schema entries flagged `fileTruth`. Refreshed on connect and by apply's verify step; never per poll (archive ~5 MB).

HQPTuner therefore expose it as three-way control (Off · −3 dB · −6 dB) rather than tri-state checkbox HQPlayer Desktop use.

## System

| Control | Lane | Evidence / notes |
|---|---|---|
| CUDA offload | file (restore) | `<engine cuda>` (`0`/`1`/`convolution`) — **not** on `/config` form |
| Multicore DSP | file (restore) | `<engine multicore>` (`auto`/`0`/`1`) |
| E-core allocation | file (restore) | `<engine ecores>` (`default`/`pool`/`filter`) |
| Blocks/cycle | file (restore) | `<engine nblocks>` (int, `0`=default) |
| CUDA device ids | file (restore) | `<engine cuda_dev>` / `<engine cuda_cdev>` (int, `-1`=automatic) — GPU used for filters/general DSP and one used for convolution; different values split workload across two cards (manual §4.7) |
| Pre-process before metering | http | field `pre_before_meter` (checkbox) → `<engine pre_before_meter>` |
| Backup/restore config | http | daemon's own `/backup/settings.zip` (GET) / `/restore` (multipart POST, Digest auth) |
| Trial/license/version | read-only | `GetLicense` (`valid`/`name`/`fingerprint`) / `GetInfo` (4321), verified |
| Enable log / log path | http | fields `log_enabled` (checkbox) / `log_file` (text), verified |
| Live log tail | n/a | file/journal stream, not daemon setting |

`<engine>` settings above reachable only by editing config XML in `/backup` archive and pushing with `POST /restore` — daemon's configuration model and behavior of each write route in `docs/spec/protocol.md` "HTTP configuration routes (port 8088)".

## Additional live controls on the wire

| Command | Status | Notes |
|---|---|---|
| `SetJunkFilter` | live, verified | index domain; index 1 = 20k set both `filter_junk` and `filter_20k` state flags |
| `SetConvolution` | out of scope | setter exists, but standalone convolution-engine access is redundant with the matrix engine's capabilities |