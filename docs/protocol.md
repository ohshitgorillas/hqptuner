# HQPlayer Control API — Protocol Reference

Derived from the official `hqp-control` 6.0.1 source (signalyst.eu, `hqp-control-601-src.zip`), MIT-licensed, © 2011–2026 Jussi Laako. File revision: `$Id: 13554 2026-03-02$`, Qt client classes `clControlInterface` / `clControlApplication`. Empirical results verified against a live hqplayerd 6.0.4 (Opal) are folded in and marked **verified**.

This document is the **wire truth** for the commands HQPTuner needs: settings, status, enumerations, volume, configuration, and daemon identity. The normative rules that follow from it — enumeration volatility, the index/ID domain split, live-vs-file divergence — are stated once in `docs/architecture.md` §2 and are not repeated here. Per-field lane assignments live in `docs/settings-classification.md`.

## 1. Transport and framing

- **Connection:** single TCP connection to port **4321** (default). The client sets `SO_KEEPALIVE`, `TCP_KEEPCNT=3`, `TCP_KEEPINTVL=10`, and IP TOS 32.
- **Requests:** each request is a complete XML document written to the socket, prefixed with the standard declaration:

  ```xml
  <?xml version="1.0" encoding="UTF-8"?><GetInfo/>
  ```

  Most commands are a single (empty or attributed) element; there is no request framing beyond the XML document itself.
- **Responses:** the daemon sends newline-terminated XML documents. The reference client splits its receive buffer on `\n` and feeds each line to a streaming XML parser; a document-end resets the parser state, and a premature-end-of-document error means "keep reading, more data is coming". Practical consequence: read until a complete document parses, treating `\n` as the flush hint.
- **Application keep-alive:** a single ASCII space (`" "`) written to the socket. The daemon tolerates inter-document whitespace. **Verified**: a fully idle connection (no traffic at all) is closed by the daemon after ~156 s (clean EOF; single sample). Any traffic resets the idle timer, so a client that polls `State`/`Status` more often than ~150 s never needs the explicit keep-alive byte; a client that idles longer must send the space (or any command) under that window.
- **Attribute escaping quirk:** string attribute values (names, metadata) can arrive entity-escaped a second time; the reference client manually replaces `&lt; &gt; &amp; &quot; &apos;` *after* XML parsing. Conversely, hqpexporter has observed *unescaped* `&` in metadata attributes breaking strict parsers. Be lenient in both directions.
- **Binary interludes:** a `LibraryPicture` response with `size > 0` is followed by exactly `size` bytes of raw image data, *not* XML. Out of scope for HQPTuner, but a client must never assume the stream is XML-only if it issues that command.
- **Startup delay** (**verified**): port 4321 accepts and answers `GetInfo` 9.3 s after `systemctl restart hqplayerd` — connections are refused until then, and there is no accept-then-hang window (TCP accept and first response were simultaneous). Reconnect logic must tolerate a ~10 s refused-connection window after any daemon restart.
- **Settings persistence** (**verified**): settings changed via the Control API live in memory only. hqplayerd does **not** write them to `hqplayerd.xml` — not while running and not at shutdown (md5-identical config file across a `systemctl stop` with an unsaved filter change in memory). A restart reverts all Control API changes to whatever `hqplayerd.xml` contains. A full service restart (`systemctl restart`) also resets the **active configuration** to `[default]` (the unnamed base = `hqplayerd.xml`) — the active-profile name is not persisted; only a `POST /config/profile/load` sets it (§3.6).

## 2. Discovery (UDP)

Optional. Request is an XML document sent as a UDP datagram to multicast `239.192.0.199` (IPv4) and `ff08::c7` (IPv6), port 4321:

```xml
<?xml version="1.0" encoding="UTF-8"?><discover>hqplayer</discover>
```

Each daemon replies with a datagram like:

```xml
<discover result="OK" name="friendly name" version="...">hqplayer</discover>
```

Sender address of the reply datagram is the daemon host.

## 3. Authentication — 4321 SessionAuthentication (not used by HQPTuner)

The `hqp-control` source carries a `SessionAuthentication` handshake (ECDH secp256r1 key exchange, HKDF-derived session key, ChaCha20Poly1305 payloads) gating `ConfigurationLoad`, `LibraryLoad`, and the `secure_uri` playlist variants. Every command in this document works **unauthenticated** without it.

