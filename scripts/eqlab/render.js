// Human-readable rendering — stderr only. The JSON on stdout is the contract;
// this is what a person reads while the caller machine-reads the other stream.

/** @typedef {import("./jobs.js").RoundedNote} RoundedNote */
/** @typedef {import("./jobs.js").PanelOut} PanelOut */
/** @typedef {import("./guidance.js").Flag} Flag */
/** @typedef {import("./search.js").SurvivorOut} SurvivorOut */
/** @typedef {import("./search.js").Failure} Failure */
/** @typedef {import("./metrics.js").MetricResult} MetricResult */
/** @typedef {import("./fit.js").Fit} Fit */

/**
 * One table cell before padding.
 *
 * @typedef {string | number | null | undefined} Cell
 */

/**
 * The header block every job's answer carries, assembled in eqlab.js `run`.
 * The job body is spread in alongside it; which of the eight shapes that is,
 * is a runtime fact `render`'s lookup-table dispatch erases. Each renderer
 * below declares the fields it actually reads, and that is where checking bites.
 *
 * @typedef {{
 *   job: string,
 *   fs: number,
 *   source: Record<string, any>,
 *   tail_consistency: import("./chain.js").Consistency | null,
 *   target?: { summary: string },
 *   limits?: { grid: { points: number, f_lo_hz: number, f_hi_hz: number }, not_modelled: string[] } | null,
 * }} Report
 */

/**
 * Counts and rejects every search-shaped answer carries.
 *
 * @typedef {{
 *   considered: number,
 *   survived: number,
 *   returned: number,
 *   rejected_by: Record<string, number>,
 *   rejected_top?: { score: number, changes: unknown, reasons: Failure[] }[],
 * }} SweepCommon
 */

/**
 * A scalar search's answer. `pareto` is declared absent so the two search
 * shapes discriminate on it, which is exactly the test `renderSearch` makes.
 *
 * @typedef {SweepCommon & {
 *   pareto?: undefined,
 *   objective: { direction: string, expr: string },
 *   top: SurvivorOut[],
 *   margin: number | null,
 *   sensitivity?: { metric: string, bound: string, limit: number, relax_by: number, score: number, gain?: number }[],
 * }} SearchReport
 */

/**
 * A pareto search's answer.
 *
 * @typedef {SweepCommon & {
 *   pareto: { objectives: { direction: string, expr: string }[] },
 *   front: SurvivorOut[],
 *   front_size: number,
 * }} ParetoReport
 */

const w = (/** @type {Cell} */ s, /** @type {number} */ n) => String(s).padEnd(n);
const rt = (/** @type {Cell} */ s, /** @type {number} */ n) => String(s).padStart(n);

/**
 * @param {string[]} headers
 * @param {Cell[][]} rows
 * @returns {string}
 */
function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)));
  const line = (/** @type {Cell[]} */ cells) =>
    cells.map((c, i) => (i === 0 ? w(c, widths[i]) : rt(c ?? "", widths[i]))).join("  ");
  return [line(headers), widths.map((n) => "-".repeat(n)).join("  "), ...rows.map(line)].join("\n");
}

/**
 * @param {Record<string, any>} src
 * @returns {string}
 */
function whereOf(src) {
  switch (src.kind) {
    case "daemon":
      return `daemon row ${src.row}${src.eq_only ? " (eq tail only)" : ""} <- ${src.url}`;
    case "xml":
      return `xml channel ${src.row}${src.eq_only ? " (eq tail only)" : ""} <- ${src.path}`;
    case "parametric_eq":
      return `parametric_eq <- ${src.path}${src.skipped.length ? ` (${src.skipped.length} line(s) skipped)` : ""}`;
    case "snapshot":
      return `snapshot "${src.name}" (${src.saved_at}) <- ${src.path}`;
    case "none":
      return "no chain (store operation)";
    default:
      return "bands from job";
  }
}

/**
 * @param {Report} out
 * @returns {string}
 */
