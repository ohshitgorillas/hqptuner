# Matrix pipeline editing — design of record

Approved 2026-07-20. Reverses outline §1's "matrix editing cut" non-goal. This file is the spec of record for the Matrix tab; the investigation findings and probe results it rests on are appended below.

## Spec (verbatim, user-approved)

**0. Process.**
Amend outline §1 and roadmap first: matrix editing is un-cut, with a pointer to this spec as the design of record. The round-6 spacing system is law for this tab — tokens, two-track grid, equal-height card rows, definition of done, and the hand-back protocol (fresh screenshots, PASS/FAIL per acceptance criterion) all apply.

**1. Probes (idle-gated, approved — run before finalizing the plan).**
The five open questions from the investigation: POST /matrix contract (complete-form requirement, checkbox encoding, restart vs live-apply), /matrix/plot response format and side effects, Lin gain XML representation (set Lin via stock UI, diff the XML), filter upload destination and restore-lane behavior, /matrix/load restart behavior. Deliverable: a findings note appended to the investigation report, and any spec adjustments below flagged rather than silently made.

**2. Tab structure.**
New Matrix tab between Volume and System. Section order: MATRIX (global card: Enabled, Engine, Expand HF, IIR→FIR — four short controls, two-track pack) | PROFILE card sharing the row (active profile select, Load / Save / Save as new / Delete, live-switch via the 4321 lane with an "applies live — no restart" indicator; matrix_profile CRUD via the daemon's /matrix/{load,save,delete} routes per the investigation's recommendation) | PIPELINES section | RESPONSE section. Post-process controls stay on the DSP tab — no duplication.
*Acceptance: tab renders in both accent themes and both hero states; global+profile cards equal height; profile switch while playing does not interrupt playback.*

**3. Pipeline flow rows.**
Each pipeline renders as one flow row: source-channel chip → ordered stage chips → gain chip → target-channel chip, connectors between. Chip color encodes stage kind: channel endpoints blue, IIR stages amber, convolution green, gain neutral. Row controls: add-stage affordance at chain end, plot toggle at row end, remove row, add pipeline below the list. Rows are grouped or badged by target channel so summing is visible; section header shows active/max count. Source/target selects cover wire 0–127 as labels 1–128.
*Acceptance: create, edit, reorder (drag stages within a chain), and delete pipelines and stages entirely client-side before apply; layout holds at 16 rows without horizontal scroll at 1280; chip palette passes contrast in both accent themes.*

**4. Stage editor.**
Selecting a stage outlines it accent and docks an inline editor panel under the row — no modal. Panel shows plugin-specific fields for all 11 IIR types (including raw biquad b0..a2), delay (s/t/d/v), riaa, and convolution (file upload per stage, filename shown, warn when sample rate deviates from the 352.8 kHz recommendation). The panel footer always displays the generated raw spec string live, with a toggle that flips the whole row between chip view and an editable raw comma-string — two-way synced, chips regenerate on blur, parse errors shown inline without destroying the string. Specs are emitted case-sensitively per manual §7.
*Acceptance: every stock-manual example string round-trips string→chips→string byte-identical; invalid raw input never crashes the row or silently drops stages.*

**5. AutoEq / REW import.**
"Import AutoEq / REW txt" action on the Pipelines section: paste or file upload, parsed into ParametricEQ stages appended to a chosen pipeline (or mirrored to a stereo pair in one step). Preamp lines map to the pipeline gain chip.
*Acceptance: a stock AutoEq result file and a REW EQ export both import without manual edits; resulting spec string matches what the manual documents for ParametricEQ.*

**6. Response plot.**
RESPONSE card at section bottom, styled like the crossfeed/loudness graphs: overlaid magnitude (solid) + phase (dashed) for plot-toggled rows, log frequency axis 20–20k. Client-side via dsp.js extended with lp/hp/bp/ap/notch/lp1/hp1/biquad from the RBJ cookbook; delay = flat magnitude linear phase; RIAA = fixed known curve. Convolution stages: per the probe result, either daemon /matrix/plot fallback or client-side FFT of the uploaded IR — pick one after probing, don't build both. Plot updates live while a stage editor field changes.
*Acceptance: client-side curves match daemon /matrix/plot output for a 3-stage IIR chain within visual tolerance; live edit→plot latency imperceptible.*

**7. Wire-up.**
Extend the form parser for grouped indexed row fields, datalist capture, and the malformed gainunit HTML noted in the investigation — with offline tolerance tests. Writes ride the existing apply/staged lane; pipeline row add/remove goes through whichever of presetconf-XML vs daemon routes the probes show is cleaner, flagged if it changes the staged/live split. Gain unit ships dB-only; Lin (and any polarity-invert affordance) is deferred until the Lin XML probe answers, tracked as an explicit follow-up, not silently dropped.
*Acceptance: apply produces XML the daemon accepts and a restore-lane snapshot that round-trips; staged-changes bar counts matrix edits correctly.*

**8. Delivery order.** Probes → parser groundwork + read-only Matrix tab rendering existing config as flow rows → editing + apply → stage editor with raw sync → profiles → import → plots. Each phase lands with the standard PASS/FAIL hand-back.

