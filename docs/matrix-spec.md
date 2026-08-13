# Matrix pipeline editing — design of record

Approved 2026-07-20, seven phases, all done. Reverses architecture §1's "matrix editing cut" non-goal. Spec of record for Matrix tab; wire truth + probe results appended below. Per-phase hand-back reports live in `CHANGELOG.md` and git history.

**Headings are the citation contract.** Code in `hqptuner/` and `tests/` cites this file by heading text; `scripts/gates/check_doc_refs.py` fails build when cited heading vanishes. Reword heading, update citers same commit. Reorganise freely otherwise — that's why headings, not section numbers.

Post-probe corrections folded into text, not appended: what this doc says is what's true now.

## Spec

### Probes

Done — all five open questions closed; see probe-findings sections below.

### Tab structure

Matrix tab between Volume and System. Section order: MATRIX (global card: Enabled, Engine, Expand HF, IIR→FIR) | PROFILE card sharing row | PIPELINES section | RESPONSE section. Post-process controls stay on Matrix tab — no duplication.

### Speakers / headphones belongs to the preset

The tab's speakers/headphones switcher is a view selector (`store/matrixmode.js`) and it **binds to the preset, not to the browser**: which half of the tab a configuration is listened through is a property of that configuration, so the same preset opens the same way on the phone and on the desktop. hqplayerd's config has nowhere to carry it — the daemon re-serializes configuration from its own model — so HQPTuner stores it, keyed by preset **name**, in one JSON file beside the descriptions (`presets/matrixmodestore.py`, `HQPTUNER_MATRIX_MODE_FILE`, `GET`/`PUT /api/matrixmodes`). Storable values are `speakers` and `headphones` and nothing else; the strings are our frontend's, not the daemon's.

**The preset the view follows is the previewed one when a preset is staged but not applied, and the active one otherwise** — the preview is what is on screen. **A preset with no recorded mode leaves the tab where it is**, falling back to the last-used mode in `localStorage`: nothing migrates existing presets, because "nobody has said" is not "this one is for speakers". That fallback also covers the case with no preset at all, where there is nothing to key a choice to and nothing is written.

**Binding the view to a preset stages nothing (binding).** The hand-driven switcher suppresses crossfeed on the way to speakers and restores it on the way back; a preset switch must not, because the preset carries its own pipelines and crossfeed in its own config and suppression would stage edits over settings the preset already accounts for. Only the user's click suppresses and restores. A refused write leaves the switch where the user put it — a view choice costs nothing to be wrong about until the next reload.

### Profiles

PROFILE card carries active-profile picker with **Load**, **Save as new**, **Save**, **Delete**. Load rides 4321 `MatrixSetProfile` (live, no reload) and stages nothing: profile is whole matrix context, `<post_process>` included (readme §1.11.2), so switch already installs rows AND plugin chain in running engine, and staging them too would pend config write whose only effect at apply is engine restart that changes nothing. Load therefore lasts until daemon restart, HQPlayer's own semantics; persisting matrix is Save's job. Only profile with no live half is one daemon never read (saved this session, unapplied) — staging is its only lane, and it stages profile's rows and its `post_*` values both. Save and Delete are staged `<matrix_profile>` edits on persistent restore lane (`conf/matrixconf.py`), so saved profile lands in `hqplayerd.xml` and daemon reads it at startup. HQPTuner writes element itself, so save to existing name = replace. Save/Load/Delete cost **zero engine reloads**; only restart is apply user chooses.

**Live-active profile grounds pipeline baseline (binding).** Switch is memory-only, so config file keeps its own rows while engine runs profile's — only case where file truth isn't running truth. `pipelineBaseline` (`store/resolve.js`) therefore takes daemon's `/matrix` rows whenever `live_active` names a profile, file JSON otherwise (and as fallback when daemon reported no rows). Editor and matrix graph show what's playing; edit stages diff against that. Miss this and a load leaves user reading config's EQ curve and pipeline while different profile plays.

Load and Switch are **one button**. Differed only in whether choice persisted; button that deliberately doesn't persist not worth own control. Lane tag beside picker states which half a Load gets: `live — no reload` for profile daemon read at startup, `stages — applies at next apply` for one saved but not applied — daemon can't switch to profile it never read.

