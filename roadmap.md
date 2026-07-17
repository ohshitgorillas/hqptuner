# HQPTuner — Development Roadmap

Companion to `outline.md`. Phases are ordered by risk: unknowns die first, write paths come before UI polish, read-only comes before write. No timelines — each phase is done when its deliverables exist and its exit criteria hold.

## Phase 0 — Protocol groundwork

Everything downstream depends on two documents produced here. This phase is research, not code (throwaway spike scripts allowed, nothing kept).

### 0.1 Control API reference

Extract the command surface from the official `hqp-control` source (signalyst.eu/custom.html, `hqp-control-601-src.zip`, engine 6.0.1) and write it up as our own protocol reference. The source is MIT-licensed (outline §9), so it can be read and derived from directly — no clean-room process needed. Do not open unified-hifi-control (PolyForm NC) or hqpwv (GPL-3) at all; the official source plus empirical verification suffices.

Capture per command: request XML shape, response XML shape, error behavior, and whether the setting survives daemon restart. Known-needed commands beyond the `GetInfo`/`Status` pair already proven by hqpexporter:

- Filter get/set (1x and Nx)
- Shaper/dither get/set
- Mode get/set (PCM/SDM)
- Rate get/set
- Enumeration commands (available filters, shapers, rates, modes) — needed so dropdowns reflect the running engine, not just our static metadata
- Volume get/set (confirmed exposed: `Volume`, `VolumeRange` incl. min/max/enabled/adaptive)
- Status/metering fields not yet mapped by hqpexporter

### 0.2 Live-vs-restart classification

Empirically verify, against the live hqplayerd on Opal, which settings take effect immediately via Control API and which require the XML + restart lane. The outline (§2) assumes the split; this phase proves it per setting.

Outline §10.2 is **answered** (spike run on Opal): hqplayerd never persists in-memory config changes to `hqplayerd.xml` — not at shutdown (md5-identical file across a stop with an unsaved change in memory) and not while running. XML-lane write sequencing is safe, and Control API changes are lost on restart.

Also resolved from the same runs (details in `docs/protocol.md` §9): `Set*` value domain (**list index**, not enum ID), `SetRate` argument form (**index**), setter error response shape (`result="Error"` + reason text, connection kept), and mode-dependence of the enumeration lists.

**Config auth + preset switching — resolved (8088 HTTP Digest).** Persistent-config writes and preset CRUD go through hqplayerd's port-8088 web interface under standard HTTP Digest auth (realm `com.signalyst.hqplayer.embedded`; verified with the live management credential → HTTP 200; the stored `hqplayerd-auth.xml` digest is exactly the Digest HA1). The 4321 `SessionAuthentication` crypto handshake is not used — the daemon rejects self-generated client keys, but that lane is moot. Routes: `POST /config` (apply; daemon self-writes XML + restarts), `POST /config/profile/{load,save,delete}` (preset CRUD). See `docs/protocol.md` §3.5–§3.6.

Also resolved: `POST /config/profile/load` **restarts the daemon** (verified — 4321 refused ~0.3 s after the POST, back ~3.4 s; a lighter internal config-reload restart than a full `systemctl restart`'s 9.3 s). `SetAdaptiveVolume` verified live. `Status subscribe="1"` cadence fully characterized (idle → burst then silent; playback → ~1–2 Hz, full frames with metadata; guidance: poll, don't subscribe). Keep-alive idle-drop timeout resolved: ~156 s of full idle → daemon closes the connection (any traffic resets it, so a sub-150 s poll loop needs no explicit keep-alive). Phase 0.2 empirical items all closed.

### Deliverables

- `docs/protocol.md` — Control API reference, provenance noted (derived from MIT-licensed official `hqp-control` source)
- `docs/settings-classification.md` — every outline §4 control tagged `live` or `restart`, plus the §10.2 shutdown-persistence answer

### Exit criteria

- Every control listed in outline §4 has a classification entry
- Protocol doc covers every command HQPTuner will send, verified by hand against a live daemon (spike script, `nc`, or similar)
- Shutdown-persistence question answered with an observed result, not an assumption

## Phase 1 — Static metadata