## Delivery status (active checklist — update at every phase hand-back)

Seven phases (§8). The feature is not landed/complete/shipped until the step-7 hand-back passes.

- [x] **1 — probes** (findings below; all five questions closed)
- [x] **2 — parser groundwork + read-only tab** (accepted 2026-07-20 with notes, resolved at step-3 start: bordered row containers with plot-toggle position reserved; delay/riaa chips amber — palette rule is channels blue / convolution green / gain neutral / all other processing amber; "In n"/"Out n" labels approved-keep)
- [ ] **3 — editing + apply** (pipeline add/remove, source/target/gain edits, staged-lane apply → daemon-accepted XML, staged-bar counts matrix edits, restore-lane round-trip)
- [ ] **4 — stage editor** (inline docked panel, 11 IIR types + delay + riaa + convolution upload, live spec string, chip ↔ raw two-way sync on matrixspec.js)
- [ ] **5 — profiles** (4321 live switch, Load/Save/Save-as-new/Delete, "applies live" indicator, read-only note removed)
- [ ] **6 — AutoEq / REW import**
- [ ] **7 — response plots** (dsp.js extensions; client-side FFT for convolution per probe ruling)

Standing hand-back requirements (every phase from 3 on): fresh 1280 screenshots, DOM-measured PASS/FAIL, **both accent themes + both hero states measured — never "by construction"**, and both live daemon state **and** the 16-row / 8-stage worst-case mock via `/api/matrix` route interception (standing fixture, established at step 2).

## Investigation report (2026-07-20)

### Feature inventory (live 6.0.4 form, captured)

Single `POST` form, `enctype="multipart/form-data"` (file inputs force it), nameless Apply submit — same route-signals-apply pattern as `/config`.

| Control | Widget | Wire field | XML ground truth (readme §1.11) |
|---|---|---|---|
| Matrix enabled | checkbox | `enabled` | `<matrix enabled>` (mapped as `matrix_enabled`) |
| Engine | select | `engine` = 0 overlap-save / 1 overlap-add | `<matrix engine>` |
| Expand HF | checkbox | `expand_hf` | `<matrix expand_hf>` |
| IIR to FIR | select | `iir2fir` = 0 none / 1 direct / 2 linear | `<matrix iir2fir>` |
| Profile | text + datalist + 3 submits | `profile`; `formaction=/matrix/{load,save,delete}` | `<matrix_profile name>` top-level elements |
| Pipeline rows ×N | table | `source_i`, `gain_i`, `gainunit_i` (dB/Lin), `mixdown_i`, `process_i`, `plot_i`, `filter_i` (file, wav/txt, multiple) | `<pipeline channel source gain mixdown process/>` inside `<matrix>` |
| Plot | submit | `formaction=/matrix/plot` | magnitude + phase response per checked row (manual §7) |

Row count follows `channels` (2 on Opal). Source/mixdown selects span wire 0–127, labels 1–128. `matrix_profile` elements carry full 16-row sets independent of active channel count. Daemon emits malformed HTML in the gainunit options (`value="dB""` — stray quote).

### Semantics (manual §7, §7.1–7.4)

- Pipelines = virtual channels: copy source ch → process chain → gain → mix to target; same target = summed. Max 128; active count = `pipelines`/`channels` setting.
- Gain unit: dB or linear; **linear may be negative = phase inversion** (M/S processing). XML `gain` attr documented as dBFS only; Lin persistence unknown (probe).
- Process chain, comma-separated: plugin specs (`iir:` 11 types incl. raw biquad, args f/q/bw/s/g/b0..a2, case-sensitive; `delay:` s/t/d/v; `riaa:` subsonic), convolution impulse WAV filenames (352.8 kHz recommended; Expand HF extends low-rate filters), and REW/AutoEq ParametricEQ .txt directly.
- IIR-to-FIR converts parametric EQs to convolution (GPU-offload friendly; linear option introduces pre-ringing, best for gentle EQ).
- Matrix + separate convolution engine simultaneously: not recommended (manual note).
- Matrix profile switchable live during playback — 4321 `MatrixSetProfile` / `MatrixListProfiles` / `MatrixGetProfile`; `State.matrix_profile` reports active name.

### Existing HQPTuner coverage

- `GET /matrix` polled and parsed (flat fields) → `/api/matrix` → frontend `matrixByName`, schema `endpoint:"matrix"`; post-process trio (correction/bauer/loudness) fully wired.
- Writes ride the snapshot-XML restore lane (`presetconf.PLUGIN_MAP`); only `matrix_enabled` + post-process plugin attrs mapped. Pipeline rows, engine/expand_hf/iir2fir, matrix_profile CRUD unmapped.
- Plot infra: `dsp.js` has exact RBJ biquads (lshelf/hshelf/peak/peakq) + magnitude eval; remaining IIR types are small cookbook additions; phase = same transfer function via atan2. Delay/RIAA trivial. Convolution IR plotting needs probe decision.

### Known gaps the feature hits

