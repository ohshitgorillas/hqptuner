# HQPlayer Control API — Protocol Reference

Derived from the official `hqp-control` 6.0.1 source (signalyst.eu, `hqp-control-601-src.zip`), MIT-licensed, © 2011–2026 Jussi Laako. File revision: `$Id: 13554 2026-03-02$`, Qt client classes `clControlInterface` / `clControlApplication`. Empirical results verified against a live hqplayerd 6.0.4 (Phase 0.2 spike runs on Opal) are folded in and marked **verified**.

This document covers the commands HQPTuner needs: settings, status, enumerations, volume, configuration, and daemon identity. Playback, library, and playlist commands are listed in the out-of-scope appendix only.

**Enumeration volatility (normative):** filter/shaper names and list ordering change across HQPlayer versions; the configuration file stores numeric enumeration IDs. The running engine's enumeration queries (`GetModes`, `GetFilters`, `GetShapers`, `GetRates`, `GetJunkFilters`) are the sole runtime authority for current names and IDs. See `outline.md` §2.

Items marked **verify empirically** could not be determined from the client source alone and are Phase 0.2 targets.

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
- **Startup delay** (**verified**): measured on Opal, port 4321 accepts and answers `GetInfo` 9.3 s after `systemctl restart hqplayerd` — connections are refused until then, and there is no accept-then-hang window (TCP accept and first response were simultaneous). Reconnect logic must tolerate a ~10 s refused-connection window after any daemon restart.
- **Settings persistence** (**verified**): settings changed via the Control API live in memory only. hqplayerd does **not** write them to `hqplayerd.xml` — not while running and not at shutdown (md5-identical config file across a `systemctl stop` with an unsaved filter change in memory). A restart reverts all Control API changes to whatever `hqplayerd.xml` contains, so live engine state and file state can diverge indefinitely. A full service restart (`systemctl restart`) also resets the **active configuration** to `[default]` (the unnamed base = `hqplayerd.xml`) — the active-profile name is not persisted; only a `POST /config/profile/load` sets it (§3.6).

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

## 3. Authentication — 4321 SessionAuthentication (HQPlayer Desktop Client's mechanism; NOT used by HQPTuner)

> **HQPTuner does not use this handshake.** It is documented here for completeness because it appears in the `hqp-control` source, but the daemon rejects self-generated client keys (see below), and everything HQPTuner needs — including preset switching — is reachable through the port-8088 HTTP interface with ordinary Digest auth (§3.5). Treat this section as reference for the Desktop Client's path only.

The CLI issues every command in this document **without authenticating** — plain commands need no session. `SessionAuthentication` establishes an encrypted session key required only for:

- `ConfigurationLoad` / `LibraryLoad` (the client refuses to send these without a session key)
- `secure_uri` / `secure_value` variants of `PlaylistAdd` / `PlayNextURI` (plain `uri` works unauthenticated)

Handshake: client sends its ECDH (secp256r1) public key signed with a client signing key (SHA-256), the server replies with its own signed ECDH public key (signature verified against a hardcoded HQPlayer Ed25519 public key), both derive a 32-byte session key via `HKDF(SHA-256)`; payloads are then `ChaCha20Poly1305`-encrypted with per-message 12-byte nonces, base64-encoded.

```xml
<SessionAuthentication client_id="appid" public_key="base64..." signature="base64..."/>
```

Response: `SessionAuthentication` element with `public_key`, `signature`, `nonce`, `version` (encrypted) attributes.

The daemon does **not** accept arbitrary self-generated client signing keys (**verified** on 6.0.4): a `SessionAuthentication` with a freshly generated P-256 key is rejected `<SessionAuthentication result="Error">no info</SessionAuthentication>`. The server verifies the client's ECDSA signature against a key it already holds, and that key is **not** derivable from the published `hqp-control` source or the on-disk auth data (ten derivation candidates tried against the live daemon, all rejected). `authenticate()` in the source takes a PKCS8 signing key + passphrase but is never called by the CLI, so the derivation is not shown — it lives only in the closed HQPlayer Desktop Client.

