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
- [x] **3 — editing + apply** (hand-back PASS 2026-07-20: row containers + plot slot reserved, delay/riaa amber, add/remove/gain/channel edits staging atomically — the set counts as ONE restart-lane edit in the bar, per-row dirty shown in-tab; 16-row mock at all three accents, hero-live mocked, no overflow; live apply on Opal verified by backend readback and restored. Lin gain shipped (probe un-deferred the spec §7 dB-only ruling). Operational note: a concurrent stock-`/matrix`-UI Apply submits its complete form and silently reverts a just-applied HQPTuner pipeline edit — daemon-level TOCTOU, same-instant multi-writer use is unsupported by the daemon itself; observed live during the hand-back)
- [x] **4 — stage editor** (hand-back PASS 2026-07-20: docked inline panel with per-kind editors — 11 IIR types w/ schema-driven args, delay, riaa, convolution w/ upload + WAV-rate warning; live spec footer; chip ↔ raw two-way sync verified both directions; round-trip byte-identical over the manual's examples; 7 hostile raw strings — zero crashes, all preserved verbatim, flagged inline (bare text correctly reads as a filename per grammar); add/delete/drag-reorder; upload end-to-end live on Opal — parked file rode the restore as `data/<name>`, landed on the daemon, applied + restored pristine. Two app bugs found by the hand-back and fixed: a stage-POST response race clobbering newer optimistic edits (latest-wins guard in `stagePipelines`), and the vanishing empty-file conv stage (kind-switch to convolution now drafts until the first file path commits). Upload lane: `POST /api/matrix/filter` → `filterpark` → restore-archive `data/` members; `HQPTUNER_HQP_HOME` configures the daemon-home path prefix)
- [x] **5 — profiles** (hand-back PASS 2026-07-20: live switch via 4321 `MatrixSetProfile` — round-trip verified, active label tracks, "live — no reload" indicator scoped to that lane only; Save-as-new / Delete / Load on the form lane, idle-gated, complete-form + checkbox-encoding contract fake-asserted. **Plain Save (overwrite existing) is CUT — spec adjustment, flagged:** micro-probed twice live, `/matrix/save` to an existing name is a silent daemon no-op (HTTP 200, profile unchanged) exactly like the config lane's `profile/save`; the UI refuses an existing name on Save-as-new with an explanatory tooltip (delete-then-save is the overwrite recipe). Two reload-race bugs found by the hand-back and fixed in `matrixlane`: back-to-back form-lane ops 502'd into the prior reload window (retry-once behind await-ready), and resyncing immediately after the POST read pre-reload state because the daemon acks before it reloads — the profile list now polls until it reflects the action's postcondition. Switch-while-playing acceptance deferred: verified idle only, needs a playback window. Visual nits deferred to the design pass: channel selects size to their widest option (gain cluster wraps), Engine dropdown truncates)
- [x] **6 — AutoEq / REW import** (hand-back PASS 2026-07-20: `store/eqimport.js` parses both dialects with one grammar — verified against a real AutoEq result (HD 650/oratory1990: preamp + LSC/PK/HSC) and a REW Generic export with header block, OFF filter, gainless HP, and an unsupported type; type map PK/PEQ/LS/LSC/HS/HSC/LP/HP/NO/AP; skipped lines reported with reasons, never silently dropped; numeric precision preserved verbatim. Docked Import-EQ panel on the Pipelines card: paste or .txt picker, target pipeline, mirror-to-stereo-pair (pair = adjacent even/odd row), preamp → row gain (dB); one atomic staged op, Discard undoes the import. Staged-only — no daemon writes in this step)
- [x] **7 — response plots** (hand-back PASS 2026-07-20: RESPONSE card at the section bottom — magnitude solid (dB, auto-fit ±36) + phase dashed (±180° second axis), log 20 Hz–20 kHz, per-row hue cycle from the chip palette, ∿ row toggle live; recomputed per render so the stage editor repaints it live. dsp.js grew the full RBJ set (all 11 iir types incl. first-order + raw biquad; generalized q/bw/S alpha; non-shelf `s` approximated at Butterworth — flagged), delay linear phase, analytic RIAA (0 dB @1 kHz exact; +19.27/−19.62 at the extremes, textbook), radix-2 FFT + WAV reader for session-uploaded convolution IRs (un-uploaded paths render a partial note per the probe's client-FFT ruling). **Acceptance amendment approved and met:** validated numerically against an independent hand-computed python reference instead of the interstitial-only daemon `/matrix/plot` — worst-case error 0.000000 dB / 0.000000° over the 3-stage chain. Mock-pass screenshots are layout-only (the fixture didn't intercept the file-truth baseline, traces flat); curve visuals verified on the live pass)

**All seven phases complete — the matrix feature is delivered per this spec.** Post-delivery follow-ups on record: design-iteration pass (chip-select widths, Engine dropdown truncation, delay/riaa amber ruling applied), switch-while-playing verification (needs a playback window), `Reset`-scope and remaining protocol.md open items untouched by this feature.

**AutoEq library + standing RESPONSE card (hand-back PASS 2026-07-20, all 5 items).** (1) RESPONSE is a standing card: empty state = axes + "Toggle ◉ on a pipeline to plot its response"; measured present with zero rows, one row, and the 8-stage mock. (2) Vendored library: `scripts/build_autoeq_db.py` — blob-filtered sparse checkout (ParametricEQ.txt only, ~35 MB vs multi-GB) of jaakkopasanen/AutoEq, pinned by sha in the blob meta (`7ae0f56d`, 2025-07-20); **spec adjustment (flagged): pinned to current master, not a release tag — last upstream release is v4.0.0 (2023) and results have moved since; "no resurrected databases" holds by construction (only what upstream currently ships)**. 8850 profiles, raw 5,056,679 B → gzip 687,093 B, deterministic rebuild (sorted, zeroed gzip mtime); upstream MIT license vendored as `static/vendor/autoeq-LICENSE.txt` and linked with the credit line in the picker (`profiles: AutoEq (MIT) · 8850 models @ 7ae0f56`); served by `GET /api/autoeq` pre-gzipped with Content-Encoding, lazy-loaded on first panel open. (3) Picker: token search ranked start > word-boundary > mid-word, oratory1990 preferred on ties, source always shown never merged, 40-hit cap with visible "…N more"; measured 18 ms set→rendered for "hd 650" (12 hits, oratory1990 first). Preview renders without touching pipeline state (canonical-JSON equality asserted); **Apply routes the profile's verbatim text through `importText` + `doImport` — identical to the paste path by construction and asserted against an independent parse (stages suffix + preamp→gain + stereo mirror all true)**; Clear/panel-close leave zero residue (preview trace count 0, pipelines byte-equal); Discard reverts the apply. (4) Preview-vs-current A/B is the default: dashed accent trace labeled "preview" overlaid on plotted-row curves (live one-row A/B and mock 8-stage A/B measured), and with zero rows toggled it renders alone in the empty-state card. (5) Live + mock passes, no horizontal overflow, engine state 0 throughout (staged-only). Gate green (192, +3 autoeq route tests).

**Headphone AutoEQ card + clear-stages tool (hand-back PASS 2026-07-21).** Discoverability feedback: the Import-EQ toggle button was too subtle for a headline feature. The import machinery (library picker + paste/.txt lane) moved into a standing collapsible "Headphone AutoEQ" card between PIPELINES and RESPONSE — default collapsed (not everyone is listening to headphones), card-head as the toggle with the accent tri glyph; expanding lazy-loads the blob, collapsing clears selection + preview (no residue, measured 1→0 preview traces). New per-row `∅` tool (user request — the workaround was delete-and-readd channels): clears the whole process chain AND resets gain to 0 dB, keeps routing, disabled when chain empty and gain zero, staged like every edit. Measured: `[chain, -6.5] → ["", "0", "dB"]`, source kept; post-clear state equalled the live baseline so Discard was correctly disabled (nothing pending). Hand-back ran during live playback (state 2) — staged-only, playback undisturbed, genuine hero-live captured. Gate green (192).

**Design-iteration pass (hand-back PASS 2026-07-20, all 8 items).** (1) Accent audit: live pill/Switch/tool-active/tab-underline measured tracking all three accents (`rgb` equality per theme); the delay/riaa-not-amber report traced to a real parser defect — bare `riaa` (no colon) and space-padded stages classified as convolution filenames; `parseProcess` now trims the head for classification only (raw stays byte-identical), regression row in the mock fixture; only remaining hardcoded hues in matrix styles are the three spec-mandated `--chip-*` kind colors + semantic `--red`. (2) Captions: settings.json `dsp` entries for the four Matrix-card controls (manual §7 / readme §1.11; engine + iir2fir as per-option `desc:"config"` prose), profile-lane and pipelines captions gated by `notesVisible` — measured 2 notes + 2 descs + 3 profile + 1 pipelines with descriptions on, 0 notes / descs-only off (identical to other tabs' keep-option behavior). (3) Flow sizing: the ~400px chips were the global `--w-select` token bleeding into `select.mtx-ch` / `.mtx-gain select` / editor-head select — all now `width:auto`; chips measure 69–76 px, gain cluster 131 px; stage-less rows render one line (`In n → + stage → 0 dB → Out n`) live and mock; the 8-stage mock row wraps cleanly, connectors intact, no horizontal overflow. (4) Matrix card left `.pack` (two tracks inside a half-card starved the selects) for single-column `.mtx-global` with content-sized selects — both selects fit their longest option closed (need 81/36 px, have 101/56 px). (5) Profile card: Active on top, primary live-switch row (accent Switch + pill) vs secondary Load/Delete lane, all three captions below their rows at caption measure (+4 px gap measured), card bottoms equal (682/682 live, 698/698 mock). (6) `{ }`/plot/`✕` + all profile buttons carry titles; plot toggle renders ○/◉ with accent active state. (7) "Enable matrix" → "Enabled". (8) Hero-live re-measured with `/api/state` interception (the app reads engine state there, not `/api/status` — earlier hero mocks silently missed): `.signal-path.live` present, hero glow = accent. Gate green (189).

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

**`/matrix/plot` — interstitial only.** The POST returns a "Success! Please wait 0 seconds…" refresh page (same pattern as Apply), no plot data, no image, no script. The actual plot is served after the refresh — unusable as a clean data source. **Spec §6 adjustment (flagged): pick client-side FFT for convolution stages; do not build the daemon-plot fallback.** — **PARTLY SUPERSEDED 2026-07-22, see round 3.** The refresh target is `/matrix`, which is byte-identical afterwards, so "the actual plot is served after the refresh" is wrong; there is no rendered plot anywhere. But the route is a usable *numeric* oracle, which this round concluded it was not. The client-FFT decision for convolution plotting stands unchanged.

**Profile CRUD (form lane, `/matrix/{save,delete,load}`):** `save` adds the name (datalist confirms) and `delete` removes it, both under a ~3 s reload. Oddity: a freshly saved `matrix_profile` element is absent from the working config XML in `/backup` — stored elsewhere; open detail, non-blocking. **`load` applies live (no reload) but replaces the whole matrix context including post-process** — bauer/correction enable and `dac0` were cleared by loading a pipelines-only profile. HQPTuner must treat matrix-profile load as touching post-process settings, not just pipeline rows.

**4321 `MatrixSetProfile` — the clean live lane.** `MatrixListProfiles` / `MatrixGetProfile` / `MatrixSetProfile` work **unauthenticated, live, zero reload**; `State.matrix_profile` and the stock UI's active label track the switch; the working XML is untouched (memory-only — reverts on daemon restart, standard Control API semantics). **Spec §2 adjustment (flagged): the "applies live — no restart" indicator is correct for this lane only**; form-lane Apply is a ~3 s reload (4321 drops ~2.9 s after POST, back ~6.5 s — consistent across all probes) and interrupts playback.

## Probe findings, round 3 — `/matrix/plot` characterized (2026-07-22, idle-gated)

Round 2 called this route unusable. It is usable, as a **numeric oracle** rather than a plot source. Nine POSTs, each readback-verified: form fields, matrix XML, and `GET /matrix` byte-identical every time; no reload, engine untouched throughout.

**It computes from the SUBMITTED form, not from stored config.** Injecting a `process_0` the daemon has never seen changes the result — so an arbitrary chain can be evaluated by the daemon's own DSP without writing anything. This is what makes it an oracle rather than a readback.

**There is no rendered plot in Embedded.** The POST interstitial refreshes to `/matrix`, which is unchanged. `GET /matrix/plot`, `/matrix/plot.html`, `/plot` all return the daemon's empty shell page (1978 B, identical before and after a plot POST); `/files/plot.*` 404s; `/var/lib/hqplayer/web/` is static (every file dated at package install). The Plot button computes and logs — the graph dialog the manual describes (§7, p.48) is Desktop-only.

**The only output is the journal**, one line per plotted row:

```
plot magnitude value range: <min>,<max>      # the data
plot magnitude range: <axis_lo>,<axis_hi>    # the rounded dB axis
```

**The reported quantity is `row gain (dB) + chain magnitude`**, min and max over the plot grid. Verified against the client model:

| submitted chain | predicted | daemon |
|---|---|---|
| `hshelf;f=1000;q=0.7;g=6` @ gain `Lin 0.242086` | −12.3205 → −6.3205 | −12.320555, −6.320863 |
| `peak;f=2000;q=1;g=-9` @ same gain | −21.3205 → −12.3205 | −21.320607, −12.321677 |

(`Lin 0.242086` = −12.3205 dB, and it lands in the plot exactly — the row gain is included.)

**The daemon's `iir` is RBJ cookbook and `q` is RBJ Q — measured, not assumed.** Six chains (single peak, two overlapping peaks, high-Q, ultrasonic, `lp`, `hp`) fitted against `lib/dsp.js`'s math: **`q` → 0.019 dB RMS** over 12 numbers; `bw` → 2.66 dB; `s` → 0.18 dB. This retires the standing uncertainty between `dsp.js:5-7` ("validated against `/matrix/plot`") and this document's step-7 note (validated against an independent Python reference *instead*). The shelf/peak parameterization is now grounded.

**Grid: 20 Hz – 20 kHz at a FIXED rate of ~96–99 kHz — not the source rate.** A `peak;f=30000` probe returned a valid result, which is impossible below ~60 kHz Nyquist, and the joint fit for (rate, grid bounds) lands at ~99 kHz / 20 Hz–20 kHz. **Consequence: this lane cannot answer what a filter does at the actual source rate.** Bilinear warping at the running rate remains unverified — negligible for LF work (a 700 Hz pole is sub-0.01 dB across every rate), potentially material near Nyquist.

**Standing limitation.** Min/max only, no curve. It can verify a filter's *shape parameterization* via chains whose extremes encode the answer (overlapping peaks for Q, `lp`/`hp` skirts for the grid edges), but it cannot render a response and cannot replace the client-side FFT for convolution stages. Round 2's ruling on that point stands.

**Use.** A validation harness for `lib/dsp.js` and any future Python port — the daemon becomes the ground truth instead of a second implementation of our own assumptions. Read-only, idle-gate not strictly required (nothing is written), journal read via `journalctl -u hqplayerd` or the daemon's own `/log`.

---

# Crossfeed compensation (M/S) — design of record

Approved 2026-07-21 (user decision; forks resolved: literal badged wire rows, exact cascaded-parametric inverse). Extends the Matrix tab; the round-6 spacing system, hand-back protocol, and testing policy all apply.

## Motivation

AutoEq/REW profiles are measured and targeted for raw headphone drive. The Bauer post-process re-tilts the perceived response, so an imported EQ never lands on its target while crossfeed is enabled. Compensation restores EQ-target tonality for correlated (center) content while preserving crossfeed's intended spatial effect (LF stereo-width narrowing).

## Model (verified against libbs2b source)

Reference implementation: `bs2b.c`/`bs2b.h`, Boris Mikhaylov, MIT (vendorable). **HQPlayer's bauer ≡ bs2b is documented (upgraded from inference 2026-07-21):** the HQPlayer manual's third-party license list attributes bs2b verbatim (§11.8, "Copyright (c) 2005 Boris Mikhaylov", full MIT text) — HQPlayer embeds libbs2b. Corroborated independently by the preset trio (default 700 Hz/4.5 dB, cmoy 700/6.0, jmeier 650/9.5) and the parameter ranges (fcut 300–2000 Hz, feed 1–15 dB, 0.1 steps) matching bs2b's constants and valid ranges exactly. Residual caveat: MIT permits modification, so a measurement-rig confirmation of the shipped curve remains the last word (open item).

From `(fc, feed)`:

```
GB_lo = -5·feed/6 - 3        (dB, crossfeed path LF gain)
GB_hi =  feed/6  - 3         (dB, direct path LF gain; GB_hi - GB_lo = feed)
G_lo  = 10^(GB_lo/20)
G_hi  = 1 - 10^(GB_hi/20)
Fc_hi = fc · 2^((GB_lo - 20·log10(G_hi))/12)
norm  = 1/(1 - G_hi + G_lo)
```

Structure per channel: crossfeed = 1st-order lowpass @ `fc`, DC gain `G_lo`; direct = 1st-order highboost @ `Fc_hi` (DC `1-G_hi`, HF 1); everything scaled by `norm`. The 2×2 system is symmetric, so it diagonalizes exactly in M/S:

```
R_M(f) = norm · (H_hi + H_lo)    — center path: LF exactly 0 dB (by construction), HF 20·log10(norm)  → the warm tilt
R_S(f) = norm · (H_hi - H_lo)    — side path: LF narrowed (the intended spatial effect), untouched by this feature
```

Default preset numbers: center tilt +1.81 dB (LF 0 / HF −1.81), transition ~700–1000 Hz; cmoy +1.53 dB; jmeier +1.08 dB.

## Compensation

`C(f) = (1/R_M(f))^s`, slider `s` = 0–150 % in 1 % steps, default 100 %, with the computed tilt shown (`bauer 700 Hz / 4.5 dB → +1.8 dB center tilt`). **LF-anchored at 0 dB (boost form)** so the M/S balance (center level vs width) is preserved at every `s`. Realized as **two cascaded parametric shelf stages** (analytic two-real-pole/two-real-zero decomposition of `R_M`, numerically fitted to the daemon's RBJ shelf primitives); acceptance: ≤0.05 dB error over 20 Hz–20 kHz at s=100 %, all three presets + custom range corners. Rate-independent parametrics only — raw biquads are sample-rate-bound and the matrix runs at source rate.

## Wire shape

Stereo pair (rows for channels i, i+1) compiles to 8 pipelines, `k = 10^(preamp_dB/20)`:

| # | src | process | gain | out |
|---|-----|---------|------|-----|
| 1 | i   | EQ chain + comp | Lin +0.5k | i |
| 2 | i+1 | EQ chain + comp | Lin +0.5k | i |
| 3 | i   | EQ chain        | Lin +0.5k | i |
| 4 | i+1 | EQ chain        | Lin −0.5k | i |
| 5 | i   | EQ chain + comp | Lin +0.5k | i+1 |
| 6 | i+1 | EQ chain + comp | Lin +0.5k | i+1 |
| 7 | i   | EQ chain        | Lin −0.5k | i+1 |
| 8 | i+1 | EQ chain        | Lin +0.5k | i+1 |

(Out i = M′+S, out i+1 = M′−S; comp on M rows only.) **Literal rows, badged** (user fork decision): the Pipelines card shows the real 8 rows with a "crossfeed comp s %" badge; the slider regenerates the block as one staged op. Recognition is structural (row pattern + Lin gain magnitudes + shared EQ prefix + comp suffix on M rows); a hand-edit that breaks the pattern drops the badge/slider and the rows stand as ordinary pipelines — never blocked, never rewritten. Multichannel: out of scope v1 (stereo pair, same as AutoEQ mirror).

## UI + visualization

Control strip on the RESPONSE card, visible only when `post_bauer_enabled`; bauer off → grayed with reason caption (house graying rule). Traces (magnitude only; per-row hue system):

1. **Center through crossfeed** — `EQ × R_M × C`: flattens live as the slider moves. The primary trace.
2. **Side through crossfeed** — `EQ × R_S`, dimmed/dashed: visibly untouched — shows what is deliberately preserved.
3. Ghost of uncompensated center (`s=0`) for before/after.

## Delivery

1. **Probes** (idle-gated): daemon form echo of preset fc/level on preset switch; generated 8-row set applied live — readback byte-exact, M/S reconstruction verified numerically, engine load sanity; restore verified pristine.
2. **Pure lib + reference**: bs2b model, exact-inverse decomposition, cascade fit; validated against an independent pure-python reference (step-7 precedent).
3. **UI**: badge/recognition, slider, staged block generation on the existing apply lane.
4. **Plot lenses.**
5. Hand-back per standing protocol (fresh 1280 shots, DOM-measured, both accents + hero states, worst-case mock).

## Delivery status (active checklist)

- [x] **1 — probes** (2026-07-21, idle-gated, restore-verified byte-exact). (a) The daemon accepts the full 8-row M/S block with `pipelines=8`: readback byte-exact including `Lin ±0.242086` gains (preamp −6.3 dB folded in). (b) **Preset internals are NOT surfaced**: switching bauer to cmoy leaves the form's frequency/level at their stored values — preset→(fc, feed) mapping must come from the vendored bs2b constants (700/4.5, 700/6.0, 650/9.5, verified from `bs2b.h`). (c) Matrix-form reads immediately after an apply are one poll behind (same transient class as the DAC-correction note above) — the UI must await postconditions, not read once.
- [x] **2 — pure lib + reference** (2026-07-21): `static/lib/xfeed.js` — bs2b params/M-S responses, single-seed cascade fit (reference-validated: multi-start unnecessary, analytic seed `0.54·fc q .58 / 0.8·Fc_hi q .66` descends to ≤0.031 dB on all presets + range corners), `compProcess` (2-dp gains, matrixspec arg order), `msCompile`/`msRecognize` (structural, stale-detection on bauer change, s snapped to the slider's 1 % grid — wire quantization bound). **Slider = linear gain scaling of the 100 % fit, no refit** (≤0.046 dB vs exact `C^s` over 25–150 %, reference-checked). Cross-validated node-vs-python: 48/48 against golden anchors from the independent reference (`scratchpad/xfeed_reference.py` / `check_xfeed.mjs`, to be promoted into the repo at hand-back). Note for a later pass: `dsp.js` `crossfeedMagDb` models the feed path only with a flat direct path — now known inaccurate per the bs2b source; the DSP-tab crossfeed graph should eventually re-ground on `xfeed.js`.
- [x] **3 — UI** (2026-07-21): `components/XfeedComp.js` — control strip (slider 0–150 % / 1 % steps with drag-preview + release-commit, tilt readout, Turn on / Turn off / Rebuild-when-stale, bauer-off graying with reason), badge on the Pipelines card, staged through `stagePipelines` + a `pipelines`-count edit. Pair detection accepts either row order (live configs arrive In 2-first — hand-back finding); compile always emits canonical In 1-first. **Language pass (user feedback):** plain-first wording — "Crossfeed tone correction/EQ compensation", "Turn on/off", "∿ what you hear", "crossfeed dulls the center by X dB", explicit slider scale line, badge in prose. **Post-delivery reorg (user decision 2026-07-21):** the old post-process DSP tab dissolved — Loudness → Volume tab, Crossfeed → this tab (own collapsible card, collapsible plot), tab renamed DSP, General card renamed Matrix; comp strip promoted from the Response card to its own collapsible "Crossfeed EQ compensation" card with a mini correction plot (crossfeed dip / correction / net result, ±3 dB) and a content guide (center-heavy → 100 %+, hard-panned → 50–75 %).
- [x] **4 — plot lenses** (2026-07-21): three magnitude-only Response-plot traces — corrected center (accent, tracks the slider live mid-drag), uncorrected center (ghost), stereo sides (muted, shows the untouched width narrowing); rendered whenever bauer is enabled and either a block is recognized or the eligible pair exists (pre-apply preview).
- [x] **5 — hand-back** (2026-07-21): 24/24 DOM-measured checks (plus one honest SKIP when the user's live daemon had crossfeed enabled, making the off-state unrenderable — measured in an earlier round): reorg structure (5 tabs, card order, collapsibles), staged-awareness, full compensate→slider→remove→discard cycle restoring a drift-proof baseline snapshot, green+amber accent tracking by measured rgb, hero-live via /api/state interception, zero horizontal overflow @1280. Staged-only throughout — every run discards; live config untouched. Gate green (201 tests).

**Related fix shipped with this feature (user-reported, 2026-07-21): matrix-profile load preserves post-process.** The daemon's `/matrix/load` replaces the whole matrix context (probe finding above); that violated HQPTuner's "the settings you send are the settings you get back" contract. `matrixlane.profile_action("load")` now snapshots the form's `post_*` slice (wire-encoded, checkbox contract intact), re-applies it with a plain `POST /matrix` after the load settles, and readback-verifies past the post-reload transient (second ~3 s reload per load; fake models the daemon's clearing behavior; offline tests assert the preserved end state).

Open items: measurement-rig confirmation of the shipped bauer curve (bauer≡bs2b is manual-documented, §11.8 — see above — but MIT permits modification, so measuring closes it); multichannel deferred; interaction with a hand-edited EQ chain inside a recognized block (recognition rules above must be exercised in tests).

**Client-code note:** 4321 responses arrive prefixed with the `<?xml?>` declaration — round-2's recv loop initially choked on it. HQPTuner's `control.py` already handles this; any new Matrix* helper must go through it, not a fresh socket reader.