Form lane gone from profile CRUD. Plain-Save cut at first delivery reversed — HQPTuner writes element, so save to existing name = replace, delete-then-save recipe retired. Why form lane couldn't stay: see "Probe findings — saved matrix profiles do not persist".

### Profile descriptions

A profile name is a filename-shaped thing and the conditions a filter set was measured under are not, so a profile carries a user-written description alongside it: room, mic, target, date. **It is not in the config XML and cannot be** — `<matrix_profile>` carries exactly one attribute, `name` (readme §1.12), and the daemon re-serializes profiles from its own model at startup, so an attribute of ours would not survive. HQPTuner stores it instead, in one JSON file beside the favorites (`presets/descriptionstore.py`, `HQPTUNER_DESCRIPTION_FILE`), keyed by profile **name** — the stable join key, architecture §2, the same rule favorites follow for filter names.

**The description box binds to the profile in focus, which is the Save-as name when there is one and the picker's selection otherwise.** The moment a description exists in the user's head is the moment they are naming the profile, so the box has to be reachable then; a save moves the picker onto the new name as the name field clears, which keeps the text on screen standing for the same profile it did a moment ago. `[Default]` takes none — it has no name to key one by, so the box is present, disabled, and says which of the two to do first. Writes are queued and drain on a pause, on blur, and on unmount; a card that unmounts on a tab switch flushes on the way out, because blur alone loses the paragraph. **The box is a draft signal, never bound to stored text** — the config poll refreshes every two seconds and would otherwise rewrite it mid-sentence. A failed write keeps the text queued rather than reverting the box: what the user typed is the thing being protected.

**Descriptions ride the backup archive** as one member, `hqptuner/descriptions.json` (`conf/presetzip.py`). `GET /api/backup` adds it, `POST /api/restore` takes it out and merges it before the archive reaches hqplayerd — the daemon never sees a member it did not write. A name in both takes the archive's, a restore being the thing that should win. This is the only lane that carries descriptions between installs.

**A carried payload is refused by its envelope and cleaned by its entries (binding).** Bytes that are not readable JSON, or that are not a descriptions store at all, are refused whole and change nothing — that is the case the user needs told about. An entry *inside* a readable store that is not storable is dropped on the way in and the rest merges, exactly as a corrupt entry in the store's own file is dropped rather than raising. Refusing a whole archive over one malformed row would cost the user every other description in it, and the two roads into the store must not disagree about the same bytes.

Nothing here is gated on the descriptions preference (`notesVisible`): that pref hides prose HQPTuner wrote, and this is prose the user wrote.

### Pipeline flow rows

Each pipeline = one flow row: source-channel chip → ordered stage chips → gain chip → target-channel chip, connectors between. Chip colour encodes stage kind, **on the label only — every stage chip keeps the neutral `--line` border**: convolution rose, gain neutral, **all other processing orchid** (incl. `delay` and `riaa`). Channel endpoints are the one accent-coloured chip, border included; the outline elsewhere is reserved for hover and selection, which is what makes the edited stage findable in a 16-pipeline matrix. Kind hues stay off the accent palette (blue / green / amber / violet) so no chip impersonates the accent under a theme switch. Row controls: add-stage affordance at chain end, plot toggle at row end, remove row, `∅` clear-chain tool (clears process chain, resets gain to 0 dB, keeps routing), add pipeline below list. Rows grouped or badged by target channel so summing visible; section header shows active/max count. Source/target selects cover wire 0–127 as labels 1–128 ("In n" / "Out n").

### Stage editor

Selecting stage outlines it accent and docks inline editor panel under row — no modal. Panel shows plugin-specific fields for all 11 IIR types (incl. raw biquad b0..a2), delay (s/t/d/v), riaa, convolution (file upload per stage, filename shown, warn when sample rate deviates from 352.8 kHz recommendation). Panel footer always shows generated raw spec string live, with toggle flipping whole row between chip view and editable raw comma-string — two-way synced, chips regenerate on blur, parse errors inline without destroying string. Specs emitted case-sensitively per manual §7.

