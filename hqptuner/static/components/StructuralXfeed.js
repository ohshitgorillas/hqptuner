// Structural crossfeed — the pieces that don't depend on the card's layout: the
// RESPONSE-card lens traces and the Pipelines badge. The card itself is separate.
//
// Traces show the CROSSFEED's own contribution, not "what reaches your ear". The
// compensation lens folds the EQ in because that block carries one shared chain;
// this block carries a chain per ear, so a single "what you hear" curve would
// have to pick an ear and would be wrong for the other. The EQ is already
// visible as the pipeline rows' own curves, so the crossfeed is plotted alone —
// which is also the thing the three controls actually move.
import { html } from "../lib/dom.js";
import { effectivePipelines } from "../store/state.js";
import { logFreqs } from "../lib/dsp.js";
import { midSideResponse, magDb } from "../lib/binaural.js";
import { structuralBlock, structuralParams } from "../lib/xfmode.js";

// Centre at the current setting, centre at λ=1 as a reference, and the side path.
// The side trace is the point of the whole design: it does not move when the
// centre control does, and seeing that is how a user knows the stereo effect is
// not being traded away for tone.
export function structuralLensTraces(rows, bounds) {
  const rec = structuralBlock(rows);
  if (!rec) return [];
  const p = structuralParams(rows);
  const freqs = logFreqs(20, 20000, 160);
  const mk = (fn) =>
    freqs.map((f) => {
      const db = fn(f);
      bounds.min = Math.min(bounds.min, db);
      bounds.max = Math.max(bounds.max, db);
      return [f, db];
    });
  const at = (lambda) => (f) => midSideResponse(f, { ...p, lambda });
  const literal = at(1);
  const current = at(p.lambda);
  const traces = [
    { points: mk((f) => magDb(current(f).mid)), kind: "xfm", label: `centre at ${Math.round(p.lambda * 100)}%` },
    { points: mk((f) => magDb(current(f).side)), kind: "xfs", label: "sides" },
  ];
  if (Math.abs(p.lambda - 1) > 1e-6) {
    traces.splice(1, 0, {
      points: mk((f) => magDb(literal(f).mid)),
      kind: "ghost",
      label: "centre, speakers at this angle",
    });
  }
  return traces;
}

// Badge on the Pipelines card, same convention as the compensation block: the
// rows stay literal and hand-editable, and an edit that breaks the pattern drops
// the badge rather than being blocked or rewritten.
export function StructuralBadge() {
  const rows = effectivePipelines.value;
  const rec = structuralBlock(rows);
  if (!rec) return null;
  return html`
    <div class="xfc-badge">
      ⇄ These 16 pipelines are the structural crossfeed — speakers at ±${rec.angle.toFixed(0)}°, ${(rec.headRadius * 100).toFixed(1)} cm head,
      centre character ${Math.round(rec.lambda * 100)}%
      ${rec.eqProcess.left !== rec.eqProcess.right ? html` · <span class="xfc-stale">per-ear EQ</span>` : ""}
    </div>
  `;
}