- Form parser: no indexed-row grouping, no datalist capture, gainunit malformed-HTML tolerance unverified.
- `presetconf` edits single-occurrence tags; `<pipeline>` is multi-instance (match by `channel`) and needs row add/remove, not just attr edits.
- Filter upload storage destination unknown.

## Probe findings (2026-07-20, idle-gated, live 6.0.4)

**`/matrix/plot`** — HTTP 200 `text/html` (~2 KB), **no side effects**: form values, matrix XML, and engine all untouched; no config reload triggered. No `<img>` tags — plot data is inline (response saved to scratchpad, format parse pending). Daemon computes server-side (journal logs `plot magnitude value range`). Safe to call freely.

**`POST /matrix` (complete form)** — applied and **persisted immediately** to the working config XML (`gain_0` 0→0.01 verified in `hqplayerd.xml`), and triggers an **internal config reload: 4321 drops ~2.6 s, back ~5.7 s**. Not a full restart, but the Control connection drops and playback would be interrupted. **Spec adjustment flagged (§2):** the "applies live — no restart" indicator cannot describe form-lane applies; only 4321 `MatrixSetProfile` can be truly live (probe pending).

**Partial POST** — silently ignored: HTTP 200, no `Failed` marker, no reload, state unchanged. Complete-form contract confirmed; rejection is *fully silent* (worse than `/config`, which at least says `Failed!`).

**Checkbox encoding — DAEMON BUG, probe class retired.** Submitting `enabled=on` (the HTML-default checkbox value) instead of `enabled=1`: the daemon **writes the invalid value verbatim into `hqplayerd.xml`** (`<matrix enabled="on">`), then **fails engine init on the reload — and on every subsequent startup**, since it re-reads the broken file. Symptoms: 4321 refused indefinitely, `/matrix` 307-redirects to `/config`, `/backup/settings.zip` returns 401. Service restart alone does not recover; the config file must be repaired (recovered by restoring the pre-probe `hqplayerd.xml` + `systemctl restart`). Consequence for HQPTuner: checkbox values on the matrix form are **unvalidated garbage-in** — the writer must guarantee `1`/omitted encoding; report to Signalyst.

**Restore-verify transient (not a bug in our lane):** immediately after a matrix reload, the DAC-correction select can render with an empty option list while the output device re-discovers, so a too-early readback shows `post_correction_dac0=""`. Verified false alarm — form returned byte-pristine after recovery. Apply verification must retry/settle before judging device-derived fields.

## Probe findings, round 2 (2026-07-20, idle-gated; all state restored and readback-verified pristine)

**Lin gain — resolved.** The XML `gain` attribute stores linear gain with an **`L` prefix**: `gain="L0.5"`, `gain="L-1"`; bare number = dB. Round-trips through form and XML; negative linear (polarity inversion / M/S) works. **Spec §7 adjustment (flagged): the "dB-only, Lin deferred" decision is un-deferrable cheaply** — the representation is trivial; Lin + polarity can ship in v1 of the tab.

**Filter upload — mapped.** The daemon renames an upload to `impulse_<pipeline>-<n>.wav`, stores it under `/var/lib/hqplayer/home/`, and writes the **absolute path** into the pipeline's `process` attribute (the form shows the basename). The file also appears in `/backup/settings.zip` as `data/impulse_0-0.wav`, so **the restore lane can carry filter files as archive members** — upload does not require the form lane.

**`/matrix/plot` — interstitial only.** The POST returns a "Success! Please wait 0 seconds…" refresh page (same pattern as Apply), no plot data, no image, no script. The actual plot is served after the refresh — unusable as a clean data source. **Spec §6 adjustment (flagged): pick client-side FFT for convolution stages; do not build the daemon-plot fallback.**

**Profile CRUD (form lane, `/matrix/{save,delete,load}`):** `save` adds the name (datalist confirms) and `delete` removes it, both under a ~3 s reload. Oddity: a freshly saved `matrix_profile` element is absent from the working config XML in `/backup` — stored elsewhere; open detail, non-blocking. **`load` applies live (no reload) but replaces the whole matrix context including post-process** — bauer/correction enable and `dac0` were cleared by loading a pipelines-only profile. HQPTuner must treat matrix-profile load as touching post-process settings, not just pipeline rows.

**4321 `MatrixSetProfile` — the clean live lane.** `MatrixListProfiles` / `MatrixGetProfile` / `MatrixSetProfile` work **unauthenticated, live, zero reload**; `State.matrix_profile` and the stock UI's active label track the switch; the working XML is untouched (memory-only — reverts on daemon restart, standard Control API semantics). **Spec §2 adjustment (flagged): the "applies live — no restart" indicator is correct for this lane only**; form-lane Apply is a ~3 s reload (4321 drops ~2.9 s after POST, back ~6.5 s — consistent across all probes) and interrupts playback.

**Client-code note:** 4321 responses arrive prefixed with the `<?xml?>` declaration — round-2's recv loop initially choked on it. HQPTuner's `control.py` already handles this; any new Matrix* helper must go through it, not a fresh socket reader.
