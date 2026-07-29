# LIVE mode — implementation plan

Approved 2026-07-27. Feature: a `LIVE [ON|OFF]` switch at the top of the app. ON drops the tab bar and shows one page holding only the controls the engine can change **right now without a restart**. No staging, no Apply button — every control writes the moment it is changed. Plus **live presets**: named, saved combos of live settings.

**How to work this plan:** phases are ordered and self-contained. Do ONE phase at a time, run its acceptance gate, stop, hand back. Do not read ahead past the current phase's "Files" list, do not start the next phase in the same turn, do not refactor anything a phase does not name. Every fact you need is in §Ground truth — do not re-derive wire behavior, and when in doubt trust this section over inference (it was verified against the manual, the readme, protocol.md, and the live daemon on 2026-07-27).

## Ground truth (verified — do not re-verify, do not contradict)

**Controls that are live-adjustable, and their wire mechanics:**

| Control | Setter | Readback (`State`) | Enum | Availability |
|---|---|---|---|---|
| Output mode | `SetMode` | `mode` | `modes` | always |
| 1x filter | `SetFilter value1x` | `filter1x` | `filters` | active chain only |
| Nx filter | `SetFilter value` | `filterNx` | `filters` | active chain only |
| Dither / modulator | `SetShaping` | `shaper` | `shapers` | active chain only |
| Rate | `SetRate` | `rate` | `rates` | always (list is mode+filter dependent) |
| Junk (20 kHz) filter | `SetJunkFilter` | `filter_junk` | `junk_filters` | always |
| Adaptive volume | `SetAdaptiveVolume` | `adaptive` | — (0/1) | existing `grayWhen` applies |
| Playback volume | existing `POST /api/volume` | `volume` | — | `VolumeRange enabled=1` |
| Matrix profile | existing `POST /api/matrix/profile` | `matrix_profile` | — | profiles exist |