**HQPTuner never performs this handshake**, for two reasons. The daemon rejects self-generated client signing keys (**verified** on 6.0.4: a freshly generated P-256 key returns `<SessionAuthentication result="Error">no info</SessionAuthentication>`; ten derivation candidates from the published source and on-disk auth data were all rejected — the key lives only in the closed Desktop Client). And it is unnecessary: everything HQPTuner needs, including preset switching, is reachable through the port-8088 HTTP interface with ordinary Digest auth (§3.5). The question is closed as "not needed"; consult the `hqp-control` source directly if the Desktop path ever matters.

## 3.5. Authentication — HTTP configuration interface (port 8088) — HQPTuner's mechanism

hqplayerd's built-in web server (default **port 8088**, the same one the stock configuration UI is served from) gates its configuration routes with **standard HTTP Digest authentication** — this is the auth surface HQPTuner uses.

- **Scheme (verified on 6.0.4):** `WWW-Authenticate: Digest realm="com.signalyst.hqplayer.embedded", qop="auth", algorithm=MD5` (a SHA-256 variant is also offered). Ordinary RFC 7616 Digest — any HTTP client library handles it (`curl --digest`, Python `requests` `HTTPDigestAuth`, etc.). Basic auth is rejected.
- **Credentials:** the management username/password provisioned by `hqplayerd -u <user> <pass>` (per-user) or `-s` (system), or via the `/auth` web page.
- **Stored digest = HTTP Digest HA1 (verified).** `hqplayerd-auth.xml` stores exactly the Digest HA1 for this realm: the `legacy` attribute = `MD5("<user>:com.signalyst.hqplayer.embedded:<pass>")`, and `digest` = `SHA-256(` same string `)`. No hidden salt. There is no reason for HQPTuner to read this file; the daemon validates Digest itself.

HQPTuner's use of these credentials is described in `docs/architecture.md` §3.

## 3.6. HTTP configuration routes (port 8088)

All routes are on the 8088 web server. Root `/` and the transport controls `/control?action=play|pause|stop|next|previous` are open (no auth); everything below requires Digest auth (§3.5). Field names below are the HTML form field names observed on a live 6.0.4 daemon.

| Route | Method | Purpose | Fields |
|---|---|---|---|
| `/config` | GET | Full persistent-settings form with current values + min/max/enum constraints baked into the HTML — the read side of persistent config (no need to parse `hqplayerd.xml` for current values) | — |
| `/config` | POST | Apply all persistent settings; the daemon writes `hqplayerd.xml` itself and restarts. **Submit the complete form** (submission contract below). *HQPTuner does not use this route — see the note under the table.* | see below |
| `/config/refresh` | GET | Re-scan output devices — **verified**: the "Refresh devices" button is a submit inside a `method="get"` form (`formaction="/config/refresh"`), so it is a bare `GET` with no body. A `POST` to this route hangs (unhandled). After it, re-read `/config` to pick up a now-present endpoint. | — |
| `/config/profile/load` | POST | Switch to a named configuration | `profile=<name>` |
| `/config/profile/save` | POST | Create/overwrite a named configuration from current settings | `profile_name=<text>` |
| `/config/profile/delete` | POST | Delete the selected configuration | `profile=<name>` |
| `/backup/settings.zip` | GET | Full settings archive (zip): base `hqplayerd.xml` + every preset snapshot under `data/cfgs/` + library. **⚠ Returns empty after a named `profile/load` — see the daemon-bug note below** | — |
| `/restore` | POST | Restore a settings archive; **multipart/form-data**, self-restarts the daemon | `scope` (`system`/`user`), `cfgfile` (zip or xml), `libfile` (xml) |
| `/matrix`, `/matrix/{load,save,delete,plot}` | POST | Matrix form lane — see `docs/matrix-spec.md` | — |
| `/speakers` | POST | Speaker processing form (~3 s engine reload) | — |
| `/input`, `/library`, `/convolution`, `/log`, `/about`, `/auth`, `/key` | GET | Other stock UI pages | — |

> **HQPTuner's persistent writes ride `POST /restore`, not `POST /config`.** The `/config` form cannot express every owned setting (`volume_fixed`'s third state, the `<engine>` hardware attributes), and its submission contract is hostile. HQPTuner fetches `/backup`, surgically edits the config XML, and pushes the archive. The `/config` contract below is documented because the daemon's own UI uses it and because a partial POST is a live footgun, not because HQPTuner calls it.