function header(out) {
  const src = out.source;
  const where = whereOf(src);
  const c = out.tail_consistency;
  const tail = c
    ? `tail_consistent=${c.tail_consistent} over ${c.rows_checked} rows${c.tail_consistent ? "" : ` (offending: ${c.offending_rows.join(", ")})`}`
    : "tail check n/a (single-chain source)";
  const lim = out.limits;
  const limits = lim
    ? `grid: ${lim.grid.points} pts, ${lim.grid.f_lo_hz}-${lim.grid.f_hi_hz} Hz   not modelled: ${lim.not_modelled.length} (see limits in JSON)`
    : "";
  const target = out.target ? `target: ${out.target.summary}` : "";
  return [`source: ${where}`, `stages: ${src.stage_count}   fs: ${out.fs} Hz`, tail, target, limits]
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {Record<string, MetricResult>} metrics
 * @returns {Cell[][]}
 */
function metricRows(metrics) {
  return Object.entries(metrics).map(([k, v]) => [k, v.value.toFixed(3), v.hz === undefined ? "" : v.hz.toFixed(1)]);
}

/**
 * A note table, or a note DELTA table — the two differ by which key carries the
 * number, which is what the `delta === undefined` test below picks apart.
 *
 * @param {RoundedNote[] | null | undefined} notes
 * @returns {string}
 */
function notesTable(notes) {
  if (!notes) return "";
  const ns = notes[0].harmonics.map((h) => `h${h.n}`);
  const rows = notes.map((n) => [
    n.name,
    n.hz.toFixed(1),
    // Pick the column first, then test it once. A harmonic outside the grid is
    // null on EITHER table — `db` on a note table, `delta` on a delta table —
    // and testing only `db` crashes the delta case on `null.toFixed`.
    ...n.harmonics.map((h) => {
      const shown = h.delta === undefined ? h.db : h.delta;
      return shown === null || shown === undefined ? "-" : shown.toFixed(2);
    }),
  ]);
  return `\nnotes (dB${notes[0].harmonics[0].delta === undefined ? "" : ", delta"}):\n${table(["note", "Hz", ...ns], rows)}`;
}

/**
 * @param {Fit[] | null | undefined} fit
 * @returns {string}
 */
function fitLines(fit) {
  if (!fit || fit.length === 0) return "";
  const one = (/** @type {Fit} */ f, /** @type {number} */ i) =>
    `  #${i + 1}: rmse ${f.rmse} dB, maxdev ${f.maxdev} dB @ ${f.hz} Hz (${f.range[0]}-${f.range[1]} Hz)`;
  return `\nfit residual (replacement vs removed):\n${fit.map(one).join("\n")}`;
}

/**
 * @param {Flag[] | null | undefined} flags
 * @returns {string}
 */
function flagLines(flags) {
  if (!flags || flags.length === 0) return "";
  return `\nflags:\n${flags.map((f) => `  [${f.severity}] ${f.rule}: ${f.detail}`).join("\n")}`;
}

/**
 * @param {ReturnType<typeof import("./jobs.js").probe>} out
 * @returns {string}
 */
function renderProbe(out) {
  const ext = out.extrema.map((e) => [e.kind, e.hz.toFixed(1), e.db.toFixed(2)]);
  return [
    `preamp: ${out.preamp_db.toFixed(2)} dB`,
    `\nextrema (summed chain):\n${table(["kind", "Hz", "dB"], ext)}`,
    `\nmetrics:\n${table(["metric", "value", "Hz"], metricRows(out.metrics))}`,
    notesTable(out.notes),
  ].join("\n");
}

/**
 * @param {ReturnType<typeof import("./jobs.js").evaluateJob>} out
 * @returns {string}
 */
function renderEvaluate(out) {
  const rows = Object.keys(out.after.metrics).map((k) => [
    k,
    out.before.metrics[k].value.toFixed(3),
    out.after.metrics[k].value.toFixed(3),
    out.metric_deltas[k].toFixed(3),
  ]);
  return [
    `preamp: ${out.before.preamp_db.toFixed(2)} -> ${out.after.preamp_db.toFixed(2)} dB`,
    `\nmetrics:\n${table(["metric", "before", "after", "delta"], rows)}`,
    notesTable(out.note_deltas),
    fitLines(out.fit),
    flagLines(out.flags),
    `\nprocess:\n${out.after.process}`,
  ].join("\n");
}

/**
 * @param {SweepCommon} out
 * @returns {string}
 */
function rejectedSummary(out) {
  const rejected = Object.entries(out.rejected_by)
    .map(([k, n]) => `${k}=${n}`)
    .join(" ");
  return rejected ? `   rejected by: ${rejected}` : "";
}

/**
 * @param {SweepCommon} out
 * @returns {string}
 */
function rejectLines(out) {
  if (!out.rejected_top || out.rejected_top.length === 0) return "";
  const rows = out.rejected_top.map((r) => [
    r.score.toFixed(4),
    r.reasons.map((x) => `${x.metric} ${x.bound}=${x.limit} by ${x.by}`).join("; "),
    JSON.stringify(r.changes),
  ]);
  return `\nbest rejected:\n${table(["score", "failed", "changes"], rows)}`;
}

/**
 * @param {SearchReport} out
 * @returns {string}
 */
function sensitivityLines(out) {
  if (!out.sensitivity || out.sensitivity.length === 0) return "";
  return `\nsensitivity:\n${out.sensitivity
    .map(
      (s) =>
        `  relax ${s.metric} ${s.bound} ${s.limit} by ${s.relax_by} -> score ${s.score}${s.gain === undefined ? "" : ` (gain ${s.gain})`}`,
    )
    .join("\n")}`;
}

const refinedNote = (/** @type {NonNullable<SurvivorOut["refined"]>} */ r) =>
  `${r.from_score} -> ${r.score} (evals ${r.evals}${r.converged ? "" : ", not converged"}${r.improved ? "" : ", grid point kept"})`;

/**
 * @param {SurvivorOut[] | null | undefined} list
 * @returns {string}
 */
function refinedLines(list) {
  const rows = (list || []).flatMap((c, i) => (c.refined ? [{ i, r: c.refined }] : []));
  if (!rows.length) return "";
  return `\nrefined:\n${rows.map((x) => `  #${x.i + 1}: ${refinedNote(x.r)}`).join("\n")}`;
}

/**
 * @param {{ best: SurvivorOut, objective: { direction: string, expr: string } }} out
 * @returns {string}
 */
function renderRefine(out) {
  const b = out.best;
  const metricRows2 = Object.entries(b.metrics).map(([k, v]) => [k, v.toFixed(3)]);
  const violations = b.violations
    ? `\nviolations:\n${b.violations.map((v) => `  ${v.metric} ${v.bound}=${v.limit} by ${v.by}`).join("\n")}`
    : "";
  return [
    `objective: ${out.objective.direction} ${out.objective.expr}`,
    // A refine job's best always carries a `refined` block — `refineEntry`
    // writes one on every entry it returns.
    `seed ${refinedNote(/** @type {NonNullable<SurvivorOut["refined"]>} */ (b.refined))}`,
    `preamp: ${b.preamp_db.toFixed(2)} dB`,
    `\nmetrics:\n${table(["metric", "value"], metricRows2)}`,
    violations,
    fitLines(b.fit),
    flagLines(b.flags),
    `\nchanges: ${JSON.stringify(b.changes)}`,
    `\nprocess:\n${b.process}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {ParetoReport} out
 * @returns {string}
 */
function renderPareto(out) {
  const exprs = out.pareto.objectives.map((o) => o.expr);
  const names = (out.front.length ? Object.keys(out.front[0].metrics) : []).filter((n) => !exprs.includes(n));
  // In pareto mode `survivorOut` writes `scores`, never the scalar `score`.
  const rows = out.front.map((c, i) => [
    String(i + 1),
    ...exprs.map((e) => /** @type {Record<string, number>} */ (c.scores)[e].toFixed(4)),
    ...names.map((n) => c.metrics[n].toFixed(3)),
    c.preamp_db.toFixed(2),
    JSON.stringify(c.changes),
  ]);
  return [
    `pareto: ${out.pareto.objectives.map((o) => `${o.direction} ${o.expr}`).join("  |  ")}`,
    `considered ${out.considered}, survived ${out.survived}, front ${out.front_size}, returned ${out.returned}${rejectedSummary(out)}`,
    out.front.length
      ? `\n${table(["#", ...exprs, ...names, "preamp", "changes"], rows)}`
      : "\nno candidate satisfied the constraints",
    refinedLines(out.front),
    rejectLines(out),
  ].join("\n");
}

/**
 * @param {SearchReport | ParetoReport} out
 * @returns {string}
 */
function renderSearch(out) {
  if (out.pareto) return renderPareto(out);
  const top = out.top;
  const names = top.length ? Object.keys(top[0].metrics) : [];
  // Scalar mode: `survivorOut` writes the single `score`, never the map.
  const rows = top.map((c, i) => [
    String(i + 1),
    /** @type {number} */ (c.score).toFixed(4),
    ...names.map((n) => c.metrics[n].toFixed(3)),
    c.preamp_db.toFixed(2),
    JSON.stringify(c.changes),
  ]);
  const margin = out.margin === null ? "" : `   margin to #2: ${out.margin}`;
  const binding = out.top[0] && out.top[0].binding;
  return [
    `objective: ${out.objective.direction} ${out.objective.expr}`,
    `considered ${out.considered}, survived ${out.survived}, returned ${out.returned}${margin}${rejectedSummary(out)}`,
    out.top.length
      ? `\n${table(["#", "score", ...names, "preamp", "changes"], rows)}`
      : "\nno candidate satisfied the constraints",
    binding ? `\nbinding: ${binding.metric} ${binding.bound} (slack ${binding.slack})` : "",
    fitLines(out.top[0] && out.top[0].fit),
    refinedLines(out.top),
    sensitivityLines(out),
    rejectLines(out),
    flagLines(out.top[0] && out.top[0].flags),
  ].join("\n");
}

/**
 * @param {Awaited<ReturnType<typeof import("./jobs.js").diffJob>>} out
 * @returns {string}
 */
function renderDiff(out) {
  const rows = Object.keys(out.a.metrics).map((k) => [
    k,
    out.a.metrics[k].value.toFixed(3),
    out.b.metrics[k].value.toFixed(3),
    out.metric_deltas[k].toFixed(3),
  ]);
  const rd = out.response_delta;
  const matched = out.bands.matched.map((m) => [
    String(m.f),
    Object.entries(m.deltas)
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`)
      .join(" ") || "identical",
  ]);
  const onlyLines = (/** @type {string} */ label, /** @type {unknown[]} */ list) =>
    list.length ? `\n${label}:\n${list.map((a) => `  ${JSON.stringify(a)}`).join("\n")}` : "";
  return [
    `against: ${whereOf(out.against_source)}`,
    `preamp: ${out.a.preamp_db.toFixed(2)} (A) vs ${out.b.preamp_db.toFixed(2)} (B) dB`,
    `response delta (B - A): rmse ${rd.rmse} dB, maxdev ${rd.maxdev} dB @ ${rd.hz} Hz`,
    `\nmetrics:\n${table(["metric", "A", "B", "B-A"], rows)}`,
    matched.length ? `\nmatched bands (B - A):\n${table(["f", "delta"], matched)}` : "",
    onlyLines("only in A", out.bands.only_a),
    onlyLines("only in B", out.bands.only_b),
    notesTable(out.note_deltas),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * A save answers with `saved`; a list answers with `dir` + `snapshots`. The two
 * never overlap, so `saved` is the discriminant.
 *
 * @param {{ saved: { name: string, path: string, process: string } }
 *   | { saved?: undefined, dir: string, snapshots: { name: string, saved_at: string, band_count: number, preamp_db: number }[] }} out
 * @returns {string}
 */
function renderSnapshot(out) {
  if (out.saved) return `saved "${out.saved.name}" -> ${out.saved.path}\nprocess:\n${out.saved.process}`;
  if (!out.snapshots.length) return `store ${out.dir}: empty`;
  const rows = out.snapshots.map((s) => [s.name, s.saved_at, String(s.band_count), s.preamp_db.toFixed(2)]);
  return `store ${out.dir}:\n${table(["name", "saved", "bands", "preamp"], rows)}`;
}

/**
 * @param {Awaited<ReturnType<typeof import("./io.js").exportJob>>} out
 * @returns {string}
 */
function renderExport(out) {
  const skipped = out.skipped.length ? `\nskipped:\n${out.skipped.map((s) => `  ${s}`).join("\n")}` : "";
  return `wrote ${out.filters} filter(s) -> ${out.path}\npreamp: ${out.preamp_db.toFixed(2)} dB (${out.preamp_source})${skipped}`;
}

/**
 * @param {Awaited<ReturnType<typeof import("./plot.js").plotJob>>} out
 * @returns {string}
 */
function renderPlot(out) {
  return `wrote plot -> ${out.path}\nseries: ${out.series.join(", ")}`;
}

// The dispatch erases which body shape goes with which key — `out.job` is a
// runtime string, so no signature here can tie the two together. Each renderer
// above states what it reads; this table only routes to it.
/** @type {Record<string, (out: any) => string>} */
const BODY = {
  probe: renderProbe,
  evaluate: renderEvaluate,
  search: renderSearch,
  refine: renderRefine,
  diff: renderDiff,
  snapshot: renderSnapshot,
  export: renderExport,
  plot: renderPlot,
};

/**
 * Full stderr report for a finished job.
 *
 * @param {Report} out
 * @returns {string}
 */
export function render(out) {
  return `${header(out)}\n\n${BODY[out.job](out)}\n`;
}
