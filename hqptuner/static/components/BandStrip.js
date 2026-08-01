// ── band strip: knob + slider + exact-box trios for the selected iir stage ───
// Docked under the matrix RESPONSE plot. First visual control for the width arg
// (Q/bw/s) — the dot drag only carries f/g. Streams through the same dragEq
// override and lands through the same pair-synced commit as the dot, so curve,
// dot, docked editor and strip stay in step by construction. biquad (raw
// coefficients) and non-iir stages keep the docked editor only.
import { signal } from "@preact/signals";
import { html } from "../lib/dom.js";
import { parseProcess, serializeProcess, IIR_TYPES } from "../lib/matrixspec.js";
import { clamp } from "../lib/coerce.js";
import { stagePipelines } from "../store/actions.js";
import { Knob } from "./Knob.js";

// Stage selection ({row, stage}) shared with the pipeline editor (it lives
// here, not in MatrixTab, so component imports stay one-way): the selected
// chip's dot renders highlighted, so the editor and the plot point at the same
// band.
export const selectedStage = signal(null);

// --- draggable EQ handles (peak/lshelf/hshelf stages of plotted rows) --------
// In-flight drag override: {row, stage, args}, client-only — an arg patch
// (strings, e.g. {f, g} from a dot drag or {q} from the band strip) merged into
// the plotted stage list so the curve tracks the gesture with zero server
// traffic; the release commits through stagePipelines like any pipeline edit.
export const dragEq = signal(null);

const stageKey = (s) => JSON.stringify({ kind: s.kind, args: s.args });
export const keyAt = (rows, row, stageIdx) => stageKey(parseProcess(rows[row].process)[stageIdx]);

// A byte-identical stage is ONE band rendered into many pipelines — a stereo
// pair, or every row of a crossfeed block (where the shared EQ sits at
// DIFFERENT indices behind the lp1/delay structural stages, so same-index
// matching cannot be the rule). A drag or commit therefore moves every
// byte-identical copy wherever it sits in whichever chain; anything not
// byte-identical is left alone. This keeps merged curves merged mid-drag and
// keeps a block's rows consistent — an index-based edit would silently
// dismantle it.
const patched = (stages, key, args) =>
  stages.map((s) => (stageKey(s) === key ? { ...s, args: { ...s.args, ...args }, raw: undefined } : s));

export function withDrag(rows, i) {
  const stages = parseProcess(rows[i].process);
  const d = dragEq.value;
  return d ? patched(stages, d.key, d.args) : stages;
}

// Release: rewrite the patched args on every byte-identical copy.
export function commitStage(rows, row, stageIdx, patch) {
  dragEq.value = null;
  const key = keyAt(rows, row, stageIdx);
  const next = rows.map((r) => {
    const stages = parseProcess(r.process);
    if (!stages.some((s) => stageKey(s) === key)) return r;
    return { ...r, process: serializeProcess(patched(stages, key, patch)) };
  });
  stagePipelines(next);
}

export const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

// Ranges are UI policy (hqplayerd documents the args, not their bounds): f
// spans the audio band, g matches the plot's ±24 dB ceiling, Q/bw/s cover the
// practical RBJ envelope; the docked editor still accepts anything outside
// them.
export const BAND_ARGS = {
  f: { name: "freq", min: 20, max: 20000, step: 1, unit: "Hz", scale: "log", round: Math.round },
  g: { name: "gain", min: -24, max: 24, step: 0.1, unit: "dB", round: r1 },
  q: { name: "Q", min: 0.1, max: 16, step: 0.01, scale: "log", round: r2 },
  bw: { name: "bandwidth", min: 0.05, max: 8, step: 0.01, unit: "oct", round: r2 },
  s: { name: "slope", min: 0.1, max: 2, step: 0.01, round: r2 },
};

