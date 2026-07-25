# HQPTuner — architecture and normative rules

Replaces `outline.md` (removed 2026-07-25 — it had drifted into a stale UI snapshot). Section numbers are preserved from that file so the `architecture §N` citations throughout the codebase keep their meaning.

**This document carries rules, not inventories.** The old outline rotted because it duplicated the control list and the tab layout in prose, and prose does not get updated by `make check`. Everything enumerable here points at the artifact that owns it instead.

## 1. Scope

HQPTuner is a configuration interface for HQPlayer Embedded — it replaces the stock configuration, matrix and speaker pages for day-to-day settings work.

**Non-goals:** playback, library, or media control of any kind; the standalone convolution-engine page (convolution *within* matrix pipelines is in scope). Matrix pipeline editing was originally cut as too complex and un-cut on 2026-07-20 — design of record is `docs/matrix-spec.md`.

## 2. Integration lanes, and enumeration volatility

Two lanes reach hqplayerd:

1. **Control API (TCP 4321)** — XML messages, unauthenticated. Runtime-switchable settings (filters, dither/modulator, mode, rate, matrix profile) and all status/metering. No restart. Changes are **memory-only and never persisted** — see the divergence rule below. Wire reference: `docs/protocol.md`.
2. **HTTP interface (TCP 8088, Digest auth)** — `GET /config` is the read side for persistent settings and their constraints. Persistent **writes** ride the **restore lane**: fetch `/backup`, surgically edit the field in the config XML, push with `POST /restore` (`scope=system`), on which the daemon self-restarts in ~5.6 s.

> **There is no `POST /config`.** `/config` is GET-only. The genuine form POSTs are `POST /matrix`, `POST /matrix/{load,save,delete}` and `POST /speakers` (~3 s engine reload each), plus `POST /config/profile/delete` for removing a preset mirror. Per-field lane assignments and the full evidence base live in `docs/settings-classification.md`.

Normative rules:

- **Enumeration volatility.** Filter/shaper names and list ordering change between HQPlayer versions; the config file stores numeric enum **IDs** while the wire uses list **indices**. The running engine's enumeration queries (`GetModes`, `GetFilters`, `GetShapers`, `GetRates`, `GetJunkFilters`) are the sole runtime authority for names, IDs and ordering. Static `data/*.json` joins **by name** and never overrides live data; an engine entry with no metadata match still renders (name only). Never ship a constant where an engine-reported value belongs.
- **Never mix the index and ID domains.** `Set*` and `State` speak list index; `hqplayerd.xml` stores enum ID. Translating between lanes requires the live lists.
- **Mode-relative enumerations, no pre-capture.** The engine returns only the current mode's lists (SDM lists in SDM, PCM lists in PCM), and they differ wholesale — indices shift between modes. Re-run the enumeration queries on every mode switch rather than filtering a cached list; never flip modes to pre-capture the other one. Mode index 0 (`[source]`) keeps the current lists.
- **Static facet fallback (2026-07-24).** Because the live enum only covers the *active* mode, filters exclusive to the inactive mode had no facets and bypassed narrowing. quality/focus/apodizing/ratio are transcribed into `data/filters.json` and consumed by `store/facets.js` as a **fallback for filters the live enum omits**. Live stays sole authority for the active mode.
- **Live-vs-file divergence is real and must be surfaced, not assumed away.** hqplayerd never writes Control API changes to `hqplayerd.xml` — not while running, not at shutdown (verified: md5-identical across a `systemctl stop` with an unsaved change in memory). The running engine can differ from the file indefinitely. Read both lanes; show the divergence.
- **`result="OK"` is not proof of application.** Always verify by `State` readback.
- **Live vs restart split.** Every control is classified live or restart-required; the pending-changes bar reports the split before Apply. Tagging: `docs/settings-classification.md`.

## 3. Auth, and the signal path order

**Auth.** HQPTuner takes the HQPlayer management username/password from `HQPTUNER_HQP_USERNAME` / `HQPTUNER_HQP_PASSWORD` at startup (`hqptuner/config.py`) — there is no login screen — and uses them for HTTP Digest auth against 8088 (realm `com.signalyst.hqplayer.embedded`), holding the credential server-side. Read-only use and all live (4321) settings work without them; only persistent writes and preset switching require them. The 4321 `SessionAuthentication` crypto handshake is **not** used, and the daemon rejects self-generated client keys anyway. See `docs/protocol.md` §3.5–§3.6.

**Signal path bar** — the live chain in physical processing order:

