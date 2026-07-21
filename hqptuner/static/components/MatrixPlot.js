// RESPONSE card (matrix-spec step 7): overlaid magnitude (solid, dB left axis)
// + phase (dashed, ±180° second axis) for every plot-toggled pipeline, log
// 20 Hz–20 kHz. Pure client math (store/dsp.js), recomputed per render off the
// staged pipeline signals — the plot tracks the stage editor live with no
// server round-trip. Convolution stages plot only when their IR was uploaded
// this session (registerIr); otherwise the row is marked partial.
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

export function togglePlotted(index) {
  const next = new Set(plottedRows.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  plottedRows.value = next;
}

export function MatrixPlot() {
  const rows = effectivePipelines.value;
  const plotted = [...plottedRows.value].filter((i) => i < rows.length).sort((a, b) => a - b);
  if (!plotted.length) return null;
  const freqs = logFreqs(20, 20000, 160);
  const traces = [];
  let dbMin = -6;
  let dbMax = 6;
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
      dbMin = Math.min(dbMin, r.db);
      dbMax = Math.max(dbMax, r.db);
    }
    anyPartial ||= partial;
    const hue = HUES[k % HUES.length];
    traces.push({ points: mag, kind: `mag ${hue}`, label: `${i + 1}${partial ? " ·part" : ""}` });
    traces.push({ points: ph, kind: `ph ${hue}`, label: `${i + 1} φ`, y2: true });
  });
  const caption =
    "magnitude solid (dB, left axis) · phase dashed (°, ±180)" +
    (anyPartial ? " · partial: a convolution stage has no preview — re-upload its file to plot it" : "");
  return html`
    <section class="card">
      <div class="card-head">Response</div>
      <div class="card-body">
        <${PlotFrame}
          traces=${traces}
          yMin=${Math.max(Math.floor(dbMin / 6) * 6, -36)}
          yMax=${Math.min(Math.ceil(dbMax / 6) * 6, 36)}
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
