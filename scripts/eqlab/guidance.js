// Guidance + confidence reporting. NOTHING here rejects, clamps, or rewrites a
// value.
//
// PRIMER.md:236/:242 — the ONE policy limit is +/-6.0 dB of gain change per
// turn. No +/-12 dB gain clamp and no Q 0.18-6.0 clamp (those describe
// AutoEq's envelope, not this project's), and a real session's root fault was
// fixed by widening a band to Q 0.70 — a move any
// clamp tight enough to feel safe would have blocked. So: report, never refuse.
//
// severity "confidence" entries are the two rig statements from
// PSYCHOACOUSTICS.md §5 only. They annotate how much precision narration has
// earned — never what the user perceives: no audibility language, and they
// never filter or rank a candidate.

import { round } from "./metrics.js";

const TURN_GAIN_DB = 6.0;
const Q_LOW = 0.18248;
const Q_HIGH = 6.0;
const Q_NARROW = 2.5; // SOURCES.md §2: Q >= 2.5 reserved for named narrowband complaints
const RESEAT_DB = 2.0; // TRANSDUCERS.md §3.1: reseat variance, 500 Hz-5 kHz
const RESEAT_RANGE = [500, 5000];
const QUALIFIED_HZ = 8000; // TRANSDUCERS.md §4: coupler qualified ceiling

const gainOf = (args) => Number(args.g ?? 0);
const fmt = (db) => `${db > 0 ? "+" : ""}${db.toFixed(2)}`;

// Every edit reduced to gain steps at a band: an amend is its gain delta, an
// append is the new band's gain, a removal is -g, a replacement's new bands
// count like appends. `args` is the band the step lands on (post-edit where one
// exists).
function stepsOf(edit) {
  if (edit.kind === "replace") {
    return [
      ...edit.removed.map((r) => ({
        where: `removed band at ${r.before.f} Hz`,
        args: r.before,
        delta: -gainOf(r.before),
      })),
      ...edit.added.map((a) => ({ where: `new band at ${a.after.f} Hz`, args: a.after, delta: gainOf(a.after) })),
    ];
  }
  const delta = edit.kind === "append" ? gainOf(edit.after) : gainOf(edit.after) - gainOf(edit.before);
  const where = edit.kind === "append" ? `new band at ${edit.after.f} Hz` : `band at ${edit.before.f} Hz`;
  return [{ where, args: edit.after, delta }];
}

function gainFlag({ where, delta }) {
  if (Math.abs(delta) <= TURN_GAIN_DB) return [];
  return [
    {
      severity: "policy",
      rule: "gain change per turn",
      detail: `${where}: ${fmt(delta)} dB exceeds the +/-${TURN_GAIN_DB} dB per-turn policy`,
    },
  ];
}

// Per-Q threshold floor on music (SOURCES.md §2: +/-1.5 dB at Q=1, +/-3 at
// Q=10, +/-5 at Q=50), interpolated in log Q, clamped at the measured ends.
function perQFloorDb(q) {
  const x = Math.log10(Math.min(Math.max(q, 1), 50));
  return x <= 1 ? 1.5 + 1.5 * x : 3 + (2 * (x - 1)) / (Math.log10(50) - 1);
}

// Narrow AND strong: the docs reserve Q >= 2.5 for named narrowband complaints,
// so a step past the per-Q floor at that width is deliberate surgery worth
// naming out loud.
function highQStepFlag({ where, args, delta }) {
  const q = Number(args.q);
  if (Number.isNaN(q) || q < Q_NARROW || Math.abs(delta) <= perQFloorDb(q)) return [];
  return [
    {
      severity: "guidance",
      rule: "high-Q large step",
      detail: `${where}: ${fmt(delta)} dB at q=${q} exceeds the +/-${perQFloorDb(q).toFixed(1)} dB per-Q floor for a band this narrow (guidance only)`,
    },
  ];
}

function confidenceFlags({ where, args, delta }) {
  const f = Number(args.f);
  const out = [];
  if (delta !== 0 && Math.abs(delta) < RESEAT_DB && f >= RESEAT_RANGE[0] && f <= RESEAT_RANGE[1]) {
    out.push({
      severity: "confidence",
      rule: "inside measurement reseat variance",
      detail: `${where}: a ${fmt(delta)} dB step sits inside the ~${RESEAT_DB} dB reseat variance of the measurement rig (500 Hz-5 kHz); the data under the baseline does not resolve it to that precision`,
    });
  }
  if (f > QUALIFIED_HZ) {
    out.push({
      severity: "confidence",
      rule: "above rig's qualified range",
      detail: `${where}: above ${QUALIFIED_HZ / 1000} kHz the measurement rig is outside its qualified range; the curve being corrected is not precisely known there`,
    });
  }
  return out;
}

function fitRangeFlag(edit) {
  if (edit.kind !== "replace" || !edit.fit_range || edit.fit_range[1] <= QUALIFIED_HZ) return [];
  return [
    {
      severity: "guidance",
      rule: "fitting above 8 kHz",
      detail: `replace fit_range [${edit.fit_range[0]}, ${edit.fit_range[1]}] Hz extends above ${QUALIFIED_HZ / 1000} kHz, where the measurement rig is outside its qualified range`,
    },
  ];
}

function qFlags(stages) {
  return stages
    .filter((s) => s.kind === "iir" && s.args.q !== undefined)
    .filter((s) => Number(s.args.q) < Q_LOW || Number(s.args.q) > Q_HIGH)
    .map((s) => ({
      severity: "guidance",
      rule: "Q outside AutoEq's starting range",
      detail: `band at ${s.args.f} Hz has q=${s.args.q}, outside ${Q_LOW}-${Q_HIGH} (guidance only, Q is deliberately unclamped)`,
    }));
}

/** Flag when the sub-20 Hz shelf asymptote raises the chain's true maximum. */
export function headroomFlags(preamp, preampFull) {
  if (round(preampFull, 2) === round(preamp, 2)) return [];
  return [
    {
      severity: "guidance",
      rule: "sub-20 Hz headroom",
      detail: `preamp_db_full ${round(preampFull, 2)} dB vs preamp_db ${round(preamp, 2)} dB — the chain's maximum sits below 20 Hz`,
    },
  ];
}

/** Flags for a change set and the chain it produced. Empty array = nothing to say. */
export function guidanceFlags(edits, stages) {
  const steps = (edits || []).flatMap(stepsOf);
  return [
    ...steps.flatMap(gainFlag),
    ...steps.flatMap(highQStepFlag),
    ...(edits || []).flatMap(fitRangeFlag),
    ...qFlags(stages),
    ...steps.flatMap(confidenceFlags),
  ];
}