**Round-trip contract (binding on `lib/matrixspec.js`):** every stock-manual example string round-trips string → chips → string **byte-identical**; invalid raw input never crashes row or silently drops stages — unparseable chain preserved verbatim and flagged inline.

### AutoEq / REW import

Standing collapsible **Headphone AutoEQ** card between PIPELINES and RESPONSE, default collapsed. Carries vendored AutoEq library picker; `.txt` file lane and **mirror to stereo pair** checkbox live in the PIPELINES card's action row instead, that card being the one on screen in both DSP modes. Text parsed into ParametricEQ stages appended to chosen pipeline, or mirrored to stereo pair in one step. Preamp lines map to pipeline gain chip. Expanding lazy-loads library blob; collapsing clears selection and preview.

**Mirroring is per lane (binding).** Checkbox governs only the lanes in its own card — `.txt` load, row **Import EQ** — and defaults on for headphones, off for speakers, each mode holding its own value; library lane always mirrors, a headphone profile having no one-ear form. Each lane's note renders in its own card, so a lane never writes into a card the click did not come from — and the pipelines lanes still report in speakers mode, where the headphone card is unmounted.

**Vendored library.** Built by `scripts/build_autoeq_db.py` — blob-filtered sparse checkout of `ParametricEQ.txt` only (~35 MB not multi-GB) from jaakkopasanen/AutoEq, **pinned by sha in blob meta**. Pin is **current master, deliberately not a release tag**: upstream's last release is v4.0.0 (2023) and its results moved since; pinning to master makes "no resurrected databases" hold by construction — database only ever holds what upstream ships now. Rebuild deterministic (sorted entries, zeroed gzip mtime). Served by `GET /api/autoeq` pre-gzipped with `Content-Encoding`, lazy-loaded on first panel open. Upstream MIT licence vendored at `static/vendor/autoeq-LICENSE.txt`, linked from credit line in picker. Picker search ranks token matches start > word-boundary > mid-word, prefers oratory1990 on ties, always shows source rather than merging, caps at 40 hits with visible "…N more". Apply routes profile's verbatim text through same `importText` + `doImport` path as manual paste — two lanes identical by construction.

### Response plot

**Standing** RESPONSE card at section bottom — empty state draws axes plus "Toggle ◉ on a pipeline to plot its response". Overlaid magnitude (solid, dB, auto-fit ±36) + phase (dashed, ±180° second axis) for plot-toggled rows, log frequency axis 20 Hz–20 kHz, per-row hue cycle from chip palette. Client-side via `dsp.js`; convolution stages use client-side FFT of uploaded IR (daemon has no plot to fetch — see "Probe findings — `/matrix/plot` as a numeric oracle"). Plot updates live while stage editor field changes. AutoEq preview draws as dashed accent trace labelled "preview", A/B against plotted rows.

### Wire-up

Form parser handles grouped indexed row fields, datalist capture, malformed `gainunit` HTML (below), with offline tolerance tests. Writes ride existing apply/staged lane. Gain unit ships **dB and Lin**, incl. negative Lin for polarity inversion.

## Delivery status

Delivered in full. Standing follow-ups: switch-while-playing verification needs playback window (verified idle only); `Reset` scope still open in `protocol.md` §9.

Every visual phase landed under hand-back protocol in `docs/design-system.md`, plus matrix-specific fixture requirement: measure against **both** live daemon state **and** 16-row / 8-stage worst-case mock via `/api/matrix` route interception.

## Wire truth (live 6.0.4 form)

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

Row count follows `channels` (2 on Opal). Source/mixdown selects span wire 0–127, labels 1–128. `matrix_profile` elements carry full 16-row sets independent of active channel count. Daemon emits malformed HTML in gainunit options (`value="dB""` — stray quote); parser tolerates it.

**Gain unit encoding.** XML `gain` attribute stores linear gain with **`L` prefix** — `gain="L0.5"`, `gain="L-1"`; bare number is dB. Round-trips through form and XML; negative linear (polarity inversion / M-S) works.

