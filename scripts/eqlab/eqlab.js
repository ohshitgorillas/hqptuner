#!/usr/bin/env node
// eqlab — read-only measurement rig for the HQPTuner EQ chain.
//
//   node scripts/eqlab/eqlab.js < job.json      # JSON on stdout, table on stderr
//
// One job in, one answer out. The math is lib/dsp.js (`chainResponse`) and the
// process-string grammar is lib/matrixspec.js — this tool reimplements neither,
// so what it reports is what the UI plots.
//
// Job:
//   { "fs": 44100,
//     "chain":   {"from":"daemon","row":0,"eq_only":false} | {"bands":[{type,f,q,g},...]}
//              | {"from":"xml","path":"cfg.xml","row":0,"eq_only":false}      // config-snapshot XML <matrix> rows
//              | {"from":"parametric_eq","path":"eq.txt"}                     // REW / EQ APO / AutoEq text
//              | {"from":"snapshot","name":"..."},                            // saved eqlab snapshot (data/eqlab/)
//     "target":  {"from":"current"|"flat"|"points"|"chain"|"parametric_eq", ...,
//                 "smooth":{"octaves":1}, "tilt":{"db_per_octave":-0.5,"pivot":1000},
//                 "override":[{"range":[1700,2600],"method":"interpolate_edges"}],
//                 "align":"mean"|"none"|{"at":1000}},           // optional; grammar in target.js
//     "metrics": "standard" | {"preset":"standard", ...more} |  // named panel preset (metrics.js PRESETS)
//                {"hot": {"kind":"max","range":[1700,2600]},    // curve kinds: max min mean at expr
//                 "dev": {"kind":"maxdev","range":[1000,3500]}, //   + ripple slope prominence note_spread
//                 "fit": {"kind":"rmse","range":[200,8000],"domain":"erb"},
//                        // target-relative kinds (need job.target): rmse maxdev maxdev_signed mean_signed
//                 "v_db":{"kind":"expr","expr":"(mean(50,150)+mean(4000,10000))/2 - mean(400,1500)"}},
//     "notes":   {"from":"G4","to":"E6","harmonics":[1,2,3,4,5]},
//     "job":     {"kind":"probe"}
//              | {"kind":"evaluate","changes":{"amend":[{"select":2090,"g":2.0}],"append":[{"f":1250,"q":1.4,"g":1.2}],
//                 "replace":[{"remove":[7959,8000],"with":[{"f":7980,"q":2.0,"g":-3.0}],"fit_range":[4000,12000]}]}}
//              | {"kind":"search","space":{...},"constraints":[...],"objective":"minimize dev","top":12,
//                 "refine":true | {"survivors":3,"max_evals":600,"tol":1e-5}}   // continuous refinement of grid winners
//              | {"kind":"search","space":{...},"pareto":["minimize dev","maximize bass_50_150"],...}
//              | {"kind":"refine","seed":{"amend":[...],"append":[...]},"space":{...},
//                 "constraints":[...],"objective":"minimize dev"}               // warm start from a previous result
//              | {"kind":"diff","against":{...chain spec...}}                   // chain A (job.chain) vs B, deltas B - A
//              | {"kind":"snapshot","save":"name","overwrite":false}            // write chain to the snapshot store
//              | {"kind":"snapshot","list":true}                                // list the store (needs no chain)
//              | {"kind":"export","path":"eq.txt","format":"parametric_eq",
//                 "overwrite":false} }                                          // write REW / EQ APO text file
//
// A search space's `amend`, `replace`, and `append` each take a LIST of change
// specs; every spec contributes one concrete change per candidate, crossed
// independently — a cut plus a broader lift is two entries in `append`.
//
// `replace` swaps a segment first-class: the `remove` bands (literal
// frequencies, exact-match like `select`) are genuinely deleted and the `with`
// bands inserted in their place — honest band count and process string, no
// g=0 workaround. `with` band parameters sweep and refine like `append`'s;
// `with: []` is pure removal; a band is amended or replaced, never both. Every
// answer carrying a replace reports `fit` per replace spec: the residual of
// the replacement's response against the removed segment's own contribution
// (rmse, maxdev + Hz) over `fit_range` (default 20-20000 Hz). Reported, never
// gating — a deliberate reshape has a large residual on purpose.
//
// `pareto` replaces `objective` (never both): two or more "minimize/maximize
// <expr>" strings, answered with the non-dominated front instead of a scalar
// ranking. Every search also reports: per-survivor `binding` (the constraint
// closest to its bound, with slack), `rejected_top` (best rejects with every
// violated bound and by how much), and — scalar only — `margin` (winner vs
// runner-up) and `sensitivity` (what relaxing each constraint alone would buy).
//
// `refine` runs a deterministic continuous descent (coordinate descent +
// Nelder-Mead) from each grid winner over every parameter the space declared
// more than one value for, bounded by that parameter's declared min/max.
// Scalar mode refines the top `survivors` then re-ranks; pareto mode refines
// each returned front member without letting any other objective worsen. The
// standalone "refine" kind warm-starts from an explicit `seed` (a previous
// result's `changes`) with no grid sweep — scalar objective only. `margin` and
// `sensitivity` stay grid-derived.
//
// `amend.select` matches an existing band's `f` EXACTLY — no nearest-match, no
// fuzz. Not found or not unique is an error, because this chain carries bands
// 41 Hz apart (7959 and 8000) where a nearest-match would silently pick wrong.
//
// `diff` answers "what changes going from A to B": both panels, metric deltas
// (B minus A), the summed-response residual (rmse, maxdev + Hz), band pairing
// by exact f (matched with per-parameter deltas / only_a / only_b), and note
// deltas. `snapshot` and `export` are the write lane: named chain JSON in the
// store eqlab owns (data/eqlab/), and ParametricEQ text via the shipped
// serializer — the Preamp line is computed from the summed response and
// flagged as such.
//
// NEVER WRITES THE DAEMON: the only request it makes is GET /api/matrix.
// Writes go to files only — snapshots and exports. It emits a process string;
// applying it is a human's move.
//
// TO THE AGENT DRIVING THIS: the numbers are yours. Search width, step size,
// how many passes to run, which metrics to define, how to batch a space too big
// for one invocation — decide, run it, report the result. None of that is a
// question for the user.
//
// What IS worth raising: a question this job schema cannot express, a metric
// kind that does not exist, a chain shape the tool does not model, an answer
// that would need a filter specification HQPlayer has never published. Those
// are missing capability, and the fix is to widen the tool — so say so plainly
// instead of hedging the answer down to what happened to be implementable.

