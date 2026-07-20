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
- **Decision (2026-07-17, revised 2026-07-18):** `GET /config` is the **primary** persistent-config read path — the live form carries current values plus min/max/step/enum constraints for the whole form-exposed surface (verified against 6.0.4 on Opal). Settings **absent from the form** — the hardware-acceleration knobs `cuda`/`multicore`/`ecores`/`nblocks`, which live only on the `<engine>` element — are reached through the config **file lane**: edit a `/backup` archive's `<engine>` tag (surgical, byte-faithful) and push it via `POST /restore` (`scope=system`). The daemon self-restarts, re-reads the archive, and preserves the active preset (no `systemctl`, plain Digest auth). The earlier blanket "no direct `hqplayerd.xml` parsing" wording is retired: the file lane is a first-class write path for form-absent settings (Phase 4 System tab, `hqptuner/engineconf.py`), not merely a fallback. Reads of these attributes parse the `<engine>` tag from a `/backup` archive on demand.

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

**Status (2026-07-17): complete.** All exit criteria validated against live hqplayerd 6.0.4 on Opal: round-trip test green against captured real config; all read endpoints serving; hand-restart test — backend flagged the outage and auto-reconnected with a full fresh reload 9.6 s after `systemctl restart` (under the 15 s alarm threshold). PCM-mode enumerations captured into `data/engine-enums.json` via `scripts/capture_pcm_enums.py` (idle-gated, restore verified by State readback) — Phase 1 validator now passes with zero warnings.

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

**Status (2026-07-18): complete.** Core write path implemented and live-validated on hqplayerd 6.0.4; all carried-forward exit items closed (see below).

Validated against the live daemon on Opal:

- **Live lane** — `SetMode/SetFilter/SetShaping/SetRate/SetJunkFilter/SetAdaptiveVolume/Volume` each applied and confirmed by `State` readback, then the original settings restored. `Volume` is correctly reported as failed while volume control is disabled (`result="Error"`).
- **HTTP lane** — `POST /config` works end to end: overlay the staged changes onto a fresh `GET /config`, submit the **complete** form, confirm by a **polling** readback. A `title` round-trip persisted to `hqplayerd.xml` and was restored. Three undocumented wire facts were the whole difficulty and only surfaced under live testing (now recorded in `docs/protocol.md` §3.6): the form must be submitted complete (a partial POST is rejected `200`/`Failed!` with no write); checkboxes must submit `name=1`, never the HTML default `name=on`; and success must be confirmed by a polling readback because the daemon briefly serves the pre-restart form. `backup()` was fixed to `GET /backup/settings.zip` (the plain `/backup` returns the HTML page).
- **Presets** — save and delete validated live via the HTTP lane.
- **Tests** — the HTTP write path is covered by round-trips through a faithful fake daemon that rejects partial forms and `name=on` and models the post-restart stale window, so the code only passes if it produces a submission the real daemon would accept (`tests/test_http_apply.py`). Formatter is black at line length 120.

Closed (2026-07-18):

- **Preset load** exercised live: a safe round-trip (save current config to a temp preset, load it — which restarts the daemon — then delete it) resynced **both** lanes (Control 4321 `GetInfo` and HTTP 8088 `GET /config`) and left persistent config unchanged.
- **Per-setting sweep** on Opal: `filter`, `shaper`, `rate`, `junk_filter`, `adaptive_volume` each individually round-tripped (to a valid alternate and back) with `State` readback. `mode` is correctly **rejected** on an idle daemon (`SetMode: Error` — `[source]` needs an active source), and `Volume` is correctly rejected while volume control is disabled; both exercise the same `set_command`→`verify_state` path as the five that pass.
- **Apply report** now distinguishes outcomes: `_verify_http` returns `reason` — `applied` / `rejected` (daemon up, value never reflected) / `unreachable` (connection error at the deadline = a restart that never returned). The pre-apply backup is now **persisted to disk** (`Config.backup_dir`, default gitignored `backups/`) so a crash mid-apply leaves a recoverable copy, not just an in-memory one.
- **`POST /api/config/apply`** keeps the pending buffer on a soft failure (`_apply_succeeded`): staging is cleared only when every live edit verified and the http lane confirmed the change, so a rejected value or unreflected write no longer silently loses the staged edits. Covered by API round-trips through the faithful fake daemon.

## Phase 4 — Frontend SPA

