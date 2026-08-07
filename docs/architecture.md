# HQPTuner — architecture and normative rules

Replaces `outline.md` (removed 2026-07-25 — had drifted into stale UI snapshot). Section numbers preserved from that file so `architecture §N` citations across codebase keep meaning.

**This document carries rules, not inventories.** Old outline rotted because it duplicated control list and tab layout in prose, and prose not updated by `make check`. Everything enumerable here points at artifact that owns it instead.

## 1. Scope

HQPTuner is configuration interface for HQPlayer Embedded — replaces stock configuration, matrix and speaker pages for day-to-day settings work.

**Non-goals:** playback, library, media control of any kind; standalone convolution-engine page (convolution *within* matrix pipelines is in scope). Matrix pipeline editing originally cut as too complex, un-cut 2026-07-20 — design of record is `docs/matrix-spec.md`.

## 2. Integration lanes, and enumeration volatility

Two lanes reach hqplayerd:

1. **Control API (TCP 4321)** — XML messages, unauthenticated. Runtime-switchable settings (filters, dither/modulator, mode, rate, matrix profile) and all status/metering. No restart. Changes **memory-only, never persisted** — see divergence rule below. Wire reference: `docs/protocol.md`.
2. **HTTP interface (TCP 8088, Digest auth)** — `GET /config` is read side for persistent settings and their constraints. Persistent **writes** ride **restore lane**: fetch `/backup`, surgically edit field in config XML, push with `POST /restore` (`scope=system`), on which daemon self-restarts in ~5.6 s.

> **There is no `POST /config`.** `/config` is GET-only. Genuine form POSTs are `POST /matrix`, `POST /matrix/{load,save,delete}` and `POST /speakers` (~3 s engine reload each), plus `POST /config/profile/delete` for removing preset mirror. Per-field lane assignments and full evidence base live in `docs/settings-classification.md`.

Normative rules:

- **Enumeration volatility.** Filter/shaper names and list ordering change between HQPlayer versions; config file stores numeric enum **IDs** while wire uses list **indices**. Running engine's enumeration queries (`GetModes`, `GetFilters`, `GetShapers`, `GetRates`, `GetJunkFilters`) are sole runtime authority for names, IDs, ordering. Static `data/*.json` joins **by name**, never overrides live data; engine entry with no metadata match still renders (name only). Never ship constant where engine-reported value belongs.
- **Never mix index and ID domains.** `Set*` and `State` speak list index; `hqplayerd.xml` stores enum ID. Translating between lanes requires live lists.
- **Mode-relative enumerations, no pre-capture.** Engine returns only current mode's lists (SDM lists in SDM, PCM lists in PCM), and they differ wholesale — indices shift between modes. Re-run enumeration queries on every mode switch rather than filtering cached list; never flip modes to pre-capture other one. Mode index 0 (`[source]`) keeps current lists.
- **Static facet fallback (2026-07-24).** Because live enum only covers *active* mode, filters exclusive to inactive mode had no facets and bypassed narrowing. quality/focus/apodizing/ratio transcribed into `data/filters.json`, consumed by `store/facets.js` as **fallback for filters live enum omits**. Live stays sole authority for active mode.
- **Live-vs-file divergence is real and must be surfaced, not assumed away.** hqplayerd never writes Control API changes to `hqplayerd.xml` — not while running, not at shutdown (verified: md5-identical across `systemctl stop` with unsaved change in memory). Running engine can differ from file indefinitely, and this is observed in wild, not only constructed in probe: on Opal running filters already differed from file's stored filters before any spike run. Read both lanes; show divergence.
- **`result="OK"` is not proof of application.** Always verify by `State` readback.
- **Live vs restart split.** Every control classified live or restart-required; pending-changes bar reports split before Apply. Tagging: `docs/settings-classification.md`.
- **Two write paths, and they must not share staging state.** Tabs view stages into shared `PendingStore` and Apply flushes **everything** in it (`api/pendingapi.py`, apply route in `api/app.py`); LIVE writes one batch on the spot, readback-verified, and touches neither pending store nor 8088 lane, so it can never restart daemon (`POST /api/config/live` → `lanes/livelane.apply_now`). Rule is binding in both directions: LIVE control routed through stage+apply would apply edits user staged elsewhere and never asked for, which is why second path exists at all rather than reusing first.
- **Mode cannot ride in one batch with chain fields, but a sequence may.** `SetMode` swaps enumerations remaining indices were resolved against, so `livemap._mode_blocks_batch` refuses such a batch outright. Applying mode alone, re-enumerating, then resolving the rest against post-switch lists is legal and is what `livelane.apply_preset` does — same sequence `apply_now` already runs after any verified mode write (`_reassert_rate`, `reassert_chain`). Refusal is about one batch, never about what engine can be told.