- **Chain gating:** `GetFilters`/`GetShapers` enumerate only the ACTIVE mode's chain; `lanes/livemap.py` `active_chain()` resolves it (configured mode when pcm/sdm; `Status.active_mode` in auto; `None` when unknowable). When `None`, filter/shaper/dither controls are NOT live-adjustable — the LIVE page hides that section with a caption, it does not guess.
- **Rate semantics (measured 2026-07-28, supersedes the 2026-07-27 entry).** `SetRate` writes `samplerate`/`bitrate` ("Sample rate"/"Bit rate" on the daemon's form), NOT the `defaults_samplerate`/`defaults_bitrate` limit ("Rate limit"). The 2026-07-27 claim that a nonzero request family-adjusts downward was **wrong** — it read readme §1.3.1's caveat, which is attached to the limit slot only. `scripts/probe_rate_slots.py`, 44.1 kHz source, limit DSD512: request unset → 22579200; request `12288000` → 12288000; request `49152000` → 49152000. The request slot is an **exact rate that ignores both the limit and the source's base family**. Consequences, all binding: `FORCED_CONFIG` must keep pinning it to `0`, because a config write has no source and would otherwise override the user's `alsa_anydsd`/`net_anydsd` decision; LIVE may write it, but only after resolving the picked tier against the playing source (`store/live.js`); and `livemap.live_overrides` carries the pin back as its tier in the limit field, which is what makes the two views agree. `SetRate` takes the **`RatesItem` index** (index 0 = auto); the enum carries actual Hz.
- **The rate pin is single and `SetMode` clears it (measured 2026-07-28, `scripts/probe_mode_rate_pin.py`).** The request slot is not per family in the engine, contrary to what the two form fields suggest: pin DSD64 in SDM → `State.rate` index 1; `SetMode` PCM → `State.rate` index 0; pin 44100 there; `SetMode` back to SDM → `State.rate` index 0, the SDM pin gone. So `State` answers only for the family the engine is running, and only until the next mode switch. HQPTuner therefore owns the per-family memory: `ConnectionManager.live_rates` (family → Hz) is recorded by `lanes/livelane` on every verified LIVE rate write, re-asserted with `SetRate` after every verified mode write — resolved against the POST-switch rates list, which is mode-dependent (manual §4.6) — and dropped for a family whose remembered tier the entered mode does not offer, rather than pinned to a neighbour the user never picked. `livemap.live_overrides` then reports BOTH families' limit fields off that memory, with the engine's own reported pin winning for the family it is running. The LIVE rate columns read the same overlay the Output tab grounds on (`runningValue`, `store/live.js`), so the two views cannot drift apart. Process-lifetime memory: a daemon restart drops the pins anyway.
- **`SetFilter` pairing:** `value` alone sets BOTH 1x and Nx. One-sided edits must be completed from `State` — `livemap._complete_filter_pair` already does this; reuse it, never reimplement.
- **Mode + chain fields in one batch cannot route live** (`livemap._mode_blocks_batch`): `SetMode` swaps the enum lists mid-batch. The LIVE endpoint must refuse such a batch (409), not fall through.
- **Enum refresh:** `manager._poll` re-enumerates only on a mode-index change. The `rates` list also depends on the selected filter (manual §4.6), and filters/shapers swap on mode change — Phase 2 makes the live endpoint re-enumerate after any successful write batch that included mode, filter, or rate.
- **`result="OK"` is not proof** (protocol.md §4): every live write verifies by `State` readback. `writer.apply_live` already does this; reuse.
- **The pending store is shared** (`api/app.py` `PendingStore`): `POST /config/apply` flushes EVERYTHING staged. LIVE writes must therefore never touch the pending store — that is the entire reason Phase 2's endpoint exists instead of reusing stage+apply.
- **NEVER IDLE-GATE (binding, `CLAUDE.md`):** no LIVE control checks playback state before writing. Whatever a change costs mid-stream is the user's to spend; captions state costs, clicks execute. Do not add playback-state guards, do not investigate mid-stream setter behavior — it is irrelevant to this design by rule.
- `writer.py` already has the setter table entry `"rate": LiveSetting("SetRate", "rate")` — the backend rate path exists; only routing exposes it.

**Bindings that apply to every phase:** `docs/testing.md` before writing any test; `docs/design-system.md` before any CSS/layout; `make check` green before every commit; CHANGELOG entry rides the commit that lands each user-visible change; markdown soft-wrapped; after any code edit run `/task-check` and hand back at the URL it prints.

## Phase 1 — expose `active_chain` on `GET /api/state`

**Goal:** frontend can know which chain's controls are live-adjustable without duplicating State/Status fallback logic in JS.

**Files:** `hqptuner/api/app.py` (the `/state` route), tests beside the existing `/api/state` tests.

**Change:** add `active_chain` to the `/api/state` response: the value of `livemap.active_chain(manager)` — `"pcm"`, `"sdm"`, or `null`.

**Tests (behavior, one assertion each):** configured-pcm → `"pcm"`; configured-sdm → `"sdm"`; auto mode with `Status.active_mode` reporting a DSD string → `"sdm"`; auto with neither answerable → `null`.

**Acceptance:** `make check` green. Stop, hand back.

## Phase 2 — `POST /api/config/live` (batch immediate apply)

**Goal:** one endpoint that applies a batch of live-lane fields immediately, verified, without touching the pending store, and that can never restart the daemon.

**Files:** `hqptuner/api/app.py` (new route + body model), `hqptuner/lanes/livemap.py` (rate routing addition), `hqptuner/manager.py` (one new method), tests.

**Contract:**

- Body: `{"fields": {"<field>": "<value>", ...}}` — config-form-domain values for the seven `ROUTABLE` fields, plus `adaptive_volume` (`DIRECT`), plus a new `rate` field (`RatesItem` Hz value or `"0"` for auto; translated to index via the `rates` enum).
- All-or-nothing: resolve every field first (chain, enum, value); if ANY field fails to resolve, 409 with per-field reasons, nothing applied. A mode change batched with chain fields is one of those 409s (`_mode_blocks_batch` logic).
- Apply via `writer.apply_live`, readback-verified; refresh `manager.state` after (mirror of `manager.apply`'s live half); re-enumerate (`get_all_enumerations`) when the batch included mode, a filter, or rate, so the next `GET /api/enumerations` serves fresh lists.
- Response: per-field `ok` report, same shape as apply's `live` report entries.
- **Do not** call `httplane`, **do not** read or clear the `PendingStore`, **do not** add any playback-state check.

**Tests:** single field applies + verifies; chain-mismatched filter → 409, nothing applied; mode+filter batch → 409; rate Hz→index translation + apply; unknown field → 422; pending store contents untouched by a successful live write. Fakes speak the 4321 wire protocol (`docs/testing.md`).

**Acceptance:** `make check` green. Stop, hand back.

## Phase 3 — live presets (backend)

**Goal:** named, saved combos of live settings, stored HQPTuner-side (the daemon never sees them).

**Files:** new `hqptuner/livepresets.py`, routes in `hqptuner/api/app.py`, tests.

**Contract:**

- A live preset stores: name, chain tag (`"pcm"`/`"sdm"`), and config-form-domain values for the chain's filter/shaper fields plus junk filter, adaptive volume, and rate (Hz). Values are enum IDs / literal values plus the display name at save time (names shown even if the engine's lists later shift; IDs are what applies). **Mode is deliberately not stored** — a mode+chain batch cannot route live (§Ground truth); the chain tag covers intent.
- Storage: `state/live-presets.json`, one file, schema-stamped exactly on the `presetstore.py` pattern: `_SCHEMA = 1`, refuse a higher stamp, adopt an unstamped file on next write. Same name-validation regex approach as `presetstore._NAME_RE`.
- Routes: `GET /api/livepresets` (list, each with a `compatible` bool against current `active_chain`), `PUT /api/livepresets/{name}` (snapshot current live state — read values off `manager.state` via the same State-attribute mapping the schema uses), `POST /api/livepresets/{name}/apply` (resolve to a batch and hand it to the Phase 2 apply path — its 409 semantics carry over unchanged), `DELETE /api/livepresets/{name}`.
- **Do not** touch `presetstore.py`, the daemon mirror, or any 8088 route.

**Tests:** save/load round-trip; apply routes through the live path and verifies; wrong-chain apply → 409; unknown enum ID in a stored preset → 409 naming the field; higher schema stamp refused; invalid name refused.

**Acceptance:** `make check` green. Stop, hand back.

## Phase 4 — frontend: LIVE switch + LiveView

**Goal:** the switch and the page, wired to Phases 1–2. Live presets UI is NOT in this phase.

**Read first:** `docs/design-system.md` (binding), `static/components/tabs/index.js`, `static/store/state.js`, `static/components/PlaybackVolume.js`.

**Files:** `static/components/App.js`, new `static/components/LiveView.js`, `static/store/prefs.js` (persist the switch), `static/store/state.js` (live-write helper + `active_chain` mirror), CSS per design system.

**Contract:**

- Switch renders in the chrome top next to the tab bar; ON hides `TabBar`, `TabBody`, and `PendingBar`, renders `LiveView`; state persists in prefs.
- LiveView sections, top to bottom: mode segment; rate menu (options from the live `rates` enum — Auto plus Hz values formatted for display; caption: "Live rate is temporary — any Apply or restart returns it to the configured limit"); active-chain filter/shaper dropdowns labeled with the chain, whole section replaced by a one-line caption when `active_chain` is null ("Auto mode, chain unknown until playback starts"); junk filter; adaptive volume (existing gray rules); playback volume + `VolumeRangeBar` (reuse components as-is); matrix profile picker (existing endpoint).
- Every control writes on change via `POST /api/config/live` (singleton batch): in-flight indicator on the control, settle on the verified report, inline error caption on 409/failure (last error per control wins; no toast stack).
- After a mode or filter or rate write, re-mirror enumerations before re-rendering dependent dropdowns (Phase 2 already refreshed them server-side); show the section in a brief loading state meanwhile.
- Dirty pending buffer from tabs view: show a small chip "N staged changes waiting in tabs view" — inform, never block, never flush.
- **Do not** stage anything, **do not** disable any control because playback is active, **do not** reuse `applyAll`.

**Acceptance:** `make check` green (JS gates included), `/task-check` PASS, hand back at its URL. **User's eyes gate this phase** — no visual claim of done without their verdict.

## Phase 5 — frontend: live presets card

**Goal:** picker card at the top of LiveView against Phase 3's routes.

**Files:** `static/components/LiveView.js` (card), `static/store/` (small livepresets fetch/mirror module), CSS.

**Contract:** dropdown of presets with incompatible ones grayed (caption: "PCM preset — engine running SDM"), Apply-on-select, Save (name via existing `Ask` component, snapshots current state), Delete with `Ask` confirm. Errors surface inline on the card, same style as Phase 4 controls.

**Acceptance:** `make check` green, `/task-check` PASS, hand back. User's eyes gate.

## Phase 6 — docs + changelog

**Files:** `docs/architecture.md` (LIVE view joins the UI section; the immediate-apply lane documented beside stage/apply; live presets beside the preset store), `README.md` (feature blurb), `CHANGELOG.md` `[Unreleased]`, `docs/settings-classification.md` (one line under the rate row: SetRate = target slot, live-routable, ephemeral under FORCED_CONFIG — with the 2026-07-27 evidence).

**Acceptance:** `make check` green (soft-wrap hook enforces markdown rules). Stop, hand back.

## Defaults chosen (cheap to change at hand-back, flag any objection then)

- Switch placement: chrome top, right of the tab bar.
- Pending-edits interaction: informational chip, never a blocking prompt.
- Matrix profile picker and playback volume: included in LiveView v1.
- Naming: "live presets" (user's term, 2026-07-27); UI copy must keep them visually distinct from config presets and matrix profiles, which share the page.