Lightweight SPA, dark theme, no heavyweight framework (outline §8). Order within the phase:

1. **Scaffold + global chrome**: header (daemon status, presets placeholder), tab nav, pending-changes bar with live/restart split, signal path bar
2. **Connection surfacing**: status pill driven by backend state — green (connected), amber ("applying — hqplayerd restarting" while apply in flight and within the outage threshold), red (unreachable beyond it; threshold per Phase 2). Unreachable: controls disabled, last-known values shown marked stale, staging blocked.
3. **Tabs**, order Output · DSP · Volume · System (decided 2026-07-18; supersedes the earlier DSP-first sketch)
4. **Tooltips**: every control gets its `settings.json` description on hover
5. **Live log tail**: WebSocket/SSE stream into the System tab

### Exit criteria

- All outline §4 controls present and functional against the Phase 3 backend on Opal
- Full apply cycle (stage → split shown → apply → restart → resync) usable from the browser with no dev tooling

**Status (2026-07-19): in progress — all five tabs (Output · Resampling · DSP · Volume · System) built and live-walked on Opal; inline manual notes, a System-tab log tail, and a visual-layer pass, and an aesthetic pass (motion, focus/hover, tabular-mono type, header wordmark) landed. Remaining Phase 4 polish (custom selects — the one big aesthetic item) + the Phase 5 behavior rules are the open work.**

Frontend stack (decided 2026-07-18): Preact + htm + `@preact/signals`, no build step — vendored ESM modules shared through an HTML importmap (CSP-clean, offline, one Preact instance). Three-tree store (engine-live 4321 / http-config 8088 / staged) with `effective(key)` = staged ?? baseline; dumb control primitives bound by a single `Field` that wires value/options/gray/dirty/label from the store. Reactive render is load-bearing: the cross-control graying/collapse graph falls out of `render(state)`.

Output tab — implemented and hand-walked on Opal:

- **Top row: three equal cards — Mode · Backend · Rate.** Mode (segment, order PCM · SDM (DSD) · Auto) and Backend (segment, ALSA · Network · Combo) are the master switches; Rate holds the PCM + DSD dropdowns. Mode/backend/rate menus are fixed presentation lists — mode reorders/relabels the live enum by **index** (string `"0"/"1"/"2"`, `[source]`→Auto); backend/rate are hardcoded (stable http values).
- **Collapse, not gray, for the backend axis.** ALSA / Network sections reveal on backend selection (Combo shows both), with a manual-toggle override; collapse is purely visual (the full form always POSTs). The mode axis grays a single control; the backend axis collapses a six-field chunk.
- **Transport params are per-backend, not mode-gated** — corrects outline §4/§5. The Embedded `/config` form scopes device / DAC bits / DoP / 48k-DSD / buffer per backend (`alsa_*` vs `net_*`, independent values — verified live: `alsa_bits=24` vs `net_bits=20`, `alsa_anydsd=False` vs `net_anydsd=True`). The "DAC bits grays in SDM / DoP grays in PCM" annotations were the *desktop* app's behavior. IPv6 is Network-only. Graying carries **no caption** (a reason string would reflow the row on mode change).
- **Two-family rate, friendly fixed menus.** PCM (`1x…32x`) and DSD (`DSD64…DSD2048`) both always shown, inactive one grayed by mode. Menus are literal, mapped to the **48k-base ceiling** wire values (`defaults_samplerate` / `defaults_bitrate`) so a source of either 44.1/48 family reaches its own Nx under the daemon's "equal or lower" auto rule (e.g. DSD512 = 24576000, not the naive `/44100` = "DSD557").
- **Friendly-rate invariant forced on write.** Every `POST /config` pins `auto_family=1`, `samplerate=0`, `bitrate=0` (`_FORCED_CONFIG` in `manager._apply_http`) — the per-family ceiling only holds with auto-family on and the fixed rates on Auto. Enforced on write only (never a standalone POST → cannot restart the daemon uninvited). Covered by a parametrized round-trip through the faithful fake daemon, mutation-verified (disable the forcing → all three cases fail).

Volume tab — implemented and hand-walked on Opal:

