# HQPTuner — Design Outline

*A polished configuration interface for HQPlayer Embedded.*

## 1. Overview

HQPTuner is a free, community-oriented web interface that replaces HQPlayer Embedded's stock configuration and matrix pages for day-to-day settings work. It is a **configurator only**: no library management, no playback/media controls, no transport.

Core goals:

- Surface the manual's knowledge (filter/modulator descriptions, DAC tables) inline, at the point of use
- Make filter selection tractable: narrow by genre, focus, and quality; apodizing-only toggle for 1x
- Friendly rate selection ("DSD1024", "16x") instead of raw sample rates
- Live log tail in the browser
- Generic and shareable — no host- or hardware-specific assumptions baked in

Explicit non-goals:

- Convolution engine access (cut — the standalone convolution engine page; convolution *within* matrix pipelines is in scope per the matrix spec)
- ~~Matrix pipeline editing / raw matrix filter input (cut — too complex)~~ **Un-cut 2026-07-20**: full matrix pipeline editing is in scope. Design of record: `docs/matrix-spec.md`.
- Playback, library, or media control of any kind

## 2. Architecture

```
Browser SPA
   │
Backend service (single small process, Docker-friendly)
   ├─ HTTP lane:    port 8088, Digest auth — GET /config (read),
   │                POST /config (write; daemon self-writes XML + restarts),
   │                /config/profile/* (preset CRUD)   [persistent settings]
   ├─ Control lane: HQPlayer Control API, TCP port 4321, XML messages
   │                (runtime-switchable settings + status)
   └─ Static metadata: filter/modulator/DAC tables extracted from the manual
```

Two integration lanes:

