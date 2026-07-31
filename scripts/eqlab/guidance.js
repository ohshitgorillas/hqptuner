// Guidance reporting. NOTHING here rejects, clamps, or rewrites a value.
//
// PRIMER.md:236/:242 — the ONE policy limit is +/-6.0 dB of gain change per
// turn. The +/-12 dB gain clamp and the Q 0.18-6.0 clamp were removed on
// 2026-07-30 (they described AutoEq's envelope, not this project's), and a real
// session's root fault was fixed by widening a band to Q 0.70 — a move any
// clamp tight enough to feel safe would have blocked. So: report, never refuse.

const TURN_GAIN_DB = 6.0;
const Q_LOW = 0.18248;
const Q_HIGH = 6.0;

const gainOf = (args) => Number(args.g ?? 0);

function editFlags(edit) {
  const after = gainOf(edit.after);
  const delta = edit.kind === "append" ? after : after - gainOf(edit.before);
  if (Math.abs(delta) <= TURN_GAIN_DB) return [];
  const where = edit.kind === "append" ? `new band at ${edit.after.f} Hz` : `band at ${edit.before.f} Hz`;
  return [
    {
      severity: "policy",
      rule: "gain change per turn",
      detail: `${where}: ${delta > 0 ? "+" : ""}${delta.toFixed(2)} dB exceeds the +/-${TURN_GAIN_DB} dB per-turn policy`,
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

/** Flags for a change set and the chain it produced. Empty array = nothing to say. */
export function guidanceFlags(edits, stages) {
  return [...(edits || []).flatMap(editFlags), ...qFlags(stages)];
}