- **Layout**: no page heading (the tab nav names it — applies to every tab now); a 2×2 card grid (Fixed volume · Range / Gain · Automatic) using the same card style as the Output backend sections. Fixed-volume level + Optimal ISO are indented under the enable checkbox.
- **Field mapping** (live `/config` + readme): `volume_fixed` is **Optimal ISO** (inter-sample-overs-optimized fixed volume), `fixed_volume` is the dBFS level, `fixed_volume_enabled` gates both. Doc-verified exclusivity: the level grays when fixed-volume is off **or** Optimal ISO is on (ISO supersedes the manual level). Only `adaptive_volume` is live; the rest are http/restart.
- **PCM gain compensation** is a slider **+** number box (120 fine steps are unusable on a slider alone), with the fill anchored at the 0 dB (max) end so its length reads as attenuation, plus ticks at 0 and −6.
- **Checkbox dirty-highlight bug fixed**: `isDirty` compared a checkbox's staged `"1"/"0"` against a bool baseline as strings, so a touched checkbox read dirty forever — now compared in-domain.
- **Live playback volume** — the tab's dominant control and the app's first real-time-write control. New lane: `GET/POST /api/volume` + `manager.set_volume` + `control.get_volume_range`, entirely outside the staged-diff/Apply flow (no dirty flag, no pending count). Reads `State.volume` + `VolumeRange` (bounds + `enabled`), writes immediately (throttled ~100 ms), grays on `VolumeRange enabled=0` (fixed volume / no active stream). The `<input type=range>` is **uncontrolled** (ref-driven, synced from the engine only when idle) so the 2 s poll can't yank the thumb mid-drag; when idle it tracks changes from other clients (Roon, HQPlayer Client). Covered by 4321-lane tests through the fake daemon (VolumeRange parse, set→State.volume readback, rejected-when-disabled).

DSP post-processing — crossfeed + loudness cards with knobs and live response plots (implemented, screenshot-verified via headless render of the real components):

- **Loudness plugin** added to the DSP tab (bass/treble shelf-or-peak + volume-adaptive range). Field→XML mapping (`presetconf.PLUGIN_MAP`) grounded by **value-correlation**, not guessed: the live `/matrix` form defaults uniquely match the `<plugin type="loudness">` attributes in a real snapshot (`lowfreq=80`↔`low_frequency`, `lowtype=lshelf`↔`low_type`, …), and the plugin node already exists (disabled) in every snapshot so the surgical restore-lane edit needs no node insertion. Persists on the same snapshot-XML restore lane as crossfeed/correction.
- **One reusable knob** (knob + horizontal slider + mono box, all three synced) for the continuous, audible params only: crossfeed frequency/level, loudness bass/treble level, and playback volume (large variant). Everything else stays a dropdown / number box. Interaction contract: vertical drag (Shift = fine), wheel, double-click = default, arrow/Page/Home-End keys. Dial visual: accent 270° value-fill arc + gray inner ring + accent notch.
- **Live-override store layer** (`liveOverride` signal, highest priority in `effective()`): a knob/slider drag updates a client-only signal so the plot repaints instantly with no server round-trip; committed to `staged` on release via an **optimistic** `edit` (staged updated before the stage POST resolves, so release never flickers to baseline).
- **Client-side SVG response plots**, recomputed every render (no backend). Loudness uses **exact RBJ "Audio EQ Cookbook" biquad** magnitude (low/high shelf honoring shelf-slope S, peak honoring bandwidth, peakq honoring Q) — validated offline against the cookbook's exact values (−3 dB at the shelf corner, symmetric peak, etc.); the HQPlayer `/matrix/plot` cross-check was **deferred by decision** (offline RBJ accepted, since a live comparison needs a temporary matrix write). Crossfeed is a deliberate first-order model (DC = −level, first-order roll-off above the cross-over) — its low-frequency asymptote equals −level exactly.
- **Volume-adaptive interpolation** (the loudness point): shelving scales linearly from full at/below the lower range bound to zero at/above the upper bound, using the live engine volume; a caption states "at X dB volume: N% of maximum shelving applied."
- **Visual-language token** (in the CSS): **dashed + muted = potential/maximum ("ghost"), solid + accent = applied now.** Used by every plot trace (crossfeed `direct`/`cross-fed`, loudness `max`/`applied`, labelled at the right edge with collision-nudging) and reusable elsewhere.
- **Bauer preset↔params coupling** (`state.edit`): selecting `default`/`cmoy`/`jmeier` loads that preset's frequency/level (libbs2b canonical: 700/4.5, 700/6.0, 650/9.5) so the graph shows the preset; adjusting either param switches the preset to `custom`. Lets the user inspect presets visually — HQPlayer's own UI does not auto-load them.
- **Card layout**: controls on top, a full-width response plot across the bottom; feature-off dims the body (sub-controls + plot) as a unit while the enable checkbox stays live; loudness bass/treble grouped into clusters under their level knob. The front-panel signal path shows one combined post-process indicator (both → "DSP", else "Crossfeed"/"Loudness") rather than a chip per feature.