### Semantics (manual §7, §7.1–7.4)

- Pipelines = virtual channels: copy source ch → process chain → gain → mix to target; same target = summed. Max 128; active count = `pipelines`/`channels` setting.
- Process chain, comma-separated: plugin specs (`iir:` 11 types incl. raw biquad, args f/q/bw/s/g/b0..a2, case-sensitive; `delay:` s/t/d/v; `riaa:` subsonic), convolution impulse WAV filenames (352.8 kHz recommended; Expand HF extends low-rate filters), REW/AutoEq ParametricEQ `.txt` directly.
- IIR-to-FIR converts parametric EQs to convolution (GPU-offload friendly; linear option adds pre-ringing, best for gentle EQ).
- Matrix + separate convolution engine simultaneously: not recommended (manual note).
- Matrix profile switchable live during playback — 4321 `MatrixSetProfile` / `MatrixListProfiles` / `MatrixGetProfile`; `State.matrix_profile` reports active name.

### Filter upload

Daemon renames upload to `impulse_<pipeline>-<n>.wav`, stores under `/var/lib/hqplayer/home/` (configurable as `HQPTUNER_HQP_HOME`), writes **absolute path** into pipeline's `process` attribute; form shows basename. File also appears in `/backup/settings.zip` as `data/impulse_0-0.wav`, so **restore lane can carry filter files as archive members** — upload doesn't require form lane. HQPTuner's route: `POST /api/matrix/filter` → `filterpark` → restore-archive `data/` members.

## Probe findings — form lane, checkbox encoding and the live lane

Idle-gated, live 6.0.4.

**`POST /matrix` (complete form)** — applies and **persists immediately** to working config XML, triggers **internal config reload: 4321 drops ~2.9 s, back ~6.5 s** (consistent across probes). Not full restart, but Control connection drops and playback interrupted. Consequence: "applies live — no restart" indicator correct for 4321 lane only, never for form-lane apply.

**Partial `POST /matrix`** — silently ignored: HTTP 200, no `Failed` marker, no reload, state unchanged. Complete-form contract holds here as for `/config`, but rejection is *fully silent* — worse than `/config`, which at least says `Failed!`.

**Checkbox encoding — DAEMON BUG.** Submitting `enabled=on` (HTML-default checkbox value) instead of `enabled=1` makes daemon **write invalid value verbatim into `hqplayerd.xml`** (`<matrix enabled="on">`), then **fail engine init on reload — and on every later startup**, since it re-reads broken file. Symptoms: 4321 refused indefinitely, `/matrix` 307-redirects to `/config`, `/backup/settings.zip` returns 401. Service restart alone doesn't recover; config file must be repaired. Consequence for HQPTuner: matrix checkbox values are **unvalidated garbage-in** — writer must guarantee `1`/omitted encoding. Reported to Signalyst.

**Restore-verify transient (not bug in our lane).** Right after matrix reload, DAC-correction select can render with empty option list while output device re-discovers, so too-early readback shows `post_correction_dac0=""`. Apply verification must retry and settle before judging device-derived fields; same transient class makes matrix-form read right after apply one poll behind.

**`/matrix/load` replaces whole matrix context including post-process.** Loading pipelines-only profile cleared bauer/correction enable and `dac0`. Violates HQPTuner's "settings you send are settings you get back" contract, so `matrixlane.profile_action("load")` snapshots form's `post_*` slice (wire-encoded, checkbox contract intact), re-applies it with plain `POST /matrix` after load settles, readback-verifies past post-reload transient.

**4321 `MatrixSetProfile` — clean live lane.** `MatrixListProfiles` / `MatrixGetProfile` / `MatrixSetProfile` work **unauthenticated, live, zero reload**; `State.matrix_profile` and stock UI's active label track switch; working XML untouched (memory-only — reverts on daemon restart, standard Control API semantics). Switch installs profile's whole matrix context, its `<post_process>` chain included: profile element's content model is `<matrix>`'s minus `enabled` (readme §1.12 → §1.11), so crossfeed / DAC correction / loudness move with it.

