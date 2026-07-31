// Human-readable rendering — stderr only. The JSON on stdout is the contract;
// this is what a person reads while the caller machine-reads the other stream.

const w = (s, n) => String(s).padEnd(n);
const rt = (s, n) => String(s).padStart(n);

function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)));
  const line = (cells) => cells.map((c, i) => (i === 0 ? w(c, widths[i]) : rt(c ?? "", widths[i]))).join("  ");
  return [line(headers), widths.map((n) => "-".repeat(n)).join("  "), ...rows.map(line)].join("\n");
}

function header(out) {
  const src = out.source;
  const where =
    src.kind === "daemon"
      ? `daemon row ${src.row}${src.eq_only ? " (eq tail only)" : ""} <- ${src.url}`
      : "bands from job";
  const c = out.tail_consistency;
  const tail = c
    ? `tail_consistent=${c.tail_consistent} over ${c.rows_checked} rows${c.tail_consistent ? "" : ` (offending: ${c.offending_rows.join(", ")})`}`
    : "tail check n/a (chain given as bands)";
  const lim = out.limits;
  const limits = lim
    ? `grid: ${lim.grid.points} pts, ${lim.grid.f_lo_hz}-${lim.grid.f_hi_hz} Hz   not modelled: ${lim.not_modelled.length} (see limits in JSON)`
    : "";
  const target = out.target ? `target: ${out.target.summary}` : "";
  return [`source: ${where}`, `stages: ${src.stage_count}   fs: ${out.fs} Hz`, tail, target, limits]
    .filter(Boolean)
    .join("\n");
}

function metricRows(metrics) {
  return Object.entries(metrics).map(([k, v]) => [k, v.value.toFixed(3), v.hz === undefined ? "" : v.hz.toFixed(1)]);
}

function notesTable(notes) {
  if (!notes) return "";
  const ns = notes[0].harmonics.map((h) => `h${h.n}`);
  const rows = notes.map((n) => [
    n.name,
    n.hz.toFixed(1),
    ...n.harmonics.map((h) => (h.db === null ? "-" : (h.delta === undefined ? h.db : h.delta).toFixed(2))),
  ]);
  return `\nnotes (dB${notes[0].harmonics[0].delta === undefined ? "" : ", delta"}):\n${table(["note", "Hz", ...ns], rows)}`;
}

function flagLines(flags) {
  if (!flags || flags.length === 0) return "";
  return `\nflags:\n${flags.map((f) => `  [${f.severity}] ${f.rule}: ${f.detail}`).join("\n")}`;
}

function renderProbe(out) {
  const ext = out.extrema.map((e) => [e.kind, e.hz.toFixed(1), e.db.toFixed(2)]);
  return [
    `preamp: ${out.preamp_db.toFixed(2)} dB`,
    `\nextrema (summed chain):\n${table(["kind", "Hz", "dB"], ext)}`,
    `\nmetrics:\n${table(["metric", "value", "Hz"], metricRows(out.metrics))}`,
    notesTable(out.notes),
  ].join("\n");
}

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
    flagLines(out.flags),
    `\nprocess:\n${out.after.process}`,
  ].join("\n");
}

function rejectedSummary(out) {
  const rejected = Object.entries(out.rejected_by)
    .map(([k, n]) => `${k}=${n}`)
    .join(" ");
  return rejected ? `   rejected by: ${rejected}` : "";
}

function rejectLines(out) {
  if (!out.rejected_top || out.rejected_top.length === 0) return "";
  const rows = out.rejected_top.map((r) => [
    r.score.toFixed(4),
    r.reasons.map((x) => `${x.metric} ${x.bound}=${x.limit} by ${x.by}`).join("; "),
    JSON.stringify(r.changes),
  ]);
  return `\nbest rejected:\n${table(["score", "failed", "changes"], rows)}`;
}

function sensitivityLines(out) {
  if (!out.sensitivity || out.sensitivity.length === 0) return "";
  return `\nsensitivity:\n${out.sensitivity
    .map(
      (s) =>
        `  relax ${s.metric} ${s.bound} ${s.limit} by ${s.relax_by} -> score ${s.score}${s.gain === undefined ? "" : ` (gain ${s.gain})`}`,
    )
    .join("\n")}`;
}

function renderPareto(out) {
  const exprs = out.pareto.objectives.map((o) => o.expr);
  const names = (out.front.length ? Object.keys(out.front[0].metrics) : []).filter((n) => !exprs.includes(n));
  const rows = out.front.map((c, i) => [
    String(i + 1),
    ...exprs.map((e) => c.scores[e].toFixed(4)),
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
    rejectLines(out),
  ].join("\n");
}

function renderSearch(out) {
  if (out.pareto) return renderPareto(out);
  const names = out.top.length ? Object.keys(out.top[0].metrics) : [];
  const rows = out.top.map((c, i) => [
    String(i + 1),
    c.score.toFixed(4),
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
    sensitivityLines(out),
    rejectLines(out),
    flagLines(out.top[0] && out.top[0].flags),
  ].join("\n");
}

const BODY = { probe: renderProbe, evaluate: renderEvaluate, search: renderSearch };

/** Full stderr report for a finished job. */
export function render(out) {
  return `${header(out)}\n\n${BODY[out.job](out)}\n`;
}