**This is moot for HQPTuner.** The 4321 `ConfigurationLoad` crypto path is not the only way to switch configurations — the port-8088 HTTP interface (§3.5) does it with plain Digest auth, so HQPTuner never performs this handshake. The self-generated-key question is closed as "not needed."

## 3.5. Authentication — HTTP configuration interface (port 8088) — HQPTuner's mechanism

hqplayerd's built-in web server (default **port 8088**, the same one the stock configuration UI is served from) gates its configuration routes with **standard HTTP Digest authentication** — this is the auth surface HQPTuner uses.

- **Scheme (verified on 6.0.4):** `WWW-Authenticate: Digest realm="com.signalyst.hqplayer.embedded", qop="auth", algorithm=MD5` (a SHA-256 variant is also offered). Ordinary RFC 7616 Digest — any HTTP client library handles it (`curl --digest`, Python `requests` `HTTPDigestAuth`, etc.). Basic auth is rejected.
- **Credentials:** the management username/password provisioned by `hqplayerd -u <user> <pass>` (per-user) or `-s` (system), or via the `/auth` web page. Verified: the live management credential returns HTTP 200 on `/config`.
- **Stored digest = HTTP Digest HA1 (verified).** `hqplayerd-auth.xml` stores exactly the Digest HA1 for this realm, reproduced bit-for-bit: the `legacy` attribute = `MD5("<user>:com.signalyst.hqplayer.embedded:<pass>")`, and `digest` = `SHA-256(` same string `)`. No hidden salt — this is the earlier "salted digest" mystery, resolved. (There is no reason for HQPTuner to read this file; the daemon validates Digest itself.)

**Client-design consequence:** HQPTuner is credential-gated by a **login screen** collecting the HQPlayer management username/password, which the backend then uses for HTTP Digest auth against the 8088 interface (holding the credential server-side). Read-only use and all live (4321) settings work without it; only the persistent-config write lane and preset switching (§3.6) require the login. See outline §3/§7.

## 3.6. HTTP configuration routes (port 8088)

All routes are on the 8088 web server. Root `/` and the transport controls `/control?action=play|pause|stop|next|previous` are open (no auth); everything below requires Digest auth (§3.5). Field names below are the HTML form field names observed on a live 6.0.4 daemon.

| Route | Method | Purpose | Fields |
|---|---|---|---|
| `/config` | GET | Full persistent-settings form with current values + min/max/enum constraints baked into the HTML — the read side of persistent config (no need to parse `hqplayerd.xml` for current values) | — |
| `/config` | POST | Apply all persistent settings; the daemon writes `hqplayerd.xml` itself and restarts. **Submit the complete form** (submission contract below) | see below |
| `/config/refresh` | POST | Re-scan output devices | — |
| `/config/profile/load` | POST | Switch to a named configuration | `profile=<name>` |
| `/config/profile/save` | POST | Create/overwrite a named configuration from current settings | `profile_name=<text>` |
| `/config/profile/delete` | POST | Delete the selected configuration | `profile=<name>` |
| `/backup`, `/restore` | GET/POST | Config backup / restore | — |
| `/input`, `/library`, `/speakers`, `/convolution`, `/matrix`, `/log`, `/about`, `/auth`, `/key` | GET | Other stock UI pages (per-config device page, logs, etc.) | — |

Observed `POST /config` field names (representative, not exhaustive — the live page is the authoritative source of the persistent-settings surface and its constraints): `title`, `backend` (`alsa`/`network`/`combo`), `mode` (`auto`/`pcm`/`sdm`), `volume_fixed`, `fixed_volume_enabled`, `fixed_volume`, `volume_max`, `volume_min`, `defaults_volume`, `gain_comp` (step 0.1), `adaptive_volume`, `playlist_album_gain`, `channels`, `fft_size` (128–16384), `idle_time` (**milliseconds**: 0=default, 10000=10 s, … 60000), `pipelines` (2–128), `net_anydsd` (= 48k DSD checkbox), `net_ipv6`.