## 3. Auth, and the signal path order

**Auth.** HQPTuner takes HQPlayer management username/password from `HQPTUNER_HQP_USERNAME` / `HQPTUNER_HQP_PASSWORD` at startup (`hqptuner/config.py`) — no login screen — and uses them for HTTP Digest auth against 8088 (realm `com.signalyst.hqplayer.embedded`), holding credential server-side. Read-only use and all live (4321) settings work without them; only persistent writes and preset switching require them. 4321 `SessionAuthentication` crypto handshake **not** used, and daemon rejects self-generated client keys anyway. See `docs/protocol.md` §3.5–§3.6.

**Signal path bar** — live chain in physical processing order:

```
source → matrix → Bauer crossfeed → conversion stages → DAC correction → output rate
```

Crossfeed is input-side, operates on source-rate signal. **DAC correction is output-rate-dependent**, so runs *after* conversion stages and cannot precede filter. Disabled post-process stages omitted from bar entirely. Implementation and data sources: `hqptuner/static/components/SignalPath.js`.

## 4. Control surface

Control set **not enumerated in prose** — that duplication is what rotted old outline. Three artifacts own it, and they are checked:

- `hqptuner/static/store/schema.js` — every control, its lane, its widget, its `grayWhen` disclosure logic. Glue between control surface and two lanes.
- `hqptuner/data/settings.json` — tooltip prose for every exposed control, plus `_comment` block listing settings with upstream prose HQPTuner deliberately does not expose.
- `docs/settings-classification.md` — every control tagged live / http / file, with empirical evidence per field.

Tabs are **Output · Volume · Resampling · DSP · System** (registry: `static/components/tabs/index.js` — that file is authority, not this list). Loudness lives on Volume; crossfeed and matrix pipelines on DSP.

**LIVE is a mode, not a tab.** Header switch (`store/prefs.liveMode`) replaces whole tabbed body with one page of settings running engine can change in place (`static/components/LiveView.js`, fed by `store/live/model.js`). No staging and no Apply: every control writes on change and shows what engine reported back, not what was requested. Page is not second control surface — each control names its `schema.js` key and so carries same label, note and per-selection prose as its tab twin. Both filter chains render at once; edits to chain engine has not loaded are held per chain and applied when it loads, which is also how auto mode before playback works.

**Transport params are per-backend, not mode-gated** — Embedded `/config` form scopes device / DAC bits / DoP / 48k-DSD / buffer per backend (`alsa_*` vs `net_*`, independent values). "DAC bits grays in SDM / DoP grays in PCM" behavior belongs to *desktop* app, does not apply here. IPv6 is Network-only. ALSA / Network sections collapse by backend rather than gray; every field still persists (daemon rejects partial form).

## 5. Behavior rules

