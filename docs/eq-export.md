# EQ export — format reference + save-to recommendations

Reference for **Export EQ** feature (shipped) — inverse of AutoEq/REW **import** lane (`hqptuner/static/lib/eqimport.js`). Serializer: `hqptuner/static/lib/eqexport.js` (`rowToRewText` per-row, `pipelinesToRewText` whole-set). Two buttons on DSP tab: master **Export AutoEq / REW .txt…** beside Load button (whole pipeline set → `hqptuner-matrix-eq.txt`) and per-row **Export EQ** beside each row's Import EQ (`hqptuner-pipeline-N.txt`). This doc fixes target formats and mapping.

## 1. What we export *from*

Two internal EQ representations. Only first is parametric-EQ export source.

### Matrix pipeline `iir` stage (the export source)

Pipeline row's EQ lives in comma-separated `process` string of `<pipeline>` element (`hqplayerd-readme.txt` §matrix, `hqptuner/conf/matrixconf.py`). Client-side each stage parses to `{ kind:"iir", args:{...}, raw }` (`matrixspec.js`). Per-type arg schema (`IIR_TYPES`, `matrixspec.js`):

| iir `type` | required | shape (one-of) | gain |
|---|---|---|---|
| `peak` | `f` | `q` \| `bw` | `g` |
| `lshelf` | `f` | `q` \| `s` | `g` |
| `hshelf` | `f` | `q` \| `s` | `g` |
| `lp` / `hp` | `f` | `q` \| `s` | — |
| `bp` | `f` | `q` \| `bw` | — |
| `notch` / `ap` | `f` | `q` \| `bw` | — |
| `lp1` / `hp1` | `f` | — (first-order) | — |
| `biquad` | `b0 b1 b2 a0 a1 a2` | — (raw coeffs) | — |

Units: `f` Hz, `q` RBJ Q (dimensionless — grounded, `matrix-spec.md`), `bw` octaves, `s` shelf slope, `g` dB. **All arg values verbatim decimal strings** — export preserves source precision by construction. Row `gain` (dB) is natural `Preamp:`.

### Loudness plugin (NOT a general PEQ source)

DSP-tab loudness plugin is fixed 2-band shelf/peak on output bus (`low_type`/`high_type` ∈ `lshelf`/`hshelf`/`peak`/`peakq`, freq/level/steepness). Out of scope for PEQ file export — different model, only two bands, `peakq` has no pipeline equivalent. Export operates on pipeline `iir` stages only.

## 2. The canonical format — REW / Equalizer APO / AutoEq text

Audiophile EQ world has **one lingua franca**: REW "Export filter settings as text" line, byte-compatible with Equalizer APO config syntax. AutoEq, oratory1990, squig.link, REW, EQ APO all speak it. Exactly what our importer already parses.

```
Preamp: -6.2 dB
Filter 1: ON PK Fc 105 Hz Gain -3.2 dB Q 1.41
Filter 2: ON LSC Fc 105 Hz Gain 5.5 dB Q 0.70
Filter 3: ON HSC Fc 10000 Hz Gain -2.0 dB Q 0.70
```

- Whitespace not significant to parsers — token order carries meaning.
- Disabled band → `OFF` in place of `ON`.
- `Preamp:` is single (usually negative) dB line, ≈ `-(max positive gain)`; omitting it is #1 user clipping error.
- Extension `.txt`.

Type tokens (superset; AutoEq in practice emits only `PK`/`LSC`/`HSC`): `PK` (peaking, Q), `PEQ` (peaking, `BW Oct` instead of Q — EQ APO), `LS`/`LSC` (low shelf; `LSC` = Q-controlled), `HS`/`HSC` (high shelf), `LS 6dB`/`12dB` fixed-slope shelves, `LP`/`LPQ`, `HP`/`HPQ`, `BP`, `NO`, `AP`.

## 3. Export type map (iir → REW token) + fidelity

Inverse of `eqimport.js` `TYPE_MAP`. Round-trip fidelity against text format:

| iir `type` | REW token | Fidelity | Notes |
|---|---|---|---|
| `peak` | `PK` | clean | `Fc`/`Gain`/`Q` |
| `lshelf` | `LSC` | clean | Q-carrying low shelf |
| `hshelf` | `HSC` | clean | Q-carrying high shelf |
| `lp` | `LP` / `LPQ` | clean | `LPQ` when `q` present |
| `hp` | `HP` / `HPQ` | clean | `HPQ` when `q` present |
| `notch` | `NO` | clean | Fc (+Q) |
| `ap` | `AP` | clean | Fc (+Q) |
| `bp` | `BP` | clean | Fc + Q |
| `lp1` / `hp1` | `LP` / `HP` | **lossy** | REW LP/HP = 12 dB/oct; first-order is 6 dB/oct, no clean token. Flag on export. |
| `biquad` | — | **skip** | Raw coeffs sample-rate-locked; no Fc/Gain/Q form. Refuse with reason. |

