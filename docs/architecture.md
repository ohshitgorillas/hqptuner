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

**Transport params are per-backend, not mode-gated** — Embedded `/config` form scopes device / DAC bits / DoP / 48k-DSD / buffer per backend (`alsa_*` vs `net_*`, independent values). "DAC bits grays in SDM / DoP grays in PCM" behavior belongs to *desktop* app, does not apply here. IPv6 is Network-only. ALSA / Network sections collapse by backend rather than gray; every field still persists (daemon rejects partial form).

## 5. Behavior rules

- **Disclosure by mode/backend.** Per-family rate control grays for inactive mode (Auto ungrays both). ALSA / Network sections **collapse** by backend. FFT filter length grays when no FFT-family filter selected. Graying carries no caption where reason string would reflow row on mode change.
- **Rate-aware shaper list.** Dither/modulator options invalid at selected output rate grayed **with short reason** (e.g. "requires ≥ DSD1024"), never hidden — visible-but-disabled teaches constraint. Rate constraints come from static metadata; engine ships shaper names only.
- **Mode switch coherence.** Flipping PCM ↔ SDM swaps rate option set and shaper card (label + option list) in same interaction.
- **Filter narrowing.** Genre/focus/quality AND-combine across both 1x and Nx lists. Empty result shows explicit "no filters match — widen criteria" state, never stale selection.
- **Graying reacts to staged values, not applied ones** — disclosure updates before Apply.
- **E-core allocation** meaningful only on hybrid CPUs; carries muted "hybrid CPUs only" caption.
- **No idle gating.** HQPTuner never refuses user action because daemon is playing — see binding rule in `CLAUDE.md`.

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

## Provenance

Control API implementation derived from Jussi Laako's official `hqp-control` utility source, itself MIT-licensed, with attribution. `unified-hifi-control` (PolyForm Noncommercial) and `hqpwv` (GPL-3) **not** to be opened or copied. HQPTuner carries MIT. Jussi has no objection to alternative interfaces.