- **Disclosure by mode/backend.** Per-family rate control grays for inactive mode on the tabs view (Auto ungrays both). On LIVE the rule is the mode's, not the chain's: under an explicit PCM/SDM mode **both** columns take edits, the non-running family's being held until that family loads (`lanes/livechain.unpinnable_rate`), same rule as the dormant chain card; in **auto both gray**, because `[source]` accepts no rate on the wire at all (protocol.md §6) and the only slot that governs the rate there is the config limit, which costs a daemon restart to write. That gray is the page's one exception to *every control here applies now*, so it **carries a caption naming the restart** and pointing at the Output tab — a control the user cannot use must say why, and "it needs a restart" is the whole reason. **Chain and pin family are different questions and must not be conflated:** in auto a chain IS loaded and takes filter/shaper edits live (`active_chain`, resolved from `Status.active_rate`), while no rate is settable at all (`pin_family`). ALSA / Network sections **collapse** by backend. FFT filter length grays when no FFT-family filter selected. Graying carries no caption where reason string would reflow row on mode change (`quietGray`) — which is why the tabs' rate pair is quiet and LIVE's is not: LIVE's reason is fixed text shown in one mode only.
- **Rate-aware shaper list.** Dither/modulator options invalid at selected output rate grayed **with short reason** (e.g. "requires ≥ DSD1024"), never hidden — visible-but-disabled teaches constraint. Rate constraints come from static metadata; engine ships shaper names only.
- **Device-aware rate and mode graying.** Rate tiers and the SDM mode gray against what the selected output device announced it can carry. The daemon reports that nowhere on the wire — its `/config` form offers every rate whatever device is selected, and the Control API has no capability command — so the source is the device announcement in the daemon's own log, read over the same `GET /log` lane as the System tab (`hqptuner/engine/devicecaps.py`, frontend in `store/devicecaps.js`). A DSD tier the device did not announce natively is still reachable when DoP is on and the device announced its carrier rate, which is the DSD rate ÷ 16 (DoP v1.1). **Uncertainty narrows nothing:** no announcement, an announcement naming a device other than the staged one, or the `combo` backend (two devices, one announcement, unknown which limits bind) all leave every menu whole. Graying an option the hardware can in fact reach is the worse failure, so the rule is one-directional. Every grayed rate option carries the one word `unavailable` whatever made it unreachable — the reason renders on the option's own label and has no room for a sentence; the mode segment keeps the explanation, being the one surface with room. **A setting already sitting on an unreachable value falls back** — to the highest reachable tier, or to PCM where no DSD rate is reachable at all — **as a staged edit, never a display-only substitution**, so the pending bar shows it and Discard undoes it. That it costs a restart at Apply is the user's to spend (`CLAUDE.md`, user actions always proceed).
- **Mode switch coherence.** Flipping PCM ↔ SDM swaps rate option set and shaper card (label + option list) in same interaction.
- **Filter narrowing.** Genre/focus/quality AND-combine across both 1x and Nx lists. Empty result shows explicit "no filters match — widen criteria" state, never stale selection.
- **Graying reacts to staged values, not applied ones** — disclosure updates before Apply.
- **E-core allocation** meaningful only on hybrid CPUs; carries muted "hybrid CPUs only" caption.
- **Junk-filter advisor is advice-only.** Backend reads the engine's metering stream (`hqptuner/metering.py`, wire in `protocol.md` §7), classifies the playing track's spectrum (`hqptuner/junkadvisor.py` — signatures, thresholds and design rationale live in its module docstring), and surfaces a note in the alert-strip chip, present in both tabs and LIVE views. No apply button, no dismiss, no write path — user acts or ignores. Note clears on track change or once the engaged junk filter treats the signature (corner at or below the recommended one, or any rate-relative choice); `none` never clears it. Stream absence means "no recommendation", never a user-facing error. Rate-relative filters (2x/4x/8x) are never recommended.
- **No idle gating.** HQPTuner never refuses user action because daemon is playing — see binding rule in `CLAUDE.md`.
- **Matrix edits belong to the active matrix profile.** Post-process chain and pipeline rows are a property of a matrix context, not of the config. An apply never moves the listener off the profile they were on.
- **Crossfeed gate is mode-aware; the view selector never installs processing.** The card's one ENGAGE|BYPASS gate drives two mechanisms: in the Bauer view the `crossfeed_enabled` config key, in the Structural view install/removal of the sixteen-row matrix block (no config key exists for it). The Bauer|Structural switch below the gate selects a VIEW — it disables the mode being left and turns nothing on.

## 6. Static metadata

Shipped as JSON, extracted from HQPlayer manual, joined against live enumerations **by name** (§2):

- `data/filters.json` — prose, genre, notes, plus facet fallback (§2). Join rules documented in file's own `_join_rules` field: exact name → aliases → `-2s` suffix strip with two-stage note appended → render engine name bare.
- `data/shapers.json` — dither/modulator prose, order, type, and minimum/optimal rate constraints that drive §5's graying. Sole source for those constraints.
- `data/settings.json` — per-control tooltip prose, with `source` field citing manual §, readme §, or `hqptuner` for UI-native text.

Coverage guarded by `tests/test_metadata.py` and `scripts/validate_metadata.py`.

## 7. Presets

**HQPTuner owns its preset store** (`hqptuner/presetstore.py`) — full-config XML snapshots in directory we own, driven through one reliable daemon primitive, `POST /restore` onto `[default]`.

