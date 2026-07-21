// AutoEq / REW ParametricEQ text import (matrix-spec step 6). Both dialects
// share one line grammar — AutoEq: "Filter 1: ON PK Fc 105 Hz Gain -3.2 dB Q 1.41"
// preceded by "Preamp: -6.4 dB"; REW's Generic EQ export writes the same fields
// with looser spacing under a header block. Anything that isn't a filter line
// is ignored; OFF filters and unsupported types are collected in `skipped` and
// reported — never silently dropped.

import { editedStage } from "./matrixspec.js";

// REW/AutoEq type tokens -> iir plugin types (manual §7.3)
const TYPE_MAP = {
  PK: "peak",
  PEQ: "peak",
  LS: "lshelf",
  LSC: "lshelf",
  HS: "hshelf",
  HSC: "hshelf",
  LP: "lp",
  HP: "hp",
  NO: "notch",
  AP: "ap",
};
const GAINLESS = new Set(["lp", "hp", "notch", "ap"]);

const PREAMP_RE = /^Preamp\s*:\s*(-?\d+(?:\.\d+)?)\s*dB/i;
const FILTER_RE = /^Filter\s*\d+\s*:\s*(ON|OFF)\s+([A-Za-z]+)\s*(.*)$/i;

function parseFilterLine(line, m) {
  if (m[1].toUpperCase() === "OFF") return { skip: `${line} — filter is OFF` };
  const type = TYPE_MAP[m[2].toUpperCase()];
  if (!type) return { skip: `${line} — unsupported type "${m[2]}"` };
  const rest = m[3].replace(/,/g, "");
  const f = rest.match(/Fc\s+(-?[\d.]+)\s*Hz/i);
  if (!f) return { skip: `${line} — no Fc` };
  const g = rest.match(/Gain\s+(-?[\d.]+)\s*dB/i);
  const q = rest.match(/Q\s+([\d.]+)/i);
  const args = { type, f: f[1] };
  if (q) args.q = q[1];
  if (g && !GAINLESS.has(type)) args.g = g[1];
  return { stage: editedStage({ kind: "iir", args: {}, raw: undefined }, args) };
}

// parseEqText(text) -> { preamp: "-6.1" | null, stages: [iir stages], skipped: [reasons] }
export function parseEqText(text) {
  const stages = [];
  const skipped = [];
  let preamp = null;
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const pm = line.match(PREAMP_RE);
    if (pm) {
      preamp = pm[1];
      continue;
    }
    const fm = line.match(FILTER_RE);
    if (!fm) continue; // header / notes line — not a filter
    const parsed = parseFilterLine(line, fm);
    if (parsed.skip) skipped.push(parsed.skip);
    else stages.push(parsed.stage);
  }
  return { preamp, stages, skipped };
}