import { resolveChain } from "./chain.js";
import { exportJob, snapshotJob } from "./io.js";
import { diffJob, evaluateJob, probe } from "./jobs.js";
import { curveOf, F_HI, F_LO, GRID_N, resolveMetricSpecs } from "./metrics.js";
import { render } from "./render.js";
import { refineJob, searchJob } from "./search.js";
import { MAX_COMBOS, MAX_STEPS } from "./space.js";
import { resolveTarget } from "./target.js";

const KINDS = {
  probe,
  evaluate: evaluateJob,
  search: searchJob,
  refine: refineJob,
  diff: diffJob,
  snapshot: snapshotJob,
  export: exportJob,
};

// What this rig can and cannot do, on every run. `guards` are runaway stops to
// plan batches around, not budgets to ask about; `not_modelled` is the list
// worth raising, because widening it is a code change and nothing in a job can
// route around it.
const LIMITS = {
  grid: { points: GRID_N, f_lo_hz: F_LO, f_hi_hz: F_HI },
  guards: { max_combinations: MAX_COMBOS, max_values_per_range: MAX_STEPS },
  not_modelled: [
    "`select` is a literal per amend spec — a search varies band parameters, never which band a spec amends",
    "16-row summation — one row's EQ tail is measured, guarded by tail_consistency",
    "phase and group delay",
    "non-iir stage synthesis (delay, riaa, convolution are measured, never proposed)",
  ],
};

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function run(job) {
  const spec = job.job || {};
  const handler = KINDS[spec.kind];
  if (!handler) throw new Error(`job.kind must be one of ${Object.keys(KINDS).join(" / ")}, got ${spec.kind}`);
  // Snapshot list is the one job with no chain: it reads the store, nothing else.
  const listOnly = spec.kind === "snapshot" && spec.list;
  const { stages, source, consistency } = listOnly
    ? { stages: [], source: { kind: "none", stage_count: 0 }, consistency: null }
    : await resolveChain(job.chain);
  const fs = Number(job.fs || 44100);
  // Target is derived from the BASE chain, once — before/after and every
  // search candidate score against the same reference.
  const target = await resolveTarget(job.target, curveOf(stages, fs), fs);
  const ctx = {
    stages,
    fs,
    source,
    metrics: resolveMetricSpecs(job.metrics),
    notes: job.notes,
    target: target && target.curve,
  };
  return {
    job: spec.kind,
    fs,
    source,
    tail_consistency: consistency,
    ...(target ? { target: target.meta } : {}),
    limits: LIMITS,
    ...(await handler(spec, ctx)),
  };
}

async function main() {
  const text = await readStdin();
  if (!text.trim()) throw new Error("no job on stdin");
  const out = await run(JSON.parse(text));
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  process.stderr.write(render(out));
}

main().catch((err) => {
  process.stdout.write(`${JSON.stringify({ error: String(err.message || err) }, null, 2)}\n`);
  process.stderr.write(`eqlab: ${err.message || err}\n`);
  process.exitCode = 1;
});