**Measured, not inferred** (`scripts/probes/probe_switch_post_effect.py`, 6.0.4, engine idle, no config write): switching to a profile whose config element carries `correction enabled="1" dac0="Holo Audio Cyan 2"` installed exactly that; switching to one carrying no `<post_process>` gave `correction=0`, `dac0=""` and loudness off. Zero reload both ways. **A chain-less profile therefore installs an EMPTY chain — it does not leave the running one alone.** Every profile saved before profiles stored a chain is in that state, which is why `matrixconf.backfill_profile_chains` fills them from the live `<matrix>` at apply — the applied config in `presetconf.apply_edits`, stored presets in `presetops.backfill_profiles`, each from its own matrix. A profile that already carries a chain is never overwritten: that is the user's saved choice.

**Client-code note:** 4321 responses arrive prefixed with `<?xml?>` declaration, which naive recv loop chokes on. `control.py` already handles this; any new `Matrix*` helper must go through it, not fresh socket reader.

## Probe findings — `/matrix/plot` as a numeric oracle

First pass called this route unusable. It's usable, as **numeric oracle** not plot source. Read-only: nine POSTs, each readback-verified — form fields, matrix XML, `GET /matrix` byte-identical every time, no reload, engine untouched. Safe to call freely.

**Computes from SUBMITTED form, not stored config.** Injecting `process_0` daemon never saw changes result, so arbitrary chain can be evaluated by daemon's own DSP without writing anything. That's what makes it oracle not readback.

**No rendered plot in Embedded.** POST returns "Success! Please wait 0 seconds…" interstitial refreshing to `/matrix`, unchanged. `GET /matrix/plot`, `/matrix/plot.html`, `/plot` all return daemon's empty shell page (1978 B, identical before and after plot POST); `/files/plot.*` 404s; `/var/lib/hqplayer/web/` is static. Plot button computes and logs — graph dialog manual describes (§7, p.48) is Desktop-only. **Convolution response plotting therefore client-side FFT; no daemon fallback to build.**

**Only output is journal**, one line per plotted row:

```
plot magnitude value range: <min>,<max>      # the data
plot magnitude range: <axis_lo>,<axis_hi>    # the rounded dB axis
```

**Reported quantity is `row gain (dB) + chain magnitude`**, min and max over plot grid:

| submitted chain | predicted | daemon |
|---|---|---|
| `hshelf;f=1000;q=0.7;g=6` @ gain `Lin 0.242086` | −12.3205 → −6.3205 | −12.320555, −6.320863 |
| `peak;f=2000;q=1;g=-9` @ same gain | −21.3205 → −12.3205 | −21.320607, −12.321677 |

**Daemon's `iir` is RBJ cookbook and `q` is RBJ Q — measured, not assumed.** Six chains (single peak, two overlapping peaks, high-Q, ultrasonic, `lp`, `hp`) fitted against `lib/dsp/biquad.js`: **`q` → 0.019 dB RMS** over 12 numbers; `bw` → 2.66 dB; `s` → 0.18 dB. Shelf/peak parameterization grounded.

**Grid: 20 Hz – 20 kHz at FIXED rate ~96–99 kHz — not source rate.** `peak;f=30000` probe returned valid result, impossible below ~60 kHz Nyquist; joint fit for (rate, grid bounds) lands ~99 kHz / 20 Hz–20 kHz. **This lane can't answer what filter does at actual source rate.** Bilinear warping at running rate unverified — negligible for LF work (700 Hz pole sub-0.01 dB across every rate), potentially material near Nyquist.

**Standing limitation:** min/max only, no curve. Can verify filter's *shape parameterization* via chains whose extremes encode answer, but can't render response. Use as validation harness for `lib/dsp/` and any future port — daemon becomes ground truth instead of second implementation of our own assumptions. Journal read via `journalctl -u hqplayerd` or daemon's own `/log`.

## Probe findings — saved matrix profiles do not persist

**Profile saved through `/matrix/save` registers in daemon memory only, lost on next daemon restart.** User-reported as "matrix profiles saved do not persist", then reproduced: four form-lane ops (save, save, delete, delete) with disk state read from `/api/backup` after each.

