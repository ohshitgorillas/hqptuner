// RESPONSE card (matrix-spec step 7 + AutoEq library pass): a STANDING card at
// the section bottom, always rendered like the crossfeed/loudness graphs. With
// nothing to plot it shows axes + an empty-state caption. Overlaid magnitude
// (solid, dB left axis) + phase (dashed, ±180° second axis) for every
// plot-toggled pipeline, log 20 Hz–20 kHz; a library-picker preview overlays as
// a dashed accent magnitude trace so candidate-vs-current is a visual A/B.
// Pure client math (store/dsp.js), recomputed per render off the staged
// pipeline signals — no server round-trip. Convolution stages plot only when
// their IR was uploaded this session (registerIr); otherwise marked partial.
import { signal } from "@preact/signals";
import { html } from "../store/dom.js";
import { effectivePipelines } from "../store/state.js";
import { parseProcess } from "../store/matrixspec.js";
import { chainResponse, logFreqs } from "../store/dsp.js";
import { PlotFrame } from "./plots.js";

// Same fixed audio-band reference rate as the loudness plot: the digital-biquad
// shape across 20 Hz–20 kHz is near rate-independent once fs is well above audio.
const FS = 48000;
const HUES = ["r0", "r1", "r2", "r3"];

export const plottedRows = signal(new Set());
// Library-picker preview: { label, stages } or null. Set by MatrixLibrary on
// selection, cleared on deselect/panel close — never touches pipeline state.
export const previewEq = signal(null);

export function togglePlotted(index) {
  const next = new Set(plottedRows.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  plottedRows.value = next;
}

function rowTraces(rows, plotted, bounds) {
  const freqs = logFreqs(20, 20000, 160);
  const traces = [];
  let anyPartial = false;
  plotted.forEach((i, k) => {
    const stages = parseProcess(rows[i].process);
    const mag = [];
    const ph = [];
    let partial = false;
    for (const f of freqs) {
      const r = chainResponse(stages, f, FS);
      mag.push([f, r.db]);
      ph.push([f, r.deg]);
      partial ||= r.partial;
      bounds.min = Math.min(bounds.min, r.db);
      bounds.max = Math.max(bounds.max, r.db);
    }
    anyPartial ||= partial;
    const hue = HUES[k % HUES.length];
    traces.push({ points: mag, kind: `mag ${hue}`, label: `${i + 1}${partial ? " ·part" : ""}` });
    traces.push({ points: ph, kind: `ph ${hue}`, label: `${i + 1} φ`, y2: true });
  });
  return { traces, anyPartial };
}

function previewTrace(preview, bounds) {
  const freqs = logFreqs(20, 20000, 160);
  const mag = [];
  for (const f of freqs) {
    const r = chainResponse(preview.stages, f, FS);
    mag.push([f, r.db]);
    bounds.min = Math.min(bounds.min, r.db);
    bounds.max = Math.max(bounds.max, r.db);
  }
  return { points: mag, kind: "mag prev", label: "preview" };
}

export function MatrixPlot() {
  const rows = effectivePipelines.value;
  const plotted = [...plottedRows.value].filter((i) => i < rows.length).sort((a, b) => a - b);
  const preview = previewEq.value;
  const bounds = { min: -6, max: 6 };
  const { traces, anyPartial } = rowTraces(rows, plotted, bounds);
  if (preview) traces.push(previewTrace(preview, bounds));
  const caption = traces.length
    ? "magnitude solid (dB, left axis) · phase dashed (°, ±180)" +
      (preview ? ` · preview dashed: ${preview.label}` : "") +
      (anyPartial ? " · partial: a convolution stage has no preview — re-upload its file to plot it" : "")
    : "Toggle ◉ on a pipeline to plot its response";
  return html`
    <section class="card">
      <div class="card-head">Response</div>
      <div class="card-body">
        <${PlotFrame}
          traces=${traces}
          yMin=${Math.max(Math.floor(bounds.min / 6) * 6, -36)}
          yMax=${Math.min(Math.ceil(bounds.max / 6) * 6, 36)}
          dbStep=${6}
          height=${240}
          y2Min=${-180}
          y2Max=${180}
          caption=${caption}
        />
      </div>
    </section>
  `;
}
