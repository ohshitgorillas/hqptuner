// Client-side SVG response plots for the post-processing cards. Every curve is
// recomputed here on each render — and effective() reads the live-override /
// staged / config signals, so a knob/slider drag repaints the plot instantly
// with no backend round-trip. The plot spans the full width of the card bottom.
//
// Visual convention (see css design tokens): a DASHED, muted trace is the
// *potential* (maximum / reference) response; a SOLID, accent trace is what is
// *actually applied* now. Traces are labelled at the right edge so the language
// is legible: crossfeed "direct" vs "cross-fed", loudness "max" vs "applied".

import { html } from "../store/dom.js";
import { effective, volume } from "../store/state.js";
import { logFreqs, crossfeedMagDb, loudnessMagDb, shelfScale } from "../store/dsp.js";

const W = 640;
const PADL = 34;
const PADR = 52; // room for the right-edge trace labels
const PADT = 10;
const PADB = 20;
const F0 = 20;
const F1 = 20000;
const LOGSPAN = Math.log(F1 / F0);
const FREQ_LABELS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const FREQ_GRID = [100, 1000, 10000]; // fewer, quieter vertical lines than labels

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmtHz = (f) => (f >= 1000 ? `${f / 1000}k` : `${f}`);
const xOf = (f) => PADL + (Math.log(f / F0) / LOGSPAN) * (W - PADL - PADR);

function PlotFrame({ traces, yMin, yMax, dbStep, height, caption }) {
  const plotH = height - PADT - PADB;
  const yOf = (db) => PADT + (1 - (clamp(db, yMin, yMax) - yMin) / (yMax - yMin)) * plotH;
  const poly = (pts) => pts.map(([f, d]) => `${xOf(f).toFixed(1)},${yOf(d).toFixed(1)}`).join(" ");
  const dbLines = [];
  for (let db = Math.ceil(yMin / dbStep) * dbStep; db <= yMax; db += dbStep) dbLines.push(db);
  return html`
    <div class="plot">
      <svg viewBox="0 0 ${W} ${height}" class="plot-svg">
        ${dbLines.map(
          (db) => html`
            <line class="plot-grid" x1=${PADL} y1=${yOf(db).toFixed(1)} x2=${W - PADR} y2=${yOf(db).toFixed(1)} />
            <text class="plot-lbl" x=${PADL - 4} y=${(yOf(db) + 2.5).toFixed(1)} text-anchor="end">${db}</text>
          `,
        )}
        ${FREQ_GRID.map(
          (f) => html`<line class="plot-grid" x1=${xOf(f).toFixed(1)} y1=${PADT} x2=${xOf(f).toFixed(1)} y2=${PADT + plotH} />`,
        )}
        ${FREQ_LABELS.map(
          (f) => html`<text class="plot-lbl" x=${xOf(f).toFixed(1)} y=${height - 6} text-anchor="middle">${fmtHz(f)}</text>`,
        )}
        ${yMin < 0 && yMax > 0
          ? html`<line class="plot-zero" x1=${PADL} y1=${yOf(0).toFixed(1)} x2=${W - PADR} y2=${yOf(0).toFixed(1)} />`
          : null}
        ${traces.map((t) => html`<polyline class="plot-trace ${t.kind}" points=${poly(t.points)} />`)}
        ${(() => {
          // labels sit at their trace's endpoint y, but nudge apart when traces
          // converge at the right edge so they never stack on top of each other
          const gap = 11;
          const maxY = PADT + plotH;
          const items = traces.map((t) => {
            const [f, d] = t.points[t.points.length - 1];
            return { x: xOf(f) + 4, y: yOf(d), text: t.label, kind: t.kind };
          });
          items.sort((a, b) => a.y - b.y);
          for (let i = 1; i < items.length; i += 1) {
            if (items[i].y - items[i - 1].y < gap) items[i].y = items[i - 1].y + gap;
          }
          for (let i = items.length - 1; i > 0; i -= 1) {
            if (items[i].y > maxY) items[i].y = maxY;
            if (items[i].y - items[i - 1].y < gap) items[i - 1].y = items[i].y - gap;
          }
          return items.map(
            (it) => html`<text class="plot-tlbl ${it.kind}" x=${it.x.toFixed(1)} y=${it.y.toFixed(1)}>${it.text}</text>`,
          );
        })()}
      </svg>
      ${caption ? html`<div class="plot-caption mono">${caption}</div>` : null}
    </div>
  `;
}

export function CrossfeedPlot() {
  const fc = num(effective("crossfeed_frequency"), 700);
  const level = num(effective("crossfeed_level"), 4.5);
  const freqs = logFreqs(F0, F1, 128);
  return PlotFrame({
    traces: [
      { points: freqs.map((f) => [f, 0]), kind: "ghost", label: "direct", dy: -3 },
      { points: freqs.map((f) => [f, crossfeedMagDb(f, fc, level)]), kind: "applied", label: "cross-fed", dy: 3 },
    ],
    yMin: -24,
    yMax: 0,
    dbStep: 6,
    height: 190,
  });
}

// Loudness runs at the output rate; the digital-biquad shape is near rate-
// independent across 20 Hz–20 kHz once the rate is well above audio, so a fixed
// 48 kHz reference is used (validated offline against exact RBJ coefficients).
const LOUDNESS_FS = 48000;

export function LoudnessPlot() {
  const p = {
    lowType: effective("loudness_low_type"),
    lowFreq: num(effective("loudness_low_freq"), 80),
    lowLevel: num(effective("loudness_low_level"), 0),
    lowSteep: num(effective("loudness_low_steep"), 0.5),
    highType: effective("loudness_high_type"),
    highFreq: num(effective("loudness_high_freq"), 5000),
    highLevel: num(effective("loudness_high_level"), 0),
    highSteep: num(effective("loudness_high_steep"), 1),
  };
  const rangeLow = num(effective("loudness_range_low"), -60);
  const rangeHigh = num(effective("loudness_range_high"), -20);
  const vol = num(volume.value, rangeHigh);
  const scale = shelfScale(vol, rangeLow, rangeHigh);
  const freqs = logFreqs(F0, F1, 160);
  const pct = Math.round(scale * 100);
  return PlotFrame({
    traces: [
      { points: freqs.map((f) => [f, loudnessMagDb(p, f, LOUDNESS_FS, 1)]), kind: "ghost", label: "max", dy: -3 },
      { points: freqs.map((f) => [f, loudnessMagDb(p, f, LOUDNESS_FS, scale)]), kind: "applied", label: "applied", dy: 3 },
    ],
    yMin: -3,
    yMax: 24,
    dbStep: 6,
    height: 210,
    caption: `at ${vol.toFixed(1)} dB volume: ${pct}% of maximum shelving applied`,
  });
}