1. **HTTP interface (TCP 8088)** — persistent configuration (backend, device, channels, buffer, engine settings) and preset management, via hqplayerd's built-in web server under HTTP Digest auth (realm `com.signalyst.hqplayer.embedded`; see `docs/protocol.md` §3.5–§3.6). `GET /config` returns the full settings form with current values and constraints (the read side — no need to parse `hqplayerd.xml` for current values); `POST /config` applies changes, and **the daemon writes `hqplayerd.xml` itself and restarts**. Preset CRUD is `POST /config/profile/{load,save,delete}`. This is the primary persistent-settings path: it eliminates manual XML rewriting, byte-preservation, clobber risk, and any need to orchestrate the restart ourselves — the daemon owns its own file. Verified against live 6.0.4 on Opal.

   *Direct `hqplayerd.xml` parse/write is a fallback only* (e.g. reading settings the HTTP form doesn't expose). Two facts still shape it if ever used: the daemon never writes the file at shutdown (so a stop → write → start sequence is safe from clobbering), and Control API changes are never persisted — live engine state can diverge from `hqplayerd.xml` indefinitely (observed on Opal), so HQPTuner should surface live-vs-file divergence rather than trust the file.
2. **Control API (TCP 4321)** — runtime-switchable settings: filters, dither/modulator, mode, rate, and status/metering. No restart required. No separate protocol document exists (confirmed by Jussi); the official `hqp-control` utility source (MIT-licensed) is the protocol reference, and the hqplayerd `readme.txt` documents the configuration file contents. Note: the 4321 Control API's own `SessionAuthentication` crypto handshake is **not** used — persistent-config auth goes through the 8088 HTTP Digest interface instead.

Rules:

- **XML preservation** (fallback lane only): if HQPTuner ever writes `hqplayerd.xml` directly instead of via `POST /config`, every setting the UI does not expose (matrix pipelines, convolution config, inputs, etc.) must survive a rewrite byte-faithfully. The HTTP lane sidesteps this entirely — the daemon serializes its own file.
- **Live vs restart split**: every control is classified as live (Control API) or restart-required (HTTP `/config` POST lane). The pending-changes bar reports the split before Apply.
- **Enumeration volatility**: filter/modulator names and list ordering change between HQPlayer versions (per Jussi); the configuration file stores numeric enumeration IDs. The running engine's enumeration queries are the sole authority for current names and IDs. Static metadata joins by name at runtime; engine entries with no metadata match still render (name only, no description). XML writes use engine-reported IDs, never shipped constants.
- **Mode-relative enumerations, no pre-capture**: the engine returns only the current mode's filter/shaper/rate lists (SDM lists in SDM, PCM lists in PCM). HQPTuner captures the current mode's lists for free on connect and re-enumerates on every mode switch (the daemon hands over the new mode's lists the moment `SetMode` takes effect). The other mode's lists are never needed while not in that mode, so HQPTuner never flips modes to pre-capture them. `data/engine-enums.json` is a development reference snapshot only — never the runtime authority.

## 3. Global UI

**Login gate**: HQPTuner is credential-gated by a login screen collecting the HQPlayer management username/password (the credential provisioned by `hqplayerd -u/-s` or the `/auth` page). The backend uses it for **HTTP Digest auth** against hqplayerd's port-8088 interface (realm `com.signalyst.hqplayer.embedded`; see `docs/protocol.md` §3.5), holding the credential server-side. This is standard Digest — no crypto handshake, no unresolved derivation (the earlier 4321 `SessionAuthentication` question is closed: HQPTuner doesn't use that path). The persistent-config write lane (`POST /config`) and preset switching (`/config/profile/*`) require this login; read-only use and all live (4321) settings work without it.

Present on every view (post-login):

- **Header**: daemon status (state, mode, CUDA), configuration dropdown (hqplayerd's built-in named configurations, active one marked — see §7)
- **Signal path bar**: source format → Bauer crossfeed (input-side, on the matrix mix bus, before oversampling) → active filter (one filter only — 1x or Nx, whichever applies to current source) → dither/modulator → DAC correction (a per-DAC response correction — **output-rate-dependent**, so applied at the output rate, after oversampling+modulation, NOT before the filter) → output rate → device. Disabled post-process stages (crossfeed/correction) are omitted from the bar entirely. Updates live as selections change. Jussi flagged the original mockup's block ordering as incorrect; this order is the manual-derived correction — verify against the stock web UI's processing block display before implementation (§10).
- **Tab navigation**: Output · DSP · Volume · System (flat — no subsections)
- **Pending-changes bar**: count of staged edits, live/restart split, Discard and Apply buttons

Full-width web page layout. No window chrome, no sidebar.

## 4. Sections

The interface consists of four sections:

### Output

*Structure updated in Phase 4 from the live `/config` form (see roadmap Phase 4 status, `docs/settings-classification.md`). The transport params turned out to be per-backend, not mode-gated as originally sketched.*

Top row — three master cards:

- **Mode** (segment) — PCM · SDM (DSD) · Auto
- **Backend** (segment) — ALSA · Network · Combo
- **Rate** (two friendly dropdowns, both shown, inactive one grayed by mode):
  - PCM — `1x, 2x, 4x, 8x, 16x, 32x`
  - SDM — `DSD64, DSD128, DSD256, DSD512, DSD1024, DSD2048`
  - Fixed friendly menus mapped to the 48k-base ceiling; auto rate family is forced on internally (not a user control), so the multiplier tracks the source's 44.1/48 base.

Independent (always shown):

- Idle time — dropdown (Default, 10, 20, 30, 60)
- UPnP freewheel — checkbox (input-side, backend-independent)

Collapsible backend sections (reveal on Backend; Combo shows both):

- **ALSA Backend** — device, channel offset (0–31), DAC bits (0–32), buffer time (−1–250 ms), DoP, 48k DSD
- **Network Backend** — device, DAC bits, buffer time, DoP, 48k DSD, IPv6

Device/bits/DoP/48k-DSD/buffer are **per-backend** (`alsa_*` / `net_*`, independent values); IPv6 is Network-only. Collapse (not gray) hides the unused backend; every field still persists (the daemon rejects a partial form).

### DSP

- 1x/Nx filter + filter narrowing — dropdowns
  - Narrow filters: genre, focus, quality — dropdowns
  - 1x "show apodizing only" checkbox
- Channels — integer box, 2–32
- DSP pipelines — dropdown (2, 4, 8, 16, 24, 32, 40, 48, 56, 64, ... 128)
- FFT filter length (grayed out when non-FFT filters employed) — dropdown (128, 256, 512, ... 16384)
- Dither/Modulator (Dither when PCM, Modulator when DSD) — dropdown
  - This setting's optimum is relative to the output sample rate, e.g. LNS15 is not appropriate for PCM 4x, AHM7EC8B will not run below DSD1024, etc. Inappropriate options should be grayed out.
- Bauer crossfeed
  - Enabled — checkbox
  - Preset — dropdown (Default, Jan Meier, Chu Moy, Custom)
  - Parameters:
    - Frequency — slider, 300–2000
    - Level — slider, 1–15
- DAC correction — checkbox + dropdown
- DSD sources
  - Direct SDM and Gain +6 dB — checkboxes
  - Integrator, SDM-SDM conversion, Noise filter, SDM-PCM conversion — dropdowns

### Volume

- Fixed volume (dBFS) — enabled checkbox, integer box from min–max volume
- Optimal ISO — checkbox
- Max/min volume — integer boxes, +12 to −60
- Startup volume — integer box from min–max volume
- PCM gain compensation — slider, −12 to 0
- Adaptive volume — checkbox
- Playlist album gain — checkbox

### System

- CUDA offload — radio buttons (Full offload; Convolution only; Disabled)
- Multicore DSP — Auto, Enabled, Disabled
- E-core allocation — Disabled; Resampling; DSP pool
- Blocks/cycle — "Manual" checkbox + slider (1–16); slider grayed out when unchecked, unchecked = Default (auto)
- Backup/restore config — buttons
- Trial/license/version — display only (no license management, non-interactive)
- Enable log/path — checkbox with file path
- Live log tail — text box, non-interactive

## 5. Behavior rules

Cross-cutting logic, in one place so it isn't lost in the section lists:

- **Mode/backend-dependent disclosure**: the per-family rate control grays for the inactive mode (Auto ungrays both); the ALSA / Network transport sections **collapse** by backend rather than gray (Phase 4 — device/bits/DoP/48k-DSD/buffer are per-backend, not mode-gated; the desktop app's "DAC bits grays in SDM / DoP grays in PCM" behavior does not apply to the Embedded form). FFT filter length grays when no FFT-family filter is selected.
- **Rate-aware shaper list**: dither/modulator options invalid at the selected output rate are grayed with a short reason (e.g. "requires ≥ DSD1024"), not hidden — visible-but-disabled teaches the constraint.
- **Mode switch coherence**: flipping PCM ↔ SDM swaps the Rate option set and the shaper card (label + option list) in the same interaction.
- **Filter narrowing**: genre/focus/quality dropdowns AND-combine and apply to both 1x and Nx lists. Empty result shows an explicit "no filters match — widen criteria" state, never a stale selection.
- **E-core allocation**: only meaningful on hybrid CPUs; show a muted "hybrid CPUs only" caption (backend may check host CPU topology when co-located with hqplayerd).
- **Mode-dependent enumerations**: the engine's enumeration lists are relative to the current mode and differ wholesale (verified live: SDM → 36 modulators, DSD rates, 77 filters; PCM → 10 dithers, PCM rates, 67 filters including a leading "none"; mode index 0 = `[source]` keeps the current lists). Indices shift between modes. On mode switch, re-run `GetFilters`/`GetShapers`/`GetRates` rather than filtering a cached list.

## 6. Static metadata

Shipped with the app as JSON, extracted once from the HQPlayer manual (the stock web UI's per-page "Help" links carry the same material and can serve as a cross-check). Entries are keyed by name and joined against live engine enumerations at runtime — never by shipped index (see §2 enumeration volatility):

- **Filter DB** (~50 entries, prose only): name, description, notes (e.g. "highest technical quality sources only", SDM two-stage behavior), plus optional editorial genre tags. All structural facets come live from the engine and are not extracted: quality (x/5), focus (transients/timbre/space), and ratio class ship in each `FiltersItem` description (verified: e.g. `"5/5 timbre ⥣ Any"`, `"4/5 space, timbre ⥣ 2^x"`); apodizing is `arg` bit 0; phase is parseable from the filter name (`-lp`, `-mp`, …).
- **Modulator/dither DB**: name, description, order, type, minimum/optimal rate constraints, DAC-architecture guidance (e.g. 5th order for ESS Sabre). The engine ships shaper names only — everything here is static extraction, and the rate constraints are the sole source for the UI's graying logic (§5).

## 7. Presets

Presets are hqplayerd's **built-in named configurations** — HQPTuner does not implement its own snapshot system. Full CRUD is available through the port-8088 HTTP interface under Digest auth (verified live on 6.0.4; see `docs/protocol.md` §3.6):

- **List / show active**: `GetConfigurationList` / `ConfigurationGet` on the 4321 Control API read the profile set and the active one (unauthenticated), or the same set appears in the `GET /config` form.
- **Switch**: `POST /config/profile/load` with `profile=<name>`. The empty-value option `[default]` is the unnamed base configuration.
- **Save (create/overwrite)**: `POST /config/profile/save` with `profile_name=<text>`.
- **Delete**: `POST /config/profile/delete`.

The header dropdown lists configurations, marks the active one, and routes switch/save/delete through these endpoints. No custom snapshot store, no separate save mechanism to build — the daemon provides it. Auth is resolved (HTTP Digest, §3).

Resolved (verified on 6.0.4): `POST /config/profile/load` **restarts the daemon** (~3 s, a lighter internal config-reload than a full `systemctl restart`), like `POST /config` — the connection manager's restart-resync path (roadmap Phase 2.2) handles it. Caveat: a full daemon/service restart resets the active config to `[default]` (unnamed base = `hqplayerd.xml`); only a profile `load` sets the active-profile name, which does not survive a `systemctl restart`.

## 8. Stack

- Backend: single small service; must run happily in Docker beside hqplayerd (same host recommended for XML lane + service restart + log tail). Language/framework at implementer's discretion; Python is a natural fit.
- Frontend: lightweight SPA; dark theme; no heavyweight framework requirements.
- Log tail: WebSocket (or SSE) stream of the hqplayerd log file / journal.
- Distribution: Dockerfile + compose example; config = XML path + hqplayerd host:port.

## 9. Prior art

No existing project is a configuration UI for HQPlayer Embedded — the niche is empty. Nothing is fork-worthy; the value is in protocol references:

- **Official `hqp-control` source** (signalyst.eu/custom.html, `hqp-control-601-src.zip`, engine 6.0.1) — canonical, current Control API reference from Jussi. **MIT-licensed** (verified: COPYING in the source archive is verbatim MIT, © 2011–2026 Jussi Laako) — may be read, derived from, and adapted freely with attribution.
- **unified-hifi-control** (open-horizon-labs, Rust, actively maintained) — playback/zone bridge with HQPlayer DSP switching (profiles, filters, shapers, dither) over native port 4321 + web port 8088. Proves the two-port pattern in production and confirms the runtime-settable pipeline surface. License: PolyForm Noncommercial — **reference only**, do not copy code.
- **hqpwv** (zeropointnine, Node.js, GPL-3.0, stale/HQPlayer 4 era) — playback remote containing a complete JS implementation of the 4321 protocol in `server/`. Secondary reference. License: GPL-3 — copying code verbatim imposes GPL on HQPTuner.

**License decision**: implement the protocol from the official `hqp-control` source, which is itself MIT — no clean-room process needed against it. The license wall applies only to unified-hifi-control (PolyForm NC) and hqpwv (GPL-3): do not open or copy their code. HQPTuner carries MIT.

**Author's position**: Jussi has no objections to alternative interfaces ("I certainly don't mind alternative interfaces to deal with HQPlayer things").

## 10. Pending

1. ~~Control API documentation from Jussi~~ — resolved: no separate protocol document exists. The MIT-licensed `hqp-control` source is the protocol reference; the hqplayerd `readme.txt` documents the configuration file. Finalize §2's live/restart classification from these plus empirical testing.
2. ~~Whether hqplayerd persists in-memory config to `hqplayerd.xml` on shutdown~~ — resolved empirically (Phase 0.2): it does not, neither at shutdown nor while running. The XML write sequence is safe; Control API changes are memory-only and lost on restart (see §2).
3. ~~Configuration auth and preset save/create/delete mechanism~~ — resolved (Phase 0.2): both go through the port-8088 HTTP interface under standard Digest auth (`POST /config/profile/{load,save,delete}`); the 4321 `SessionAuthentication` crypto path is not used. No client-key question, no Jussi dependency. See §3, §7, `docs/protocol.md` §3.5–§3.6.
4. Verify the signal path bar's processing block order (§3) against the stock web UI's block display — the original mockup order was wrong per Jussi. §3 has since been corrected: DAC correction is output-rate-dependent and applied after oversampling+modulation (not grouped with crossfeed before the filter, as the manual-derived draft had it). Crossfeed stays input-side. Still worth confirming against the stock UI's block display.
5. ~~Whether `POST /config/profile/load` restarts the engine~~ — resolved: it restarts the daemon (~3 s), handled by the restart-resync path (§7).