| op | `MatrixListProfiles` | `<matrix_profile>` in `hqplayerd.xml` | config mtime |
|---|---|---|---|
| — | Default, Mch-to-Stereo mixdown | Default, Mch-to-Stereo mixdown | 23:15:14 |
| save P1 | + P1 | unchanged | 02:44:10 |
| save P2 | + P1, P2 | unchanged | 02:44:55 |
| delete P2 | + P1 | unchanged | 02:45:04 |
| delete P1 | Default, Mch-to-Stereo mixdown | unchanged | 02:45:13 |

- **Every op rewrites config file** (mtime bumps each time) and rewrite never carries saved profile — not "written somewhere else", not flush-ordering artifact.
- **No shutdown flush.** Profile saved at 23:15 absent from pre-restart file and post-restart list; only residue is empty `data/<name>/` member in backup archive.
- **The two profiles that survive are stock**, shipped verbatim in packaged template `/var/lib/hqplayer/hqplayerd.xml`.
- **Not an HQPTuner payload defect.** Suspect was missing submit-button field; daemon's own form buttons carry `value` but no `name` (`tests/fixtures/matrix-6.0.4.html`), so browser submits nothing for them either. Daemon accepts name — appears in `MatrixListProfiles` and datalist — then keeps it in memory.

That's why HQPTuner owns `<matrix_profile>` element and writes it on persistent restore lane — see "Profiles" above.

`/matrix/save` to **existing** name is additionally silent no-op (HTTP 200, profile unchanged), exactly like config lane's `profile/save`. Irrelevant now HQPTuner writes element itself, but it's why daemon's own UI can't overwrite a profile.

**Daemon registers profiles only at process start, and registry lands seconds after HTTP is back.** Profile written to config file becomes switchable at next daemon start and not before, so `MatrixListProfiles` read taken immediately after daemon serves HTTP again is stale — it answers before registry is populated. Any profile-list read across a restart must settle before it's believed.

**`POST /matrix` and `POST /matrix/save` require multipart.** Urlencoded body returns HTTP 200 and is silently ignored — no error, no change. A 200 from either route proves nothing on its own; readback is the only evidence the write landed.

### Operational note — the daemon is single-writer

Concurrent stock-`/matrix`-UI Apply submits its complete form and silently reverts just-applied HQPTuner pipeline edit. Daemon-level TOCTOU: same-instant multi-writer use unsupported by daemon itself. Observed live.

---

# Crossfeed compensation (M/S) — design of record

Approved 2026-07-21. Extends Matrix tab. Delivered; structural-crossfeed alternative that generalizes it is `docs/crossfeed-math.md`.

## Motivation

AutoEq/REW profiles measured and targeted for raw headphone drive. Bauer post-process re-tilts perceived response, so imported EQ never lands on target while crossfeed enabled. Compensation restores EQ-target tonality for correlated (center) content while preserving crossfeed's intended spatial effect (LF stereo-width narrowing).

## Model (verified against libbs2b source)

Reference implementation: `bs2b.c`/`bs2b.h`, Boris Mikhaylov, MIT (vendorable). **HQPlayer's bauer ≡ bs2b is documented**: HQPlayer manual's third-party licence list attributes bs2b verbatim (§11.8, "Copyright (c) 2005 Boris Mikhaylov", full MIT text) — HQPlayer embeds libbs2b. Corroborated independently by preset trio (default 700 Hz/4.5 dB, cmoy 700/6.0, jmeier 650/9.5) and parameter ranges (fcut 300–2000 Hz, feed 1–15 dB, 0.1 steps) matching bs2b's constants and valid ranges exactly. Residual caveat: MIT permits modification, so measurement-rig confirmation of shipped curve remains last word.

From `(fc, feed)`:

```
GB_lo = -5·feed/6 - 3        (dB, crossfeed path LF gain)
GB_hi =  feed/6  - 3         (dB, direct path LF gain; GB_hi - GB_lo = feed)
G_lo  = 10^(GB_lo/20)
G_hi  = 1 - 10^(GB_hi/20)
Fc_hi = fc · 2^((GB_lo - 20·log10(G_hi))/12)
norm  = 1/(1 - G_hi + G_lo)
```