System tab — implemented and browser-walked on Opal (2026-07-19):

- **Layout**: About + a combined Backup & Restore card across the top row; Hardware acceleration; the HQPTuner prefs card (accent + description toggles); the Logging card full-width at the bottom. About renders read-only identity as `LABEL` (caps) → accent-colored mono value; the license row reads `TRUE`/`FALSE` off `GetLicense valid` (0/1).
- **Hardware acceleration** (`cuda`/`multicore`/`ecores`/`nblocks`): the file-only `<engine>` lane via `POST /api/engine` (backup→edit→`/restore`, idle-gated). Blocks/cycle reworded to an explicit "Set manually" checkbox (unchecked = automatic from CPU cache); the slider is accent-tinted. The full engine-apply path was reproduced end-to-end against the live 6.0.4 daemon (curl both lanes + a headless-browser button click) — restore hot-applies the engine attrs in ~1 s with no outage, apply returns `applied:true`. (An earlier "Load failed" report did not reproduce on current code; it traced to a stale backend build.)
- **Live log tail**: a checkbox-gated static 50-line view (`GET /api/log` → `hqptuner/logtail.py` tails the daemon's configured `log_file`), polled every 3 s while shown, pinned to the bottom. Decided against the SSE/WebSocket stream in the original sketch — a polled static window is simpler and sufficient for a config tool.

Inline manual notes (2026-07-19, commit `cce8672`): the Phase 1 `settings.json` prose renders under each control (`.field-note`), keyed by a schema `note` map; the four DSD-source enum dropdowns show a per-value note that tracks the selected option (`desc:"config"` + per-value `options` maps). Two persisted System>HQPTuner toggles gate visibility: a master show/hide plus a keep-filter/DSD-source-option-descriptions switch (live only when the master is off). Tooltips also remain on hover. This supersedes the Phase 4 "tooltips on hover" item — they're inline by default.

Tab reorganization + visual-layer pass (2026-07-19): resampling split out of DSP into a new **Resampling** tab (mode, output rate, PCM/SDM filter chains + narrow-filter facets, DSD sources, FFT length); tab order Output · Resampling · DSP · Volume · System. Output keeps backend as its hero switch plus a General card (channels, PCM gain compensation, idle, UPnP); DSP is DAC correction (top, dims when off) + crossfeed/loudness; DSP pipelines moved to System. Visual fixes from the hand-walk: hero boxes fill the content width (grid, N boxes = N equal cells); every control lives in a titled card (no naked fields); disabled post-process controls desaturate the accent (knob arc / slider / plot trace) to muted, not just opacity, so colored controls read "off" like the text; the four narrow-filter facets are one identical custom control each (single/multi popover, no native `<select>` chrome); Volume Automatic is full-width with two internal columns; radios sized to checkbox weight; a disabled primary Apply loses its accent; the log tail wraps (vertical scroll only). The playback-volume banner names the real disable cause (Direct SDM / fixed / no-stream) from the same staged signals the checkboxes read. Descriptions render in **full** — no truncation, no clamp; the System > Feature-descriptions toggle stays the one way to reduce description volume. `dac_bits` and `gain_compensation` had their per-DAC value dumps trimmed to the functional sentence.

Grounding completed — `UNGROUNDED` deleted (2026-07-19): every form field now has a verified XML location, so no control is disabled-because-unapplyable. The five that value-correlation alone could not place are grounded from the manual plus a live config dump: `idle_time` → `<engine idle_time>`, DoP → `<alsa|network pack_sdm>` (readme §1.3.2 / §1.3.5), and the fixed-volume pair onto the top-level `<fixed volume="X"/>` element — whose **presence** is the enable, as there is no `enabled` attribute (readme §1.13, confirmed against the running config). `presetconf._reconcile_fixed` inserts/removes that element comment-safely (the daemon parks the remembered level in a commented `<fixed>`, which must never be matched or edited), and `read_config` reports fixed + matrix state so the apply's readback actually verifies them. The stage-time 422 in `api.py` and the `UNGROUNDED` gate in `graying.js` are gone.

Matrix gating (2026-07-19): `<post_process>` nests **inside** `<matrix>` (readme §1.11 / §1.11.2), so a preset with `matrix enabled="0"` silently renders crossfeed / loudness / DAC correction **inaudible** — the Speakers preset did. `apply_edits` now switches the matrix on whenever an edit switches a post-process plugin on; deliberately **never** auto-off, since matrix also carries channel routing and disabling it would break a pipeline setup. `_enable_matrix` is a no-op when the snapshot has no `<matrix>` — a coherence step taken on the user's behalf must never abort the edit they asked for. Verified live against 6.0.4: apply → readback (fixed volume, matrix, loudness low/high level all as intended) → restore-to-pristine, readback-confirmed. The fake daemon's XML was corrected to nest `<engine><matrix><post_process>` as the real daemon does; its previous flat shape (no `<matrix>` at all) is why this shipped uncaught. **Verified live (2026-07-19):** uploading `<matrix enabled="0">` together with `<plugin type="loudness" enabled="1" low_level="7" low_frequency="123">` reads back byte-identical, and `/matrix` reports `post_loudness_enabled` checked — the daemon **preserves** post_process state when the matrix is off; it simply doesn't run the chain. The fake therefore does *not* model any discard behaviour (an earlier draft did, and was wrong).

Corollary — the "loudness comes back disabled at defaults" symptom is **not** matrix gating. The Speakers snapshot carries `<plugin type="loudness" enabled="0" low_level="20">` — literally disabled-at-defaults — and every apply rebuilds the working config from `snapshot ⊕ staged edits`. So a post-process setting survives only the apply that carries it; the next unrelated apply re-asserts the snapshot and reverts it. This is the anti-drift design meeting Jussi's model (the `/config` form writes the *default* config; named profiles are copies made by Save), and it means post-process edits are ephemeral until saved into the preset. Open question for Phase 5: whether apply should preserve current post-process/matrix state rather than re-asserting the snapshot's.

Form-field sweep + the lossy-form read lane (2026-07-19): a pass over the daemon's own `/config` form against the readme found three fields with prose already written but no control — `quick_pause`, `short_buffer` (Normal/Short/Minimum), `pre_before_meter` — all long since mapped in `presetconf.FIELD_MAP` and parked in `settings.json`'s `_unexposed_candidates`. Now exposed (Output>General; System>Metering). `cuda_dev`/`cuda_cdev` joined the `<engine>` restore lane (`ENGINE_INTS`, `-1` = automatic) so multi-GPU hosts can split filters from convolution. `rocm` deliberately left out. Also landed:

- **Optimal ISO is now three-way (Off · −3 dB · −6 dB), not a checkbox.** `volume_fixed`'s XML domain is 0/1/2 but hqplayerd renders a bare checkbox, so its own UI can't reach −6 dB (Desktop uses a tri-state checkbox instead — rejected here as ambiguous). Writing `2` works because the persistent lane is a snapshot-XML restore, not a form POST; **verified live on 6.0.4** (applied `2`, read back `2`, restored, whole-config diff clean). Reading it needed a new lane: `manager.file_config` parses the `/backup` archive's working `hqplayerd.xml` (reusing `presetconf.read_config`), serves it as `file` on `GET /api/config`, and frontend schema entries flagged `fileTruth` prefer it over the form's bool. Refreshed on connect and free inside the apply's verify step — never per poll. See `docs/settings-classification.md`.
- **Two module splits** forced by the 500-line gate and warranted on merit: `hqptuner/enginelane.py` (engine-attribute write orchestration — edit backup, restore, poll readback — out of an over-broad `manager`), and `tests/fake_http.py` (the whole port-8088 fake out of `conftest`, which keeps the 4321 fake and wraps `spawn`/`state` as fixtures).
- **Doc conflict recorded, not guessed:** `pdm_conv` id 10 is the daemon's `sinc-S` (confirmed from the real form's option labels), but the manual's SDM→PCM table says 65536 taps while the readme says 4096 × ratio — the latter is the wording for the *same-named resampling filter* in manual §4.6. The shipped option prose quotes no tap count; the disagreement lives in the entry's `source`.

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
