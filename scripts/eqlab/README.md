# eqlab — agent operating manual

Read-only measurement rig for the HQPTuner EQ chain. Same math the UI plots (`lib/dsp.js` `chainResponse`, grammar `lib/matrixspec.js`) — nothing reimplemented. Never writes the daemon: sole request is `GET /api/matrix`. Writes go to files only (snapshots, exports). It emits a process string; applying it is the human's move.

```
node scripts/eqlab/eqlab.js < job.json    # JSON on stdout, table on stderr
```

One job in, one answer out. Every answer carries `limits` (grid, runaway guards, `not_modelled`).

This file is the *how*. For measurement-driven correction, the *when and why* — yardstick selection, error curves, smoothing choice, the treble reliability ceiling, band budget, anti-patterns — is `docs/eq-assistant/CORRECTIVE.md`; read it before designing a corrective fit.

## RULE: report deficiencies, never work around them

If the job schema cannot express your question, a metric kind is missing, a chain shape is not modelled, or the answer needs an unpublished HQPlayer filter specification — **stop and tell the user, plainly**. Missing capability gets added to the tool; do not fudge, approximate around, or game the solver to force an answer it cannot honestly give. A hedged answer built on a workaround is a defect.

Everything else — search width, step size, pass count, metric definitions, batching — is yours to decide. Run it, report the result; not questions for the user.

## Job shape

```json
{ "fs": 44100, "chain": …, "target": …, "metrics": …, "notes": …, "job": { "kind": … } }
```

`fs` default 44100. Grid: 4096 log points, 20 Hz–20 kHz. All metrics reduce the SUMMED chain response — no band measured in isolation.

### chain (sources)

- `{"from":"daemon","row":0,"eq_only":false}` — live matrix row (`url` optional)
- `{"from":"xml","path":"cfg.xml","row":0,"eq_only":false}` — config-snapshot XML `<matrix>` row
- `{"from":"parametric_eq","path":"eq.txt"}` — REW / EQ APO / AutoEq text
- `{"from":"snapshot","name":"…"}` — saved snapshot (`data/eqlab/`)
- `{"bands":[{"type":"peak","f":100,"q":1.0,"g":-2.0},…]}` — literal; types `peak` (default) / `lshelf` / `hshelf`; params `f g q bw s`

`eq_only:true` keeps only the EQ tail. Answers report `tail_consistency` for daemon/xml rows.

### metrics

`"standard"` = named preset (bass_50_150, oomph_80_160, mud_200_400, mid_400_1500, treble_4k_10k, v_db, ripple_150_1000, spread_A2_G4). `{"preset":"standard", …more}` extends it. Custom panel: `{"name":{"kind":…,…}}`.