Structure per channel: crossfeed = 1st-order lowpass @ `fc`, DC gain `G_lo`; direct = 1st-order highboost @ `Fc_hi` (DC `1-G_hi`, HF 1); all scaled by `norm`. 2×2 system symmetric, so diagonalizes exactly in M/S:

```
R_M(f) = norm · (H_hi + H_lo)    — center path: LF exactly 0 dB (by construction), HF 20·log10(norm)  → the warm tilt
R_S(f) = norm · (H_hi - H_lo)    — side path: LF narrowed (the intended spatial effect), untouched by this feature
```

Preset tilts: default +1.81 dB (LF 0 / HF −1.81), transition ~700–1000 Hz; cmoy +1.53 dB; jmeier +1.08 dB. **Preset internals not surfaced by daemon** — switching bauer to cmoy leaves form's frequency/level at stored values, so preset→(fc, feed) mapping comes from vendored bs2b constants, not readback.

## Compensation

`C(f) = (1/R_M(f))^s`, slider `s` = 0–150 % in 1 % steps, default 100 %, computed tilt shown. **LF-anchored at 0 dB (boost form)** so M/S balance (center level vs width) preserved at every `s`.

Realized as **two cascaded parametric shelf stages** — analytic two-real-pole/two-real-zero decomposition of `R_M`, fitted to daemon's RBJ shelf primitives. **Single analytic seed suffices; multi-start unnecessary.** Seed is `0.54·fc` at `q 0.58` for first stage, `0.8·Fc_hi` at `q 0.66` for second, descending to ≤0.031 dB on all three presets and at parameter-range corners. Slider is **linear gain scaling of 100 % fit, no refit** (≤0.046 dB vs exact `C^s` over 25–150 %). Rate-independent parametrics only — raw biquads are sample-rate-bound and matrix runs at source rate.

**Wire quantization sets control granularity.** `compProcess` emits stage gains at **2 decimal places**, so slider's **1 % step is wire-quantization bound, not UI preference** — `msRecognize` snaps `s` to that same 1 % grid to round-trip. Finer steps wouldn't survive daemon.

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

(Out i = M′+S, out i+1 = M′−S; comp on M rows only.) **Literal rows, badged**: Pipelines card shows real 8 rows with "crossfeed comp s %" badge; slider regenerates block as one staged op. Recognition is structural (row pattern + Lin gain magnitudes + shared EQ prefix + comp suffix on M rows); hand-edit breaking pattern drops badge and slider, rows stand as ordinary pipelines — never blocked, never rewritten. Pair detection accepts either row order (live configs arrive In 2-first); compile always emits canonical In 1-first. Multichannel out of scope.

Implementation: `static/lib/xfeed.js` (params, M/S responses, cascade fit, `compProcess`, `msCompile`/`msRecognize`), `components/XfeedComp.js` (control strip and badge). Validated node-vs-python against independent reference, 48/48 golden anchors.

## UI

Collapsible **Crossfeed EQ compensation** card carrying slider (0–150 %, 1 % steps, drag-preview + release-commit), tilt readout, Turn on / Turn off / Rebuild-when-stale, mini correction plot (crossfeed dip / correction / net result, ±3 dB). Grayed with reason caption when bauer off.

Three magnitude-only traces on RESPONSE card, each plotting named quantity:

1. **Corrected centre** — `EQ × R_M × C`. Primary trace; flattens live as slider moves, tracking mid-drag.
2. **Side through crossfeed** — `EQ × R_S`, muted. Visibly untouched, showing width narrowing deliberately preserved.
3. **Uncorrected centre** — `s = 0` ghost, for before/after.

## Open items

- Measurement-rig confirmation of shipped bauer curve.
- Multichannel (stereo pair only today).
- Interaction with hand-edited EQ chain inside recognized block.
- **`dsp.js`'s `crossfeedMagDb` known inaccurate** — models Bauer feed path only, flat direct path, which bs2b source contradicts. DSP-tab crossfeed graph should re-ground on `xfeed.js`.