```
source → matrix → Bauer crossfeed → conversion stages → DAC correction → output rate
```

Crossfeed is input-side and operates on the source-rate signal. **DAC correction is output-rate-dependent**, so it runs *after* the conversion stages and cannot precede the filter. Disabled post-process stages are omitted from the bar entirely. Implementation and its data sources: `hqptuner/static/components/SignalPath.js`.

## 4. Control surface

The control set is **not enumerated in prose** — that duplication is what rotted the old outline. Three artifacts own it, and they are checked:

- `hqptuner/static/store/schema.js` — every control, its lane, its widget, and its `grayWhen` disclosure logic. This is the glue between the control surface and the two lanes.
- `hqptuner/data/settings.json` — tooltip prose for every exposed control, plus a `_comment` block listing settings with upstream prose that HQPTuner deliberately does not expose.
- `docs/settings-classification.md` — every control tagged live / http / file, with the empirical evidence per field.

Tabs are **Output · Volume · Resampling · DSP · System** (registry: `static/components/tabs/index.js` — that file is the authority, not this list). Loudness lives on Volume; crossfeed and matrix pipelines on DSP.

**Transport params are per-backend, not mode-gated** — the Embedded `/config` form scopes device / DAC bits / DoP / 48k-DSD / buffer per backend (`alsa_*` vs `net_*`, independent values). The "DAC bits grays in SDM / DoP grays in PCM" behavior belongs to the *desktop* app and does not apply here. IPv6 is Network-only. ALSA / Network sections collapse by backend rather than gray; every field still persists (the daemon rejects a partial form).

## 5. Behavior rules

- **Disclosure by mode/backend.** The per-family rate control grays for the inactive mode (Auto ungrays both). ALSA / Network sections **collapse** by backend. FFT filter length grays when no FFT-family filter is selected. Graying carries no caption where a reason string would reflow the row on mode change.
- **Rate-aware shaper list.** Dither/modulator options invalid at the selected output rate are grayed **with a short reason** (e.g. "requires ≥ DSD1024"), never hidden — visible-but-disabled teaches the constraint. The rate constraints come from static metadata; the engine ships shaper names only.
- **Mode switch coherence.** Flipping PCM ↔ SDM swaps the rate option set and the shaper card (label + option list) in the same interaction.
- **Filter narrowing.** Genre/focus/quality AND-combine across both 1x and Nx lists. An empty result shows an explicit "no filters match — widen criteria" state, never a stale selection.
- **Graying reacts to staged values, not applied ones** — disclosure updates before Apply.
- **E-core allocation** is meaningful only on hybrid CPUs; carries a muted "hybrid CPUs only" caption.
- **No idle gating.** HQPTuner never refuses a user action because the daemon is playing — see the binding rule in `CLAUDE.md`.

## 6. Static metadata

Shipped as JSON, extracted from the HQPlayer manual, joined against live enumerations **by name** (§2):

- `data/filters.json` — prose, genre, notes, plus the facet fallback (§2). Join rules are documented in the file's own `_join_rules` field: exact name → aliases → `-2s` suffix strip with a two-stage note appended → render engine name bare.
- `data/shapers.json` — dither/modulator prose, order, type, and the minimum/optimal rate constraints that drive §5's graying. Sole source for those constraints.
- `data/settings.json` — per-control tooltip prose, with a `source` field citing manual §, readme §, or `hqptuner` for UI-native text.

Coverage is guarded by `tests/test_metadata.py` and `scripts/validate_metadata.py`.

## 7. Presets

**HQPTuner owns its preset store** (`hqptuner/presetstore.py`) — full-config XML snapshots in a directory we own, driven through the one reliable daemon primitive, `POST /restore` onto `[default]`.

This reverses the original design, which assumed hqplayerd's named-profile subsystem would serve. It will not: `POST /restore` drops the daemon to `[default]` and ignores a named working member, `profile/save` to an existing name silently no-ops, and `/backup` empties after a profile load. The daemon's own `data/cfgs/<name>.xml` files are kept **mirrored** so its native web UI stays populated, but are never HQPTuner's load/save path. Matrix profiles are separate and do switch cleanly live, via 4321 `MatrixSetProfile` (`docs/matrix-spec.md`).

## Provenance

The Control API implementation is derived from Jussi Laako's official `hqp-control` utility source, itself MIT-licensed, with attribution. `unified-hifi-control` (PolyForm Noncommercial) and `hqpwv` (GPL-3) are **not** to be opened or copied. HQPTuner carries MIT. Jussi has no objection to alternative interfaces.
