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
//     "chain":   {"from":"daemon","row":0,"eq_only":false} | {"bands":[{type,f,q,g},...]},
//     "metrics": {"hot": {"kind":"max","range":[1700,2600]},
//                 "body":{"kind":"mean","range":[1000,1800]},
//                 "v_db":{"kind":"expr","expr":"(mean(50,150)+mean(4000,10000))/2 - mean(400,1500)"}},
//     "notes":   {"from":"G4","to":"E6","harmonics":[1,2,3,4,5]},
//     "job":     {"kind":"probe"}
//              | {"kind":"evaluate","changes":{"amend":[{"select":2090,"g":2.0}],"append":[{"f":1250,"q":1.4,"g":1.2}]}}
//              | {"kind":"search","space":{...},"constraints":[...],"objective":"maximize body - hot","top":12} }
//
// `amend.select` matches an existing band's `f` EXACTLY — no nearest-match, no
// fuzz. Not found or not unique is an error, because this chain carries bands
// 41 Hz apart (7959 and 8000) where a nearest-match would silently pick wrong.
//
// READ-ONLY BY CONSTRUCTION: the only request it makes is GET /api/matrix. It
// emits a process string; applying it is a human's move.
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
import { evaluateJob, probe } from "./jobs.js";
import { F_HI, F_LO, GRID_N } from "./metrics.js";
import { render } from "./render.js";
import { MAX_COMBOS, MAX_STEPS, searchJob } from "./search.js";

const KINDS = { probe, evaluate: evaluateJob, search: searchJob };

// What this rig can and cannot do, on every run. `guards` are runaway stops to
// plan batches around, not budgets to ask about; `not_modelled` is the list
// worth raising, because widening it is a code change and nothing in a job can
// route around it.
const LIMITS = {
  grid: { points: GRID_N, f_lo_hz: F_LO, f_hi_hz: F_HI },
  guards: { max_combinations: MAX_COMBOS, max_values_per_range: MAX_STEPS },
  not_modelled: [
    "one `select` per search space — every candidate amends the same band",
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
  const { stages, source, consistency } = await resolveChain(job.chain);
  const fs = Number(job.fs || 44100);
  const ctx = { stages, fs, metrics: job.metrics, notes: job.notes };
  return { job: spec.kind, fs, source, tail_consistency: consistency, limits: LIMITS, ...handler(spec, ctx) };
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