Observed `POST /config` field names (representative, not exhaustive — the live page is the authoritative source of the persistent-settings surface and its constraints): `title`, `backend` (`alsa`/`network`/`combo`), `mode` (`auto`/`pcm`/`sdm`), `volume_fixed`, `fixed_volume_enabled`, `fixed_volume`, `volume_max`, `volume_min`, `defaults_volume`, `gain_comp` (step 0.1), `adaptive_volume`, `playlist_album_gain`, `channels`, `fft_size` (128–16384), `idle_time` (**milliseconds**: 0=default, 10000=10 s, … 60000), `pipelines` (2–128), `net_anydsd` (= 48k DSD checkbox), `net_ipv6`.

**`POST /config` submission contract (verified on 6.0.4).** The Apply button is *nameless* (`<input formaction="/config" type="submit" value="Apply"/>`), so the browser sends no submit field — the route alone signals Apply. The form must be submitted **complete**: a partial POST (a subset of fields) is silently rejected — the daemon answers HTTP **200** with `Failed!` in the body and writes nothing. **Checkboxes** submit `name=1` (their `value` attribute) when checked and are **omitted** when unchecked; sending the HTML default `name=on` makes the daemon reject the whole form. Because a rejection is still HTTP 200, success cannot be inferred from the POST — it must be confirmed by reading `/config` back, and that readback must **poll**: right after the POST the daemon keeps serving the pre-restart form for a moment, then drops (~0.3 s) and returns (~3 s) serving the new config, so a single readback can catch the stale form and false-negative.

**`/config/profile/load` restarts the daemon** (**verified** on 6.0.4): the POST returned HTTP 200 immediately, then 4321 refused connections ~0.3 s later and answered `GetInfo` again ~3.4 s later. This is a lighter internal config-reload restart than a full `systemctl restart` (~9.3 s), but it is a restart — the Control API connection drops and must reconnect. After the load, `ConfigurationGet`/`ConfigurationList` report the loaded profile as `active`.

### Configuration model + `POST /restore` (**verified**, idle-gated probes on 6.0.4)

The daemon keeps a **working config** plus saved **snapshots** (`data/cfgs/<name>.xml`), all loaded into memory at startup. The lanes behave differently, which matters for reaching settings the `/config` form does not expose (the `<engine>` hardware-acceleration attributes `cuda`/`multicore`/`ecores`/`nblocks` — manual §1.2):

- **`POST /config/profile/load`** copies a snapshot into the working config **from memory** — it does **not** re-read the snapshot file from disk. A disk edit followed by `load` has no effect. Only a full daemon restart re-reads disk. **Side effect (daemon bug):** a named `load` leaves `/backup/settings.zip` empty until a service restart — see the bug note below.
- **`POST /config`** writes the working file and **preserves** the active preset — it does *not* reset to `[default]`. Only a full `systemctl restart` drops the active label to `[default]`.
- **`POST /restore`** is HQPTuner's write path, for form-absent settings and for backup restore. Multipart form: `scope` (radio; `system` = the running config under `/etc/hqplayer`, `user` = `~/.hqplayer`), `cfgfile` (a `/backup` zip **or** a single config xml), optional `libfile`. **`scope=system`** writes the archive to disk and the daemon **self-restarts (~5.6 s** — lighter than `systemctl restart`'s 9.3 s, heavier than `profile/load`'s 3.4 s**), re-reading from disk. It lands the daemon on `[default]`:** the running config after a restore is `hqplayerd.xml`, and an edit to a root-renamed `<Profile>.xml` working member in the uploaded archive is **discarded**. `scope=user` did not affect the running config on Opal. The 200 response body is the HTML restore page — success is confirmed by a `/backup` readback, never by the POST.
- **Restore writes members additively.** A `data/cfgs/<name>.xml` in the uploaded zip is written to disk and appears in the daemon's native profile list; a member *omitted* from the zip is **not** removed (restore merges, it does not replace). A snapshot can be created or updated via restore but not deleted — deletion needs `profile/delete`, which works cleanly.

> **The working-config archive member is renamed by the active profile** (**verified**, healthy 4.69 MB archive). In a `/backup/settings.zip` the working config is the archive **root-level** XML. It is named `hqplayerd.xml` **only when `[default]` (unnamed) is active**; a **named** active profile renames it to `<Profile>.xml` at the root (observed: `Speakers` active → root `Speakers.xml`, byte-identical to `data/cfgs/Speakers.xml`, **no `hqplayerd.xml` at all**). This is distinct from the empty-backup bug below — the archive is complete, just the root member is renamed. Any code that reads or rewrites "the working config" must resolve the member as *hqplayerd.xml-or-the-sole-root-XML-or-the-one-matching-the-active-profile-label* (`engineconf.running_config_name`), never assume the literal `hqplayerd.xml`. The label is the **daemon's** active profile (`ConfigurationGet`, kept as `ConnectionManager.active_config`), not HQPTuner's preset store. Without it an archive carrying several root-level XMLs resolves to nothing, which is indistinguishable from the empty-backup bug and is **not** cleared by a restart.

