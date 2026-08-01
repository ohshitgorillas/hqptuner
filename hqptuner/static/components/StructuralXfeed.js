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
import { effectivePipelines } from "../store/resolve.js";
import { bandFreqs, chainResponse } from "../lib/dsp.js";
import { parseProcess } from "../lib/matrixspec.js";
import { midSideResponse, magDb } from "../lib/binaural.js";

const FS = 48000;
import { structuralBlock, structuralParams } from "../lib/xfmode.js";

// What centered sound and the sides actually get, EQ included.
//
// Bare crossfeed curves are wrong for the shared chart: a ~2 dB response next
// to a tuned headphone EQ reads as noise, and
// with the EQ hidden it reads as the whole picture. Folding the EQ in is what the
// compensation lens does, and why it works — the center shift shows as the gap
// between the EQ alone and the EQ heard through the crossfeed.
export function structuralLensTraces(rows, bounds) {
  const rec = structuralBlock(rows);
  if (!rec) return [];
  const p = structuralParams(rows);
  const freqs = bandFreqs(160);
  const mk = (fn) =>
    freqs.map((f) => {
      const db = fn(f);
      bounds.min = Math.min(bounds.min, db);
      bounds.max = Math.max(bounds.max, db);
      return [f, db];
    });
  const eqDb = (chain) => {
    const stages = parseProcess(chain);
    return (f) => (stages.length ? chainResponse(stages, f, FS).db : 0);
  };
  const symmetric = rec.eqProcess.left === rec.eqProcess.right;
  const ears = symmetric
    ? [["", rec.eqProcess.left]]
    : [
        [" left", rec.eqProcess.left],
        [" right", rec.eqProcess.right],
      ];
  const out = [];
  for (const [suffix, chain] of ears) {
    const eq = eqDb(chain);
    out.push({
      points: mk((f) => eq(f) + magDb(midSideResponse(f, { ...p, lambda: p.lambda }).mid)),
      kind: "xfm",
      label: `center${suffix} at ${Math.round(p.lambda * 100)}%`,
    });
    out.push({
      points: mk((f) => eq(f) + magDb(midSideResponse(f, { ...p, lambda: p.lambda }).side)),
      kind: "xfs",
      label: `sides${suffix}`,
    });
  }
  return out;
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
      ⇄ These 16 pipelines are the structural crossfeed — speakers at ±${rec.angle.toFixed(0)}°,
      ${(rec.headRadius * 100).toFixed(1)} cm head, center character ${Math.round(rec.lambda * 100)}%
      ${rec.eqProcess.left !== rec.eqProcess.right ? html` · <span class="xfc-stale">per-ear EQ</span>` : ""}
    </div>
  `;
}