Runs parallel to Phase 0. Scope is trimmed to what the engine does **not** already ship on the wire: quality, focus, ratio class (in `FiltersItem` descriptions), apodizing (`arg` bit 0), and phase (parseable from filter names — `-lp`, `-mp`, etc.) all come live from enumerations, so the static DBs carry none of them. Static data is a join-by-name prose/constraints overlay only; the running engine stays the authority for everything structural (names, IDs, ordering, facets). Unmatched engine entries still render (name only). Readme enum indices may be used as an extraction aid only — never shipped as authority (outline §2 enumeration volatility).

Extract into JSON (schema per outline §6):

- **Shaper DB** (mandatory — biggest gap): `ShapersItem` carries name only, so everything comes from manual §4.4/§4.5 + readmes. Per entry, keyed by name: machine-readable **rate constraints** (min/optimal rate — the UI's graying logic has no other source), description prose, order/type, DAC-architecture guidance (e.g. 5th order for ESS Sabre).
- **Settings descriptions DB** (mandatory): tooltip text for *every* control the UI exposes. Manual §4 and the readme carry short explanations of non-obvious features (quick pause, auto rate family, direct SDM, e-core allocation, nblocks, …); surface them at point of use per the outline's core goal. One entry per control: setting key, tooltip prose, source reference.
- **Filter DB** (prose only): manual §4.6 descriptions plus notes (e.g. "highest technical quality sources only"), keyed by name. No facets, no indices, no apodizing flags — the engine ships those.
- **Genre tags** (optional, may slip past v1): editorial judgment, thin coverage in the manual; a thin first pass or a v1 cut are both acceptable. Entries carrying editorial (non-manual) tags are marked as such.

### Deliverables

- `data/filters.json`, `data/shapers.json`, `data/settings.json`

### Exit criteria

- Every shaper the v6 readme lists has a name-keyed entry with machine-readable rate constraints
- Every filter the v6 readme lists has a name-keyed prose entry
- Every outline §4 control has a tooltip description in `settings.json`
- No static entry duplicates a facet the engine ships live (quality, focus, ratio, apodizing, phase)

## Phase 2 — Backend core (read-only)

First kept code. Stack: Python backend (FastAPI or similar — pick at start of phase). No write paths — safe against the production daemon from day one.

**Stack (decided 2026-07-17):** Python 3.12+, FastAPI + uvicorn; httpx for the 8088 lane (built-in Digest auth) with BeautifulSoup for the `/config` form parse; asyncio-streams client for 4321 with hqpexporter's proven lenient-XML handling (parse-until-valid framing, bare-`&` re-escape).

### 2.1 Persistent-config read side

Primary path is the port-8088 HTTP interface, not direct file parsing:

- `GET /config` (Digest auth) returns the full settings form with current values and min/max/enum constraints — parse it into the settings model covering the owned attributes (outline §4).
- **Decision (2026-07-17): no direct `hqplayerd.xml` parsing.** `GET /config` is the sole persistent-config read path — the live form carries current values plus min/max/step/enum constraints for the whole owned surface (verified against 6.0.4 on Opal: all outline §4 persistent controls present as form fields). Direct XML parsing stays a documented fallback only, semantic (never byte-faithful), if a needed setting turns out to be absent from the form.

### 2.2 Control API client + connection manager

- Persistent-connection client per `docs/protocol.md`: GetInfo, Status polling, enumerations
- Reconnect/backoff and lenient XML recv — hqpexporter already proved the failure modes (unescaped `&` in metadata, parse-until-valid framing)
- **Connection manager**: single source of truth for daemon reachability. One state — `reachable` / `unreachable since T` — where "reachable" means a successful handshake (GetInfo), not a mere TCP accept. Status polling doubles as heartbeat. Alarm threshold: measured restart-to-GetInfo time on Opal is 9.3 s (TCP accept and first response simultaneous), so the 15 s default accommodates a full restart cycle; keep it parameterizable for slower hosts. Unreachable > 15 s = something is wrong; surface it. Poll aggressively during the initial outage window, then back off.
- API requests against an unreachable daemon fail fast with a clear error — never hang on a dead socket
- Every fresh connection (startup or reconnect) loads settings from scratch: re-read `hqplayerd.xml`, re-run GetInfo/Status/enumerations. No cached pre-outage state, no assumptions about what didn't change.

### 2.3 Read API

- REST endpoints: parsed config, live status, enumerations, static metadata (Phase 1 JSON merged with engine enumerations)

### Exit criteria

- Round-trip test green against real config
- Backend runs continuously against production hqplayerd without disturbing it; status endpoint tracks stock-UI state changes live
- Kill and restart hqplayerd by hand: backend flags unreachable within the heartbeat interval, reconnects on its own, and serves freshly-loaded state

## Phase 3 — Write path

Shape confirmed by Phase 0: persistent writes go through the port-8088 HTTP interface, not a manual XML writer.

- **Staged-changes model**: server-side diff over the settings model; every staged edit tagged live or restart per `docs/settings-classification.md`. Staging survives browser reloads.
- **Apply flow**: live settings via Control API (4321) setters with readback verification; restart settings via `POST /config` (8088, Digest auth) — the daemon writes `hqplayerd.xml` and restarts itself. Preset switch/save/delete via `POST /config/profile/*`. No manual XML serialization, no host service-controller integration, no byte-preservation problem — the daemon owns its file.
- **Service controller** — largely **obviated**: `POST /config` triggers the daemon's own restart, so HQPTuner does not need systemctl/docker restart integration for the apply path. (A controller may still be wanted for out-of-band recovery, but it is no longer on the critical path.)
- **Restart handling**: `POST /config` (and possibly profile load) restarts the daemon; apply sets an apply-in-flight flag and the connection manager's outage rule does the rest (15 s default threshold, parameterizable — measured restart-to-GetInfo is 9.3 s on Opal). Back within the window → resync (re-read `GET /config` + 4321 enumerations), verify, report per-setting outcome. Not back → same alarm as any outage, plus: "hqplayerd did not return after config apply. Check daemon logs." Then stop; recovery is user intervention — HQPTuner never auto-restores or retries.
- **Safety copy**: the daemon's own `/backup` route (or a copy of `hqplayerd.xml`) captured before an apply, for manual recovery only.

### Exit criteria

- Every owned setting changeable through HQPTuner and verified (Control API readback or `GET /config` inspection) on Opal
- Preset load/save/delete work end-to-end via the HTTP lane
- Apply with the daemon slow/failing to return produces the failure report and leaves the pre-apply backup intact

## Phase 4 — Frontend SPA

Lightweight SPA, dark theme, no heavyweight framework (outline §8). Order within the phase:

1. **Scaffold + global chrome**: header (daemon status, presets placeholder), tab nav, pending-changes bar with live/restart split, signal path bar
2. **Connection surfacing**: status pill driven by backend state — green (connected), amber ("applying — hqplayerd restarting" while apply in flight and within the outage threshold), red (unreachable beyond it; threshold per Phase 2). Unreachable: controls disabled, last-known values shown marked stale, staging blocked.
3. **Tabs**, in value order: DSP → Output → System → Volume, per outline §4
4. **Tooltips**: every control gets its `settings.json` description on hover
5. **Live log tail**: WebSocket/SSE stream into the System tab

### Exit criteria

- All outline §4 controls present and functional against the Phase 3 backend on Opal
- Full apply cycle (stage → split shown → apply → restart → resync) usable from the browser with no dev tooling

## Phase 5 — Behavior rules, presets, polish

- **Behavior rules** (outline §5): mode-dependent graying, rate-aware shaper constraints with visible-but-disabled reasons, filter narrowing with empty-state, mode-switch coherence
- **Presets** (outline §7): hqplayerd's built-in named configurations — no custom snapshot store. Full CRUD via the 8088 HTTP interface under Digest auth: `POST /config/profile/{load,save,delete}` (read the set via 4321 `ConfigurationList`/`ConfigurationGet` or `GET /config`). Auth and save/delete mechanism resolved in Phase 0; `load` **restarts the daemon** (~3 s, verified), so it routes through the same restart-resync path (Phase 2.2) as `POST /config`.
- **Polish**: empty states, error surfaces, restart-in-progress UX, anything the Phase 4 hand-walk turned up

### Exit criteria

- Behavior rules verified by walking each §5 case by hand
- Save / switch / rename / delete presets from the browser; switching produces a correct staged diff including its live/restart split

## Phase 6 — Packaging + release

- Dockerfile + compose example; config surface: XML path, hqplayerd host:port, service-controller command
- README: setup, config reference, screenshots
- MIT license; provenance note for the protocol implementation (derived from Jussi's MIT-licensed `hqp-control` source, with attribution)
- Publish and announce; feedback loop with the HQPlayer community drives whatever comes next

### Exit criteria

- Fresh-machine install from the README alone works
- Repo public under MIT