**`POST /config` submission contract (verified on 6.0.4, the hard way).** The Apply button is *nameless* (`<input formaction="/config" type="submit" value="Apply"/>`), so the browser sends no submit field — the route alone signals Apply. The form must be submitted **complete**: a partial POST (a subset of fields) is silently rejected — the daemon answers HTTP **200** with `Failed!` in the body and writes nothing. So an apply overlays the staged changes onto a fresh `GET /config` and re-submits every field. **Checkboxes** submit `name=1` (their `value` attribute) when checked and are **omitted** when unchecked; sending the HTML default `name=on` makes the daemon reject the whole form. Because a rejection is still HTTP 200, success cannot be inferred from the POST — it must be confirmed by reading `/config` back, and that readback must **poll**: right after the POST the daemon keeps serving the pre-restart form for a moment, then drops (~0.3 s) and returns (~3 s) serving the new config, so a single readback can catch the stale form and false-negative.

The `/config/profile/load` select observed on Opal: `[default]` (empty `value=""` — the unnamed base configuration) plus `Headphones - DSD256`, `Headphones - DSD512`, `Office`, `Speakers`. This is the same profile set the 4321 `ConfigurationList` returns; the HTTP route is the writable path.

**`/config/profile/load` restarts the daemon** (**verified** on 6.0.4): the POST returned HTTP 200 immediately, then 4321 refused connections ~0.3 s later and answered `GetInfo` again ~3.4 s later. This is a lighter internal config-reload restart than a full `systemctl restart` (~9.3 s), but it is a restart — the Control API connection drops and must reconnect, and it routes through the same restart-resync path as `POST /config`. After the load, `ConfigurationGet`/`ConfigurationList` report the loaded profile as `active`.

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