Non-EQ pipeline stages (`delay`, `riaa`, `conv`) not EQ → excluded, reported (mirror importer's `skipped` contract — never silently drop).

**Shape-param handling.** Source stages may carry `q`, `bw`, or `s`:
- `q` present → emit `Q <q>` verbatim (lossless, common case — importer writes `q`).
- `bw` only → either emit EQ-APO `PEQ … BW Oct <bw>` (lossless, EQ-APO-only reader) or convert `bw → Q` for portable `PK` line (lossy at write). Recommend: portable `PK` with converted Q, note conversion.
- `s` only (shelf) → convert `s → Q`; note it. (CamillaDSP export can carry `slope` natively — see §5.)

## 4. Format survey (what's out there)

| Format | Ext | Round-trips w/ HQPlayer PEQ | Verdict |
|---|---|---|---|
| **REW / EQ-APO / AutoEq ParametricEQ text** | `.txt` | **Yes, clean** — PK/LSC/HSC + Preamp map 1:1 | **primary target** |
| AutoEq **FixedBandEQ** | `.txt` | Yes | Same lines at ISO centers, all `PK` |
| **CamillaDSP** YAML | `.yml` | Yes (translated) | `Peaking`/`Lowshelf`/`Highshelf`, `freq`/`gain`/`q`\|`slope`\|`bandwidth`; global gain = a `Gain` pipeline filter |
| GraphicEQ one-liner (Wavelet/Poweramp) | `.txt` | No (curve, not biquads) | 127 fixed log points, gain-only; only derivable by *sampling* our response |
| REW `.req` | `.req` | No | opaque binary, REW-only |
| REW / miniDSP **coefficients** | `.txt` | No | sample-rate-locked biquad coeffs, not Fc/Gain/Q |
| Roon PEQ | — | No path | Roon has no PEQ import/export; GUI or convolution `.wav` only |
| JSON | `.json` | n/a | no dominant interchange standard; app-internal only |

Shelf `6dB`/`12dB` fixed-slope, and `LP/HP/BP/NO/AP` beyond peaking+shelves, are partial/lossy against HQPlayer's peaking+shelf model in *import* direction; on *export* HQPlayer already only holds representable set, so asymmetry not our problem here.

## 5. Recommended save-to formats (ranked)

1. **REW / Equalizer APO text (`.txt`) — ship first, on its own.** Universal, human-readable, 1:1 inverse of importer, maps cleanly onto every pipeline `iir` type that matters. This single format covers oratory1990, AutoEq, squig.link, REW, EQ APO, Peace, EasyEffects, JRiver, miniDSP tooling, Wiim, PipeWire. One serializer, one round-trip test (export→`parseEqText`→byte-stable stages). This is the feature; everything below optional polish.

2. **CamillaDSP YAML (`.yml`) — secondary.** Clean biquad round-trip, and DIY-DAC/Linux CamillaDSP community overlaps heavily with HQPlayer users. Carries `slope`/`bandwidth` natively, so it's *lossless* home for shelf-`s` and `bw` stages the text format must convert. Emit filters + a `pipeline` block with a `Gain` filter for preamp.

3. **JSON mirror (`.json`) — optional.** 1:1 structured form of text model (`{preamp_db, bands:[{type,fc_hz,gain_db,q, enabled}]}`). Value is programmatic: HQPTuner-native re-import, scripting, diffing. No external standard exists, so it's for us and power users, not interop.

4. **GraphicEQ one-liner (`.txt`) — nice-to-have, derived.** Only obtainable by sampling our own response (`dsp.js` `chainResponse` already computes it) at 127 canonical log points. Lossy/derived, not a biquad export — but it's *only* path to Wavelet/Poweramp/Android EQs, which can't read parametric bands. Gate it as "graphic (approximate)" so nobody mistakes it for lossless export.

**Decline:** `.req` (binary, REW-only), raw coefficient dumps (sample-rate-locked), Roon (no import path). Nothing to gain, real maintenance cost.

### Scope decisions

- **Export unit** *(shipped)*: two lanes — **master** button exports whole pipeline set to one file (`pipelinesToRewText`), **per-row** button exports single pipeline (`rowToRewText`). In master file a stereo-identical set collapses to one clean block; channels carrying different EQ written under `# Pipeline N (In i -> Out j)` comment headers (skipped as non-filter lines on re-import) so nothing dropped or silently merged.
- **v1 format scope** *(shipped)*: REW/EQ-APO `.txt` only; CamillaDSP / JSON / GraphicEQ remain on-demand follow-ups.
- **Preamp source**: row's dB `gain`. A `Lin`-unit or polarity-inverted row gain has no `Preamp:` equivalent → flag and omit rather than mis-emit.

- **Crossfeed / crossfeed-compensation collision** *(decided — offer both)*. Structural crossfeed and crossfeed compensation own pipelines 1–8 as one recognized block (`msRecognize` / `applyEqToBlock`, `eqimport.js` `blockPlan`): they fold user's EQ together with compensation filters and Lin channel gains. Exporting raw pipeline there yields **crossfed** filter set — compensation baked in — not the headphone correction user actually wants to share. When export target is a recognized crossfeed block, offer two choices:
  - **Full crossfed pipeline** — running filters verbatim (what's actually playing).
  - **Underlying EQ profile only** — pre-compensation EQ, recovered from block's stash (rows stashed when block was installed) or, absent a stash, block's shared-EQ component with compensation removed. This is portable headphone profile most consumers expect.

  Outside a recognized block, no collision — export pipeline's `iir` stages directly.