Kinds: `max min mean at` (range/f), `ripple slope prominence note_spread` (shape), `expr` (expression; funcs `mean(a,b) max(a,b) min(a,b) at(f)`, ops `+ - * /`, unary `-`, parens; may reference earlier-declared metric names), and target-relative `rmse maxdev maxdev_signed mean_signed` (need `job.target`; `"domain":"erb"` weights rmse/mean_signed by ERB-rate density instead of log-uniform). `rmse` also accepts `side: "above" | "below"` — scores only deviation on that side of the target (the other side contributes zero but stays in the mean's denominator); use it when an objective must price unserved peaks without paying for valleys.

`prominence` = peak height above the straight line joining the range edges (colouration), distinct from `max` (plateau, sets preamp).

### target

```json
{"from":"current"|"flat"|"points"|"chain"|"parametric_eq"|"difference", …,
 "smooth":{"octaves":1}, "tilt":{"db_per_octave":-0.5,"pivot":1000},
 "override":[{"range":[1700,2600],"method":"interpolate_edges"|"smooth"|"fit_trend"}],
 "align":"mean"|"none"|{"at":1000}}
```

Transforms in fixed order: smooth, tilt, override, align (default `mean` — preamp owns level). Target derived from the BASE chain once; before/after and every search candidate score against the same reference. Target-relative objectives are ungameable: collateral damage inside a scored range costs the objective directly.

`points` takes either inline `"points":[[hz,db],…]` or `"path":"fr.txt","format":"fr_text"` (never both) — `fr_text` is one point per line, whitespace-separated, first two numeric columns read as Hz and dB; further columns ignored, non-numeric lines (blank, comment, header) skipped and counted. Either form accepts `"despike":{"window":7,"threshold_db":3}`: a point is dropped when its deviation from the rolling window median exceeds BOTH `threshold_db` and 3 robust sigma (1.4826·MAD) — the dB threshold is an absolute floor, the MAD term stops a genuinely steep stretch of curve being shaved. Rejected points are dropped, not replaced; count and frequencies land in the answer's `target.detail`.

`difference` composes two targets: `{"from":"difference","a":{…target spec…},"b":{…target spec…}}` is a − b. Each operand resolves in full — own source, own smooth/tilt/override/align — and this spec's pipeline then applies on top of the difference. A nested operand's `align` defaults to `none` rather than `mean`, because mean-aligning both operands before subtracting erases the offset the difference was asked for; an explicit nested `align` is still honoured.

### notes

`{"from":"G4","to":"E6","harmonics":[1,2,3,4,5]}` — per-note response table / deltas. `harmonics` default `[1]`.

## Job kinds

- **probe** — panel, extrema (off-grid refined; `edge` entries included), notes, preamp (`preamp_db` 20 Hz grid, `preamp_db_full` includes sub-20 Hz shelf asymptote), process string.
- **evaluate** — `"changes":{"amend":[…],"append":[…],"replace":[…]}`; before/after panels, metric deltas, `flags`, note deltas, per-replace `fit`.
- **search** — grid sweep over declared `space`, optional `refine` continuous descent.
- **refine** — standalone warm start: `"seed"` (previous result's `changes`) + `space` (bounds) + scalar `objective`; no grid sweep.
- **diff** — `"against":{…chain spec…}`; deltas B−A: metric deltas, summed-response residual, band pairing by exact f, note deltas.
- **snapshot** — `{"save":"name","overwrite":false}` writes chain JSON to `data/eqlab/`; `{"list":true}` needs no chain.
- **export** — `{"path":"eq.txt","format":"parametric_eq","overwrite":false}`; Preamp line computed from the summed response.
- **plot** — `{"path":"out.svg","show":["residual"],"against":{…chain spec…},"range":[20,20000],"y":[-6,6],"overwrite":false}` renders the curves to a self-contained SVG (legend, log-f and dB gridlines, distinct zero line) for the own-eyes plot check; answers `{"path","series"}`. `show` picks from `response` (summed chain dB), `target` (resolved target), `residual` (chain − target), `terrain` (0 − target, the error a no-op chain leaves), default `["residual"]` — the target-relative three need `job.target`. `against` draws a second chain's `response`/`residual` as dashed "(against)" twins for before/after. `range` defaults 20–20000 (log-x); `y` defaults auto including 0 dB; data outside `y` is clipped, never dropped. `overwrite` defaults false, matching snapshot/export.
### Change semantics

- `amend.select` matches an existing band's `f` EXACTLY — no nearest-match; not-found or non-unique is an error.
- `replace` = first-class segment swap: `remove` (literal frequencies, exact-match) deleted, `with` bands inserted — honest band count, no g=0 workaround. `"with":[]` = pure removal. A band is amended or replaced, never both. Each replace reports `fit` (rmse, maxdev + Hz of replacement vs removed contribution over `fit_range`, default 20–20000) — reported, never gating.

### Search space

`amend` / `replace` / `append` each take a LIST of change specs; each spec contributes one concrete change per candidate, crossed independently (a cut plus a broader lift = two `append` entries). Parameter values: `[from,to,step]` numeric triple = range; any other array = literal list; `{"values":[…]}` = literal list of any length; `{"from":…,"to":…,"step":…}` also accepted; scalar = fixed. TRAP: a 3-number array is ALWAYS a range, so a literal 3-value list must use `{"values":[0,0.5,1.0]}` — a triple whose range collapses to one value errors loudly rather than silently sweeping nothing. `select` and `remove` stay literal — to vary which band moves, give one spec per band.

- `constraints`: `[{"metric":"name","min":…,"max":…}]` — at least one bound each; candidates judged against ALL constraints.
- `objective`: `"minimize <expr>"` / `"maximize <expr>"` — full expression over metric panel names.
- `pareto`: two or more objective strings, replaces `objective` (never both); answers with the non-dominated front.
- `top`: default 10.
- `refine`: `true` or `{"survivors":3,"max_evals":600,"tol":1e-5}` — deterministic coordinate descent + Nelder-Mead from grid winners, over every parameter with >1 declared value, bounded by declared min/max. Scalar: refines top survivors, re-ranks. Pareto: refines each front member without worsening other objectives.

Search answers report: survivors (changes, score(s), metrics, preamps, process, flags, `binding` — constraint nearest its bound with slack), `rejected_by`, `rejected_top` (best rejects with every violated bound), and scalar-only `margin` (winner vs runner-up) and `sensitivity` (what relaxing each constraint alone buys).

### Guards, performance

`MAX_COMBOS` 2,000,000 / `MAX_STEPS` 100,000 — runaway stops, not budgets; hitting one means split the space and batch, not ask. Measured ~670 candidates/s (two varied bands); plan batches by the clock.

### Flags (evaluate/search answers)

Policy: `gain_change_per_turn`. Guidance: `high-Q_large_step`, `fitting_above_8kHz`, `Q_outside_AutoEq`, `sub-20Hz_headroom`. Confidence: `reseat_variance`, `above_qualified_range`. Headroom flags from preamp.

### Not modelled (raise, don't route around)

- `select` is literal per amend spec — a search varies band parameters, never which band a spec amends
- 16-row summation — one row's EQ tail measured, guarded by `tail_consistency`
- phase and group delay
- non-IIR stage synthesis (delay, riaa, convolution measured, never proposed)