This reverses original design, which assumed hqplayerd's named-profile subsystem would serve. It will not: `POST /restore` drops daemon to `[default]` and ignores named working member, `profile/save` to existing name silently no-ops, and `/backup` empties after profile load. Daemon's own `data/cfgs/<name>.xml` files kept **mirrored** so its native web UI stays populated, but never HQPTuner's load/save path. Matrix profiles are separate and do switch cleanly live, via 4321 `MatrixSetProfile` (`docs/matrix-spec.md`).

Five operations, all built on that one primitive (`presetstore.py` plus `manager` preset methods):

- **Load** — restore preset's config as `hqplayerd.xml` (so it runs on `[default]`) and mirror to `data/cfgs/<name>.xml`. Never `profile/load`.
- **Save / Save-as-new** — snapshot current running config into store *and* mirror to `data/cfgs/<name>.xml` via restore. Never `profile/save`.
- **Delete** — remove from store, plus `profile/delete` for daemon's mirror (one native profile route that works cleanly).
- **Ephemeral Apply** — edit running config and restore it, touching neither store nor snapshot, so change reverts on next preset load. Lets user experiment freely without spending preset.
- **Migration** — on first connect, import daemon's existing `data/cfgs/*.xml` into store. Idempotent, store presets win on name collision, active pointer seeded from daemon's reported active config.

**Live presets are separate store, and deliberately so** (`hqptuner/livepresets.py`, routes in `api/livepresetapi.py`). Config preset above is whole `hqplayerd.xml` applied by restarting daemon; live preset is handful of enum IDs applied through LIVE lane, so it never writes config file and never restarts anything. Daemon never sees them — one JSON file HQPTuner owns, schema-stamped on `presetstore` pattern (refuse newer stamp, adopt unstamped on next write), same name rule.

Record holds output **mode**, both chain filters, dither/modulator, junk filter, adaptive volume and rate, each as value plus display name at save time — values apply, names only render, because engine-built enumerations shift under stored preset. Playback volume deliberately excluded: restoring level hands listener loudness jump they never asked for. Mode is included and is why apply is `livelane.apply_preset` rather than one batch (§2): mode first, re-enumerate, rest against lists switch produced. **Applying preset saved on other chain is not conflict to refuse** — switching is request. Preset whose stored ID running enumerations no longer offer refuses whole preset, naming field.

## 8. The event log

**Every durable write records what it was handed** (`hqptuner/audit.py`). Append-only JSON Lines, off unless `HQPTUNER_DEBUG_LOG` names a path; disabled instance is `AuditLog(None)` and its emitters are no-ops, so no call site ever guards on `enabled`.

**Success path is the point.** Staged edits live in server-side buffer and the apply that drains it clears it in same request (`api/app.py` `/config/apply`), so a write that landed wrong has no evidence left unless it was recorded as it happened. Failure-only logging answers nothing here.

Normative rules:

- **One instance, threaded from `ConnectionManager.audit`.** Each instance resumes `seq` from file on construction, so second copy reissues numbers first already used. Sequence that repeats is worse than none — it reads authoritative.
- **`conf/` stays pure.** XML editors take bytes and return bytes; no logging inside them. Profile writes emit at the two callers that land an element — fan-out into stored preset (`target` is `preset:<name>`) and running config (`target` is `config`) — which is also where pre-edit XML is in hand, so `replaced` is answerable.
- **Emitters are typed per event, never free-form.** Vocabulary is the contract, and it is what tests assert; log *text* stays off-limits per `docs/testing.md` rule 1. New durable write path gets an emitter, or reuses one — silent write is defect.
- **Values captured whole to 128 KB**, so a payload is recoverable from log rather than merely described by it; larger truncates, and record carries `truncated` plus `full_digests` keyed by dotted field path. File rolls to `<path>.1` past `max_bytes`.
- **`password` / `secret` / `token` never reach a record**, at any depth.
- **No UI, deliberately.** Operator's tool — set on container, read with `jq`, or over `GET /api/audit`, which exists only while the var is set.

## Provenance

Control API implementation derived from Jussi Laako's official `hqp-control` utility source, itself MIT-licensed, with attribution. `unified-hifi-control` (PolyForm Noncommercial) and `hqpwv` (GPL-3) **not** to be opened or copied. HQPTuner carries MIT. Jussi has no objection to alternative interfaces.