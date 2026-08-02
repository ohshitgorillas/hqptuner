// eqstage — stage an EQ into HQPTuner's pending buffer.
//
//   node scripts/eqstage/eqstage.js < job.json    # JSON on stdout, table on stderr
//
// The buffer is server-side (api/pendingapi.py), so anything staged here shows
// up in the user's open browser tab within a poll tick and arms Apply. Nothing
// reaches the daemon until the user clicks it — this tool never applies.
//
// eqlab designs and measures; eqstage puts the result in front of the user.

import { parseProcess, serializeProcess } from "../../hqptuner/static/lib/matrixspec.js";
import { isEq } from "../eqlab/chain.js";
import { curveOf, preampDb, round } from "../eqlab/metrics.js";
import { postStage, verifyPending } from "./post.js";
import { canonPipelines, editRow, lintRow, readBaseline, resolveEq, selectRows } from "./rows.js";

const DEFAULT_URL = "http://127.0.0.1:8090";
const DEFAULT_FS = 44100;

// Parametric-EQ stages only. A crossfeed `lp1` is an `iir:` stage too, and
// counting it as a band makes a decomposed row look like it lost EQ it never had.
const bandCount = (process) => parseProcess(process || "").filter(isEq).length;

const rowFacts = (row) => ({
  band_count: bandCount(row.process),
  process: row.process,
  gain: row.gain,
  gainunit: row.gainunit,
});

/**
 * The preamp to write, in dB. `"auto"` is the negative of the summed response's
 * maximum — the same guardrail eqlab reports — computed from the EQ being
 * staged, so a lift that peaks at +4 dB stages a −4 dB channel gain.
 */
function preampOf(spec, stages, fs) {
  if (spec === undefined || spec === null) return null;
  if (spec === "auto") return round(preampDb(curveOf(stages, fs)), 2);
  if (typeof spec !== "number" || !Number.isFinite(spec)) {
    throw new Error(`preamp_db: give a number, "auto", or null — got ${JSON.stringify(spec)}`);
  }
  return spec;
}

/**
 * Run one job. Returns the answer; every failure — a bad baseline row, a linear
 * gain row, a lost race on the buffer — rejects, and rejects before the POST
 * wherever the fault is knowable from the payload alone.
 */
export async function runJob(job, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const base = String(job.url || DEFAULT_URL).replace(/\/$/, "");
  const fs = job.fs || DEFAULT_FS;

  const stages = await resolveEq(job.eq);
  const { rows: baseline, baseline_source } = await readBaseline(base, fetchImpl);
  const selected = new Set(selectRows(job.rows, baseline.length));
  const preamp = preampOf(job.preamp_db, stages, fs);
  const opts = { mode: job.mode || "replace_tail", preampDb: preamp, forceGainunit: Boolean(job.force_gainunit) };

  const staged = baseline.map((row, i) => (selected.has(i) ? editRow(row, stages, opts) : row));
  staged.forEach(lintRow);

  const payload = {
    live: job.live || {},
    http: { ...(job.http || {}), matrix_pipelines: canonPipelines(staged) },
  };
  const report = {
    baseline_source,
    eq: { band_count: stages.length, process: serializeProcess(stages) },
    preamp_db: preamp,
    rows: baseline.map((row, i) => ({
      index: i,
      selected: selected.has(i),
      before: rowFacts(row),
      after: rowFacts(staged[i]),
    })),
    staged: payload,
    posted: false,
    verified: false,
    dry_run: Boolean(job.dry_run),
  };
  if (job.dry_run) return report;

  await postStage(base, payload, fetchImpl);
  report.posted = true;
  report.verified = await verifyPending(base, payload, fetchImpl);
  return report;
}

// --- CLI --------------------------------------------------------------------

/** The human-facing summary: what each row gained, and what to do next. */
function table(report) {
  const lines = [`baseline: ${report.baseline_source}`, `eq: ${report.eq.band_count} bands  ${report.eq.process}`];
  for (const row of report.rows) {
    const mark = row.selected ? "*" : " ";
    const gain = row.before.gain === row.after.gain ? row.after.gain : `${row.before.gain} -> ${row.after.gain}`;
    lines.push(`${mark} row ${row.index}: ${row.before.band_count} -> ${row.after.band_count} bands, gain ${gain}`);
  }
  const fields = Object.keys(report.staged.http).concat(Object.keys(report.staged.live)).join(", ");
  lines.push(report.dry_run ? `dry run — would stage: ${fields}` : `staged: ${fields}`);
  if (report.posted) lines.push("pending buffer armed — the user clicks Apply; this tool never does.");
  return lines.join("\n");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const text = await readStdin();
  if (!text.trim()) throw new Error("eqstage: no job on stdin");
  const report = await runJob(JSON.parse(text));
  process.stderr.write(`${table(report)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`eqstage: ${err.message}\n`);
    process.exitCode = 1;
  });
}