HQPTuner's engine-attribute write path (`hqptuner/conf/engineconf.py`, `manager.apply_engine`) is therefore: fetch `/backup`, surgically edit the `<engine>` tag (byte-faithful) in the base config plus the active (or all) snapshot, `POST /restore` `scope=system`, verify by reading the `<engine>` tag back from a fresh `/backup`.

### DAEMON BUG — `profile/load` empties `/backup/settings.zip` (6.0.4)

**Confirmed deterministic on Opal (engine 6.0.4, version 6, Linux).** After `POST /config/profile/load` with a **named** configuration, `GET /backup/settings.zip` returns an empty archive — **160 bytes, a single bare `data/` entry** (no `hqplayerd.xml`, no `data/cfgs/*.xml`) — instead of the normal ~4.69 MB / 23-entry archive. State persists indefinitely; only a **service restart** (`systemctl restart hqplayerd`) restores generation.

Isolation matrix (each trial from a clean service restart, backup verified healthy first, one action, re-check):

| Action | `settings.zip` after |
|---|---|
| idle / Control-API (4321) setting change | healthy |
| `POST /config` (self-restarts) | healthy |
| `POST /restore` `scope=system` (self-restarts) | healthy |
| `profile/load` → **named** preset (×3) | **BROKEN, 3/3** |
| `profile/load` → `[default]` (empty name) | healthy |

So it is **not** a restart side effect (`/config` and `/restore` both restart and stay healthy) — it is specific to loading a *named* profile. Scope is `settings.zip` **only**: `GET /backup/library.xml` still returns 200 afterward. Not a path redirection either — marker files placed in both the home data dir and a preset's own subdir appear in a healthy archive and in **neither** case in the broken one, so the archive is genuinely empty, not pointed elsewhere. Nothing is logged; config, playback and presets are unaffected. Reported to Signalyst.

**Workaround (`manager.backup_or_cached`, remove when fixed):** the snapshots inside `/backup` do not change across a `profile/load`, and `POST /restore`'s restart **recovers** backup generation. HQPTuner caches the last healthy archive, warms that cache **before** a switching load (`apply()` with `switch_to`), and falls back to it when the live `/backup` comes back empty; the subsequent `/restore` both applies the edit and heals the daemon. `http.restore.verify` still reads the **live** `/backup` (healthy post-restore) so verification is never against stale cache.

### Preset system — HQPTuner-owned (**verified**, idle-gated REST-driven probes on 6.0.4)

hqplayerd's named-profile subsystem is unreliable enough that HQPTuner does **not** use `profile/load` or `profile/save` for its preset feature. The disqualifying findings, all reproduced live:

- **`profile/save` to an existing profile is a silent no-op.** The `/config` profile form carries a `profile` select (existing profiles) *and* a `profile_name` text box (save-as-new). A `save` whose `profile_name` already exists neither errors nor updates `data/cfgs/<name>.xml` — HTTP 200, snapshot unchanged. So "Apply & Save" never persisted to a named preset: the edit landed in the working config (live), the snapshot kept its old value, and the next load reverted it.
- **`POST /restore scope=system` lands the daemon on `[default]`** and discards an edit to a root-renamed working member (see the configuration model above). Restore is the one reliable write primitive, but it is `[default]`-centric.
- **A named `profile/load` empties `/backup`** (bug note above).

HQPTuner's model is described in `docs/architecture.md` §7; the daemon's `data/cfgs` is kept mirrored so its native web UI stays populated, but is never HQPTuner's load/save path.

## 4. Response conventions

- **Simple commands** (setters, transport actions): the daemon echoes the command element with a `result` attribute — `"OK"` or `"Error"`. On error, the element text carries a reason message. **Verified** on 6.0.4:

  ```xml
  <SetFilter result="OK"/>
  <SetFilter result="Error">invalid filter</SetFilter>
  <SetBogusCommand result="Error">Unknown command</SetBogusCommand>
  <ConfigurationLoad result="Error">missing data or not authorized</ConfigurationLoad>
  ```

  The connection is never dropped on an error — even unknown command elements get an echoed error response.

- **Enumeration queries** return a container element holding zero or more item elements; the container's end tag marks completion:

  ```xml
  <GetFilters>
    <FiltersItem index="0" name="..." value="0" arg="1" description="..."/>
    ...
  </GetFilters>
  ```