- **Item field semantics** (**verified**): `index` is the list position (display order); `value` is the numeric enumeration ID; `name` is the human label. `Set*` commands and `State` responses use the **list index**, NOT the enum ID — verified live: `<SetFilter value="6"/>` selected poly-sinc-lp (index 6; enum ID 6 is poly-sinc-lp-2s), `<SetShaping value="5"/>` selected ASDM5EC (index 5; enum ID 5 is ASDM5). The enum ID (`value` attr) appears in the enumeration lists and in `hqplayerd.xml` (verified: the file stores e.g. `filter="40"` = poly-sinc-gauss-long's enum ID). Consequence: an XML-lane implementation must translate ID↔index via the live enumeration lists; the two domains must never be mixed.

## 5. Command summary

| Command | Purpose | Request element | Response |
|---|---|---|---|
| GetInfo | daemon identity | `<GetInfo/>` | `GetInfo` attrs |
| GetLicense | license state | `<GetLicense/>` | `GetLicense` attrs |
| State | full settings snapshot | `<State/>` | `State` attrs |
| Status | playback/DSP status | `<Status subscribe="0\|1"/>` | `Status` attrs + `metadata` child |
| SetMode / GetModes | PCM/SDM mode | `<SetMode value="N"/>` / `<GetModes/>` | result / `ModesItem`* |
| SetFilter / GetFilters | oversampling filter | `<SetFilter value="N" [value1x="M"]/>` / `<GetFilters/>` | result / `FiltersItem`* |
| SetShaping / GetShapers | dither/modulator | `<SetShaping value="N"/>` / `<GetShapers/>` | result / `ShapersItem`* |
| SetRate / GetRates | output rate | `<SetRate value="N"/>` / `<GetRates/>` | result / `RatesItem`* |
| SetJunkFilter / GetJunkFilters | 20 kHz junk filter | `<SetJunkFilter value="N"/>` / `<GetJunkFilters/>` | result / `JunkFiltersItem`* |
| SetConvolution | convolution on/off | `<SetConvolution value="0\|1"/>` | result |
| SetAdaptiveVolume | adaptive volume | `<SetAdaptiveVolume value="0\|1"/>` | result |
| Volume | absolute volume (dB) | `<Volume value="-20.5"/>` | result |
| VolumeUp / VolumeDown / VolumeMute | stepped volume | `<VolumeUp/>` etc. | result |
| VolumeRange | volume limits | `<VolumeRange/>` | `VolumeRange` attrs |
| ConfigurationList | list config profiles | `<ConfigurationList/>` | `ConfigurationItem`* + `active` |
| ConfigurationGet | active config name | `<ConfigurationGet/>` | `ConfigurationGet value` |
| ConfigurationLoad | switch config (auth req.) | `<ConfigurationLoad value nonce/>` | result |
| GetInputs | input list | `<GetInputs/>` | `InputsItem`* |
| GetTransport | active transport | `<GetTransport/>` | `GetTransport value arg` |
| Reset | engine reset | `<Reset/>` | result |

## 6. Commands

### GetInfo

Request: `<GetInfo/>`
Response attributes: `name` (friendly name), `product`, `version`, `platform`, `engine`. **Verified** on 6.0.4:

```xml
<GetInfo engine="6.0.4" name="Opal" platform="Linux" product="Signalyst HQPlayer Embedded" version="6"/>
```

(`version` is the major version; `engine` carries the full version string. Attribute set on hqplayerd 5.x still **verify empirically**.)

### GetLicense

Request: `<GetLicense/>`
Response attributes: `valid` (0/1), `name` (licensee), `fingerprint`. Read-only license/trial display comes from here.

### State

Request: `<State/>`
The single-shot settings snapshot — HQPTuner's primary readback command. Response attributes (all on the `State` element):

All settings attributes report **list indices** into the corresponding enumeration lists (**verified** — see §4 item field semantics), not enum IDs.

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

Request: `<Status subscribe="0"/>` — one-shot. `subscribe="1"` puts the connection into push mode: the daemon sends `Status` documents without further requests. Observed behavior on a **stopped/idle** daemon (**verified**): an initial burst of ~2 frames on subscribe, then silence — no periodic push, and a settings change made on another connection did **not** trigger a push. During **active playback** (**verified**): steady push at ~1–2 Hz (measured 11 frames in 8 s), each a fixed ~1 KB `Status` document carrying the full attribute set plus the `metadata` child. So push cadence is playback-tied — silent when stopped, ~1–2 Hz when playing. Practical guidance: HQPTuner should **poll one-shot `State`/`Status`** rather than rely on subscribe — polling is mode-independent (works whether or not anything is playing) and gives the same heartbeat. If subscribe is used, note frames are full ~1 KB documents and the `Status` element wraps a `metadata` child during playback, so the parser must match the closing `</Status>` (not the first self-closing `/>`, which is the metadata element).

Response attributes (superset; hqpexporter already maps most):

- Playback: `state`, `track`, `track_id`, `min`, `sec`, `tracks_total`, `track_serial`, `transport_serial`, `queued`, `position`, `length`, `begin_min`, `begin_sec`, `remain_min`, `remain_sec`, `total_min`, `total_sec`
- Settings/DSP: `volume`, `clips`, `output_delay` (samples), `apod` (apodizing event counter), `active_mode` (string), `active_filter` (string name), `active_shaper` (string name), `active_rate`, `active_bits`, `active_channels`, `filter_junk`, `correction` (0/1), `random`, `repeat`
- Load: `input_fill`, `output_fill` (0.0–1.0), `process_speed` (× realtime)

Note the type split: `State` reports settings as numeric list indices, `Status` reports the *active* filter/shaper/mode as display strings (**verified**: `State filterNx="72"` ↔ `Status active_filter="sinc-Lh"`, list index 72).

Optional child element `<metadata .../>` (present when a track is loaded) with attributes: `uri` (or `secure_uri` + `nonce` when authenticated), `mime`, `artist`, `composer`, `performer`, `album`, `song`, `genre`, `date`, `albumartist`, `track_id`, `samplerate`, `bits`, `channels`, `float`, `sdm`, `bitrate`, `features`, `extrainfo`, `gain`.

### SetMode / GetModes

- `<SetMode value="N"/>` — N is the `ModesItem` **list index** (**verified**: 0 = [source], 1 = PCM, 2 = SDM on 6.0.4). Response: result element.
- `<GetModes/>` → `<GetModes>` containing `<ModesItem index="i" name="PCM|SDM|..." value="v"/>`, closed by the container end tag. Verified list: `[source]` (value −1), `PCM` (value 0), `SDM (DSD)` (value 1).

Mode switching is **live** (**verified** while stopped: takes effect immediately, resets `rate` to 0/auto, and swaps the shaper/rate/filter enumeration lists — re-enumerate after every mode change). Behavior during active playback still unobserved.

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
- `<SetRate value="N"/>` — N is the **`RatesItem` index** (**verified**: `value="7"` in SDM mode activated 22579200 Hz, index 7; takes effect immediately even while stopped). Sending the Hz value also returned `result="OK"` but was indistinguishable in that test — use the index form.

### SetJunkFilter / GetJunkFilters

- `<SetJunkFilter value="N"/>` — the 20 kHz junk filter. Note: the CLI usage text advertises `--set-20kfilter` but the parser only accepts `--set-junkfilter`; the wire element is `SetJunkFilter` either way.
- `<GetJunkFilters/>` → `<JunkFiltersItem index name value/>`*.

### SetConvolution / SetAdaptiveVolume

Boolean setters, `value="0|1"`:

```xml
<SetConvolution value="0"/>
<SetAdaptiveVolume value="1"/>
```

Watch the naming: the client method is `setAdaptive` but the wire element is `SetAdaptiveVolume`.

Caveat (**observed**): a setter can return `result="OK"` without the setting actually applying. Do not trust `result="OK"` alone; always confirm via `State` readback.

### Volume commands

- `<Volume value="-23.5"/>` — absolute volume in dB (double). Returns `result="Error"` (no reason text) when volume control is disabled, i.e. `VolumeRange` reports `enabled="0"` (**verified**); the level is left unchanged.
- `<VolumeUp/>`, `<VolumeDown/>`, `<VolumeMute/>` — stepped/toggle, no attributes.
- `<VolumeRange/>` → `<VolumeRange min="-60" max="0" enabled="1" adaptive="0"/>` — `min`/`max` doubles (dB), `enabled` = volume control enabled, `adaptive` = adaptive volume active. This is the source for volume-slider bounds.

### Configuration profiles

hqplayerd supports named configuration profiles; potentially relevant to outline §7 presets.

- `<ConfigurationList/>` → container with `active="name"` attribute and `<ConfigurationItem name="..."/>` per profile.
- `<ConfigurationGet/>` → `<ConfigurationGet value="activename"/>`.
- `<ConfigurationLoad value="..." nonce="..."/>` — switches profile; the value is the ChaCha20Poly1305-encrypted profile name and **requires an authenticated session** (§3). Without solving the client-key question this command is unavailable to HQPTuner.

### GetInputs

`<GetInputs/>` → `<InputsItem name="..."/>`* — configured input names.

### GetTransport

`<GetTransport/>` → `<GetTransport value="N" arg="..."/>`. Transport type enum from the client header: 0 none, 1 CD, 2 FLAC, 3 DSD, 4 IFF, 5 audio, 6 WavPack, 7 MP3, 0xe0 raw, 0xe1 ffmpeg, 0xf0 playlist, 0xff noise. Read-only interest for HQPTuner (source display).

### Reset

`<Reset/>` — engine reset. Exact scope of what it resets (playback engine vs settings) **verify empirically**; the CLI treats it as fire-and-forget.

## 7. Metering side channel

A separate binary TCP stream on **port 4321 + 1 = 4322** (control port + 1). The reference client simply connects; no control-channel enable command is involved (**verify empirically** whether hqplayerd streams unconditionally on accept).

Stream framing, repeated: one packed header, then per-channel data.

```c
struct head_t {            // packed, 32 bytes
    unsigned version;
    unsigned channels;
    unsigned xformLength;
    int      xformBits;    // negative = floating point
    float    bandwidth;
    float    xformTime;
    float    xformGain;
    float    reserved2;
};
struct data_t {            // per channel, followed by 2 × xformLength floats
    float peakMax;
    float peak;
    float rms;
    float rmsMax;
};
```

Per-channel payload size = `sizeof(data_t) + 2 × xformLength × sizeof(float)` (level meters plus two transform arrays — presumably spectrum data). Byte order is host order in the client (no swapping) — assume little-endian x86 (**verify empirically** if ever used cross-arch). Optional for HQPTuner; documented for completeness.

## 8. Out of scope

Playback/library/playlist surface, listed for orientation only (HQPTuner is a configurator):

| Commands |
|---|
| `Play`, `Pause`, `Stop`, `Previous`, `Next`, `Backward`, `Forward`, `Seek`, `SelectTrack`, `PlayNextURI`, `LoadRemovable` |
| `PlaylistAdd/Remove/MoveUp/MoveDown/Get/GetSingle/GetAll/GetList/Load/Save/Delete/Upload/Clear` |
| `LibraryGet`, `LibraryGetHash`, `LibraryLoad`, `LibraryPicture`, `LibraryFavoriteGet/Set/SetCurrent` |
| `MatrixListProfiles`, `MatrixGetProfile`, `MatrixSetProfile` (matrix editing is an outline non-goal; profile switching may become relevant to presets later) |
| `SetRepeat`, `SetRandom`, `SetDisplay`, `GetDisplay`, `SetTransport`, `SetTransportPath`, `SetTransportRate` |

## 9. Verify empirically (Phase 0.2 checklist)

Resolved on hqplayerd 6.0.4 (Opal spike runs):

1. ~~`Set*` `value` semantics~~ — **resolved: list index**, not enum ID (`SetFilter value="6"` → poly-sinc-lp, index 6; `SetShaping value="5"` → ASDM5EC, index 5). Enum IDs live in the enumeration lists and `hqplayerd.xml`.
2. ~~`SetRate` argument domain~~ — **resolved: index** (`value="7"` → 22579200 Hz, index 7). Hz form returned OK but unproven; use index.
3. ~~`SetFilter` with `value` only~~ — **resolved: sets both** 1x and Nx; `value1x` splits them.
4. ~~`GetFilters`/`GetShapers` mode-dependence~~ — **resolved: mode-dependent** (SDM: 36 modulators / DSD rates / 77 filters; PCM: 10 dithers / PCM rates / 67 filters incl. "none"; `[source]` mode keeps the current lists).
5. ~~Setter response shape~~ — **resolved**: `<Cmd result="OK"/>`; errors `<Cmd result="Error">reason</Cmd>` (see §4); connection never dropped.
10. ~~Shutdown persistence~~ — **resolved: no persistence.** hqplayerd never writes Control API changes to `hqplayerd.xml` (md5-identical across a stop with an unsaved change in memory); a restart reverts to file state.
8. ~~Whether 4321 authentication accepts self-generated client keys~~ — **resolved: rejected, and moot.** The daemon refuses self-generated `SessionAuthentication` keys, but HQPTuner authenticates via the port-8088 HTTP Digest interface (§3.5/§3.6) instead, which handles persistent-config writes and preset switching without the 4321 handshake. Config auth overall: **resolved via 8088**.

Still open:

6. ~~Keep-alive requirement / idle-drop timeout~~ — **resolved**: a fully idle connection is dropped after ~156 s (clean EOF, single sample). Any traffic resets the timer; a poll loop faster than ~150 s obviates the space-byte keep-alive.
7. ~~`Status subscribe="1"` push cadence and trigger~~ — **resolved**: stopped/idle → initial ~2-frame burst then silence (settings changes do not push); active playback → steady ~1–2 Hz, full ~1 KB frames with a `metadata` child. Guidance: poll `State`/`Status` (mode-independent), don't depend on subscribe.
9. Live-vs-restart classification per setting — answered in `settings-classification.md`. `SetAdaptiveVolume` **verified live** (toggles `State adaptive` and `VolumeRange adaptive`; note it echoes `<SetAdaptiveVolume/>` with no `result` attribute). `SetConvolution` is out of HQPTuner scope.
16. ~~Does `POST /config/profile/load` restart the daemon?~~ — **resolved: yes** (~3 s internal config-reload restart; 4321 drops and reconnects; §3.6).
11. `Reset` scope.
12. Metering stream availability (unconditional on port 4322?).
13. `GetInfo` full attribute set on hqplayerd 5.x.
15. `SetRate` Hz-form acceptance (returned OK at an ambiguous value; discriminating test needed if ever relied on).