// The stage the strip can edit, or null: an iir stage of the selection whose
// type schema carries at least one slider-able arg (biquad's raw coefficients
// don't qualify — those keep the docked text editor only).
function stripTarget(rows) {
  const sel = selectedStage.value;
  if (!sel || sel.row >= rows.length) return null;
  const st = withDrag(rows, sel.row)[sel.stage];
  if (!st || st.kind !== "iir") return null;
  const schema = IIR_TYPES[st.args.type];
  if (!schema) return null;
  const shown = [...schema.args, ...(schema.oneOf || [])].filter((a) => BAND_ARGS[a] && st.args[a] !== undefined);
  return shown.length ? { sel, st, shown } : null;
}

// Strip title: every pipeline carrying a byte-identical copy — the same rule
// commitStage moves copies by, so the name states what a commit will actually
// touch. "1+2" for a stereo pair; a block's shared EQ names the row count.
function stripName(rows, sel) {
  const mine = keyAt(rows, sel.row, sel.stage);
  const idxs = rows.flatMap((r, i) => (parseProcess(r.process).some((s) => stageKey(s) === mine) ? [i] : []));
  return idxs.length > 2 ? `${idxs.length} pipelines` : idxs.map((i) => i + 1).join("+");
}

// Three STANDING slots — freq | gain | width — the strip's geometry NEVER
// changes with the selection (a shape-shifting strip moves the page bottom and
// the scroll position under the user). The width slot shows whichever width
// arg the selection carries (q/bw/s); a slot whose arg the selection lacks —
// or every slot, with nothing selected — renders the same knob disabled at a
// neutral value.
const IDLE_VALS = { f: 1000, g: 0, q: 1, bw: 1, s: 1 };
const WIDTH_ARGS = ["q", "bw", "s"];

function slotArgs(t) {
  const width = t && WIDTH_ARGS.find((a) => t.shown.includes(a));
  return ["f", "g", width || "q"];
}

function BandKnob({ rows, t, a }) {
  const spec = BAND_ARGS[a];
  const live = !!(t && t.shown.includes(a));
  const v = live ? Number(t.st.args[a]) : IDLE_VALS[a];
  const patch = (nv) => {
    const n = Number(nv);
    return Number.isFinite(n) ? { [a]: String(spec.round(clamp(n, spec.min, spec.max))) } : null;
  };
  return html`
    <div class="band-arg">
      <span class="t-label">${spec.name}</span>
      <${Knob}
        value=${Number.isFinite(v) ? clamp(v, spec.min, spec.max) : spec.min}
        min=${spec.min}
        max=${spec.max}
        step=${spec.step}
        unit=${spec.unit}
        scale=${spec.scale}
        label=${spec.name}
        disabled=${!live}
        onLive=${
          live
            ? (nv) => {
                const p = patch(nv);
                if (p) dragEq.value = { key: keyAt(rows, t.sel.row, t.sel.stage), args: p };
              }
            : null
        }
        onCommit=${
          live
            ? (nv) => {
                const p = patch(nv);
                if (p) commitStage(rows, t.sel.row, t.sel.stage, p);
              }
            : null
        }
      />
    </div>
  `;
}

// STANDING, like the plot card above it — always rendered at full size, so the
// block is there before anything is selected. No editable selection -> the
// same knob trio, disabled, and a head line saying how to bind it. Never a
// vanished or collapsed block.
export function BandStrip({ rows }) {
  const t = stripTarget(rows);
  const head = t
    ? html`<div class="t-label mono">${stripName(rows, t.sel)} · ${t.st.args.type}</div>`
    : html`<div class="t-caption">No band selected — click a stage chip or a plot dot to edit it here.</div>`;
  return html`
    <div class="band-strip">
      ${head}
      <div class="band-slots">
        ${slotArgs(t).map(
          (a, i) => html`
            ${i ? html`<span class="col-rule"></span>` : null}
            <${BandKnob} rows=${rows} t=${t} a=${a} />
          `,
        )}
      </div>
    </div>
  `;
}