- **Item field semantics** (**verified**): `index` is the list position (display order); `value` is the numeric enumeration ID; `name` is the human label. `Set*` commands and `State` responses use the **list index**, NOT the enum ID — verified live: `<SetFilter value="6"/>` selected poly-sinc-lp (index 6; enum ID 6 is poly-sinc-lp-2s), `<SetShaping value="5"/>` selected ASDM5EC (index 5; enum ID 5 is ASDM5). The enum ID (`value` attr) appears in the enumeration lists and in `hqplayerd.xml` (verified: the file stores e.g. `filter="40"` = poly-sinc-gauss-long's enum ID). An XML-lane implementation must translate ID↔index via the live enumeration lists; the two domains must never be mixed (`architecture.md` §2).

## 5. Command index

Covered in §6: `GetInfo`, `GetLicense`, `State`, `Status`, `SetMode`/`GetModes`, `SetFilter`/`GetFilters`, `SetShaping`/`GetShapers`, `SetRate`/`GetRates`, `SetJunkFilter`/`GetJunkFilters`, `SetConvolution`, `SetAdaptiveVolume`, `Volume`/`VolumeUp`/`VolumeDown`/`VolumeMute`/`VolumeRange`, `ConfigurationList`/`ConfigurationGet`/`ConfigurationLoad`, `GetInputs`, `GetTransport`, `Reset`.

Matrix commands (`MatrixListProfiles`, `MatrixGetProfile`, `MatrixSetProfile`) are documented in `docs/matrix-spec.md`. Everything else the daemon speaks is playback, library and playlist surface — out of HQPTuner's scope (§8).

## 6. Commands

### GetInfo

Request: `<GetInfo/>` Response attributes: `name` (friendly name), `product`, `version`, `platform`, `engine`. **Verified** on 6.0.4:

```xml
<GetInfo engine="6.0.4" name="Opal" platform="Linux" product="Signalyst HQPlayer Embedded" version="6"/>
```

(`version` is the major version; `engine` carries the full **engine** version string, which Signalyst numbers separately from the release — a 6.0.2 install reports `engine="6.0.4"`. Attribute set on hqplayerd 5.x unverified.)

**Installed release number** (**verified** on 6.0.2): no Control API command carries it. UDP discovery (§2) answers `version="Signalyst HQPlayer Embedded 6"` — major only (probe: `scripts/probes/probe_discover_version.py`). The sole wire source is the 8088 web interface's `GET /about` page, not credential-gated, which prints the release under a `Version` heading: `<h3>Version</h3>` followed by the bare number (`6.0.2`) on its own line. `engine/release.py` reads it there.

### GetLicense

Request: `<GetLicense/>` Response attributes: `valid` (0/1), `name` (licensee), `fingerprint`. Read-only license/trial display comes from here.

### State

Request: `<State/>` The single-shot settings snapshot — HQPTuner's primary readback command. All settings attributes report **list indices** into the corresponding enumeration lists (**verified** — see §4), not enum IDs. Response attributes (all on the `State` element):

| Attribute | Type | Meaning |
|---|---|---|
| `state` | int | 0 stopped, 1 paused, 2 playing, 3 stop requested |
| `mode` | int | configured mode (`ModesItem` index: 0 = [source], 1 = PCM, 2 = SDM — **verified**) |
| `filter` | int | configured filter (list index; legacy single-filter field, observed tracking the most recently set of 1x/Nx) |
| `filter1x` | int, optional | configured 1x filter (list index; newer engines) |
| `filterNx` | int, optional | configured Nx filter (list index; newer engines) |
| `shaper` | int | configured dither/modulator (list index) |
| `rate` | int | configured output rate (`RatesItem` index; 0 = auto/source-based — **verified**) |
| `volume` | double | volume, dB |
| `active_mode` | uint | currently active mode |
| `active_rate` | uint | currently active output rate |
| `convolution` | 0/1 | convolution engaged |
| `repeat` | int | 0 none, 1 single, 2 all |
| `random` | 0/1 | shuffle |
| `adaptive` | 0/1 | adaptive volume |
| `filter_junk` | int | junk (20 kHz) filter setting |
| `matrix_profile` | string | active matrix profile name |

`filter1x`/`filterNx` are checked with `hasAttribute` by the client — treat as optional and fall back to `filter`.

### Status

Request: `<Status subscribe="0"/>` — one-shot. `subscribe="1"` puts the connection into push mode: the daemon sends `Status` documents without further requests. Observed on a **stopped/idle** daemon (**verified**): an initial burst of ~2 frames on subscribe, then silence — no periodic push, and a settings change made on another connection did **not** trigger a push. During **active playback** (**verified**): steady push at ~1–2 Hz (measured 11 frames in 8 s), each a fixed ~1 KB `Status` document carrying the full attribute set plus the `metadata` child. Push cadence is playback-tied. **HQPTuner polls one-shot `State`/`Status`** rather than relying on subscribe — polling is mode-independent and gives the same heartbeat. If subscribe is ever used, note the parser must match the closing `</Status>` (not the first self-closing `/>`, which is the `metadata` element).

Response attributes (superset):

- Playback: `state`, `track`, `track_id`, `min`, `sec`, `tracks_total`, `track_serial`, `transport_serial`, `queued`, `position`, `length`, `begin_min`, `begin_sec`, `remain_min`, `remain_sec`, `total_min`, `total_sec`
- Settings/DSP: `volume`, `clips`, `output_delay` (samples), `apod` (apodizing event counter), `active_mode` (string), `active_filter` (string name), `active_shaper` (string name), `active_rate`, `active_bits`, `active_channels`, `filter_junk`, `correction` (0/1), `random`, `repeat`
- Load: `input_fill`, `output_fill` (0.0–1.0), `process_speed` (× realtime)

Note the type split: `State` reports settings as numeric list indices, `Status` reports the *active* filter/shaper/mode as display strings (**verified**: `State filterNx="72"` ↔ `Status active_filter="sinc-Lh"`, list index 72).

Optional child element `<metadata .../>` (present when a track is loaded) with attributes: `uri` (or `secure_uri` + `nonce` when authenticated), `mime`, `artist`, `composer`, `performer`, `album`, `song`, `genre`, `date`, `albumartist`, `track_id`, `samplerate`, `bits`, `channels`, `float`, `sdm`, `bitrate`, `features`, `extrainfo`, `gain`.

### SetMode / GetModes

- `<SetMode value="N"/>` — N is the `ModesItem` **list index** (**verified**: 0 = [source], 1 = PCM, 2 = SDM on 6.0.4). Response: result element.
- `<GetModes/>` → `<GetModes>` containing `<ModesItem index="i" name="PCM|SDM|..." value="v"/>`, closed by the container end tag. Verified list: `[source]` (value −1), `PCM` (value 0), `SDM (DSD)` (value 1).

Mode switching is **live** (**verified** while stopped: takes effect immediately, resets `rate` to 0/auto, and swaps the shaper/rate/filter enumeration lists — re-enumerate after every mode change). It is live **during playback** too (**verified** 2026-07-29, `scripts/probes/probe_rate_playing.py`, mid-stream from Roon): `State.mode` moves at once and audio resumes after a brief pause. `Status.active_rate` may settle somewhere new — a 44.1k source running at 705600 in `[source]` came back at 1411200 after a round trip through PCM — so a mode switch is not transparent to the output rate even when it is restored.

**`Status.active_mode` echoes `[source]`; it does not resolve** (**verified** 2026-07-29, same probe, playing 24/44.1 PCM): configured mode 0 reports `active_mode="[source]"`, not `PCM`. It names the family only once one is configured (mode 1 → `"PCM"`). To learn which family an engine in `[source]` actually settled on, read `Status.active_rate` and take its family.

### SetFilter / GetFilters

- `<SetFilter value="N"/>` with `value` alone sets **both** the 1x and Nx filters to N (**verified**: `filter`, `filter1x`, `filterNx` all changed). Optional second attribute `value1x="M"` splits them — `value` = Nx, `value1x` = 1x (**verified** live):

  ```xml
  <SetFilter value="12" value1x="30"/>
  ```

  Both numbers are **list indices** (§4). The reference client writes `value1x` only when the 1x argument is ≥ 0.
- `<GetFilters/>` → `<FiltersItem index name value arg description/>`*. `arg` is a flags bitfield: bit 0 (`0x00000001`) = apodizing. `description` is the engine's own description string, carrying quality/focus/ratio facets (e.g. `"5/5 timbre ⥣ Any"`) — merge with static metadata by `name`.

`GetFilters` returns the list for the **current mode** (**verified**: SDM mode → 77 filters, PCM mode → 67 filters including a leading "none" entry; indices shift between modes, so re-enumerate on mode switch).

### SetShaping / GetShapers

- `<SetShaping value="N"/>` — dither (PCM mode) or modulator (SDM mode); N is the list index (**verified**: 5 → ASDM5EC, index 5).
- `<GetShapers/>` → `<ShapersItem index name value/>`*. Mode-dependent (**verified**: SDM mode → 36 modulators, PCM mode → 10 dithers beginning "none", "NS1", "NS4", "NS5", "NS9", "LNS15" and ending "TPDF", "Gauss1", "shaped").

### SetRate / GetRates

- `<GetRates/>` → `<RatesItem index="i" rate="352800"/>`* — actual rates in Hz; index 0 is `rate="0"` = auto (source-based). Mode-dependent (**verified**: SDM mode → DSD rates 2.8–24.6 MHz, PCM mode → 44100–768000 Hz).
- `<SetRate value="N"/>` — N is the **`RatesItem` index** (**verified**: `value="7"` in SDM mode activated 22579200 Hz, index 7; takes effect immediately even while stopped). Sending the **Hz value instead is accepted and silently ignored** (**verified** 2026-07-29, `scripts/probes/probe_rate_hz.py`): in PCM mode both `value="96000"` (a rate the list carries, index 4) and `value="12288000"` (DSD256, no index in the PCM list) returned `result="OK"` with `State.rate` unmoved at `"0"` — so `result="OK"` is no proof here either, and there is no wire form that pins a rate the running mode does not enumerate. HQPTuner sends the index of the tier's 48k member; with `auto_family="1"` the engine keeps 44.1k material in its own family under that pin (owner-observed, 2026-09-01), so no rate change ever needs a config write.
- **No rate is settable in `[source]` mode** (**verified** 2026-07-29, `scripts/probes/probe_rate_playing.py` then `scripts/probes/probe_rate_source_effect.py`, both mid-playback): with `mode="0"` and the running `GetRates` list carrying 705600 at index 9, `SetRate value="9"` returned `result="OK"` and left `State.rate` at `"0"`; `SetMode PCM` then made the identical index take (`State.rate="9"`) without stopping the transport. So **playback is not what blocks it — `[source]` is**, and every earlier rate measurement here was taken in an explicit mode. Confirmed on the OUTPUT rather than the slot, which is the reading that settles it: holding the mode at `[source]`, two requests for rates **below** what was playing (352800 then 176400, against a 44.1k source running at 1411200) each left `State.rate` at `"0"` **and** `Status.active_rate` unmoved after a full second to settle. `result="OK"` both times.
- **What governs the rate in `[source]` is the config limit, and no wire command reaches it.** `SetRate` writes the exact-rate slot (`samplerate`/`bitrate`); the limit is `defaults_samplerate`/`defaults_bitrate` (settings-classification.md §Rate slots), and in `[source]` — where the engine selects per stream, manual §4.4 — the limit is the only slot with any effect. The command inventory above carries no setter for it, so changing the rate in auto means a config write and the `/restore` restart that comes with it. Measured baseline for what the engine picks: entering `[source]` on a 44.1k source with the limit at 1536000 settled on 1411200, the highest the 44.1 family offers under that limit — auto picks the top of what the limit and the device allow, not a fixed multiplier.
- **The pin is single, and `SetMode` clears it** (**verified** 2026-07-28, `scripts/probes/probe_mode_rate_pin.py`): pinned index 1 (2822400 Hz) in SDM; `SetMode` PCM → `State.rate="0"`; pinned index 1 (44100 Hz) there; `SetMode` back to SDM → `State.rate="0"`, the SDM pin gone. The daemon's two form fields (`samplerate`, `bitrate`) do not imply two live slots — the engine keeps one and drops it on every mode switch, so `State.rate` answers only for the family currently running and only until the next `SetMode`.

### SetJunkFilter / GetJunkFilters

- `<SetJunkFilter value="N"/>` — the 20 kHz junk filter. Note: the CLI usage text advertises `--set-20kfilter` but the parser only accepts `--set-junkfilter`; the wire element is `SetJunkFilter` either way.
- `<GetJunkFilters/>` → `<JunkFiltersItem index name value/>`*.

### SetConvolution / SetAdaptiveVolume

Boolean setters, `value="0|1"`:

```xml
<SetConvolution value="0"/>
<SetAdaptiveVolume value="1"/>
```

Watch the naming: the client method is `setAdaptive` but the wire element is `SetAdaptiveVolume`, and its response is a bare `<SetAdaptiveVolume/>` with no `result` attribute.

Caveat (**observed**): a setter can return `result="OK"` without the setting actually applying. Never trust `result="OK"` alone; confirm via `State` readback.

### Volume commands

- `<Volume value="-23.5"/>` — absolute volume in dB (double). Returns `result="Error"` (no reason text) when volume control is disabled, i.e. `VolumeRange` reports `enabled="0"` (**verified**); the level is left unchanged.
- `<VolumeUp/>`, `<VolumeDown/>`, `<VolumeMute/>` — stepped/toggle, no attributes.
- `<VolumeRange/>` → `<VolumeRange min="-60" max="0" enabled="1" adaptive="0"/>` — `min`/`max` doubles (dB), `enabled` = volume control enabled, `adaptive` = adaptive volume active. This is the source for volume-slider bounds.

### Configuration profiles

- `<ConfigurationList/>` → container with `active="name"` attribute and `<ConfigurationItem name="..."/>` per profile.
- `<ConfigurationGet/>` → `<ConfigurationGet value="activename"/>`.
- `<ConfigurationLoad value="..." nonce="..."/>` — switches profile; the value is the ChaCha20Poly1305-encrypted profile name and **requires an authenticated session** (§3), so it is unavailable to HQPTuner. The HTTP route `/config/profile/load` (§3.6) does the same job under Digest auth.

### GetInputs

`<GetInputs/>` → `<InputsItem name="..."/>`* — configured input names.

### GetTransport

`<GetTransport/>` → `<GetTransport value="N" arg="..."/>`. Transport type enum from the client header: 0 none, 1 CD, 2 FLAC, 3 DSD, 4 IFF, 5 audio, 6 WavPack, 7 MP3, 0xe0 raw, 0xe1 ffmpeg, 0xf0 playlist, 0xff noise. Read-only interest for HQPTuner (source display).

### Reset

`<Reset/>` — engine reset. Exact scope (playback engine vs settings) unverified; the CLI treats it as fire-and-forget.

## 7. Metering side channel

A separate binary TCP stream on **port 4321 + 1 = 4322**. The daemon streams unconditionally on bare accept — no control-channel enable command (**verified** 2026-07-28, `scripts/probes/probe_metering_stream.py`, hqplayerd on a 44.1k PCM source). One frame per transform hop (~43/s at 44.1k; hop = `xformLength − 1` samples). Layout (**verified** live, little-endian):

- Header, 32 bytes: `u32 version` (1), `u32 channels`, `u32 xformLength` (spectrum bins, N/2+1; observed 1025 → N=2048), `u32 transformBits` (observed 16), `f32 bandwidth` (Nyquist, Hz), `f32 transformTime` (s, = hop/rate), `f32 gain` (observed 2.0), `u32 reserved` (0).
- Per channel: `f32 peakMax, peak, rms, rmsMax` (dBFS), then `2 × xformLength` f32 transform values as **two consecutive halves** (reals then imaginaries, *not* interleaved pairs) — magnitude of bin `k` is `hypot(a[k], b[k])`, linear amplitude, bin `k` → `k · bandwidth / (xformLength − 1)` Hz.

Consumed at runtime by `hqptuner/engine/metering.py` (the junk-filter advisor's reader); `scripts/probes/probe_metering_stream.py` captures and decodes it standalone.

Because the daemon streams unconditionally and offers no way to ask for less, the socket is the only throttle a consumer has: at ~43 frames/s of `channels × (16 + 8 × xformLength)` bytes, an idle connection costs megabytes a second for frames nobody uses. The reader therefore holds the connection only while `State` reports playing (state 2) and closes it otherwise — invisible on loopback, but the difference between constant load and none once the traffic crosses a Docker bridge.

## 8. Out of scope

HQPTuner is a configurator, so the daemon's playback surface is not implemented: transport (`Play`, `Pause`, `Stop`, `Previous`, `Next`, `Backward`, `Forward`, `Seek`, `SelectTrack`, `PlayNextURI`, `LoadRemovable`), the `Playlist*` family, the `Library*` family, and `SetRepeat` / `SetRandom` / `SetDisplay` / `GetDisplay` / `SetTransport*`. Command spellings are in the `hqp-control` source.

Matrix editing was originally a non-goal and was un-cut on 2026-07-20; the `Matrix*` commands are the live profile-switch lane and are documented in `docs/matrix-spec.md`.

## 9. Open questions

Unverified against a live daemon. Everything else this document asserts has been checked.

1. `Reset` scope — what it resets (playback engine vs settings).
2. `GetInfo` full attribute set on hqplayerd 5.x.
3. `SetRate` Hz-form acceptance — returned `OK` at an ambiguous value; a discriminating test is needed if the Hz form is ever relied on.
5. Whether live setters behave differently during active playback — every spike ran with the engine stopped.
