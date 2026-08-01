// Client-side SVG response plots for the post-processing cards. Every curve is
// recomputed here on each render — and effective() reads the live-override /
// staged / config signals, so a knob/slider drag repaints the plot instantly
// with no backend round-trip. The plot spans the full width of the card bottom.
//
// Visual convention (see css design tokens): a DASHED, muted trace is the
// *potential* (maximum / reference) response; a SOLID, accent trace is what is
// *actually applied* now. Traces are labelled at the right edge so the language
// is legible: crossfeed "direct" vs "cross-fed", loudness "max" vs "applied".

import { signal } from "@preact/signals";
import { html } from "../lib/dom.js";
import { effective, volume, setLive, edit } from "../store/state.js";
import { loudnessSide } from "../store/ui.js";
import { crossfeedMagDb, loudnessMagDb, shelfScale, F0, F1, bandFreqs } from "../lib/dsp.js";
import { clamp, num } from "../lib/coerce.js";
import { db as fmtLevel, dbOffset } from "../lib/units.js";

const W = 640;
const PADL = 34;
const PADR = 52; // room for the right-edge trace labels
const PADT = 16; // top band carries the y-axis unit labels
const PADB = 20;
const LOGSPAN = Math.log(F1 / F0);
const FREQ_LABELS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
// A vertical at EVERY labelled frequency. Three decade lines under ten labels
// left seven figures on the axis with nothing rising from them, so reading a
// feature's frequency off the plot meant eyeballing the gap between decades.
const FREQ_GRID = FREQ_LABELS;

const fmtHz = (f) => (f >= 1000 ? `${f / 1000}k` : `${f}`);
const xOf = (f) => PADL + (Math.log(f / F0) / LOGSPAN) * (W - PADL - PADR);

// Evenly-spaced hue per trace index: N traces => N hues 360/N apart, so any count
// stays maximally separated and auto-rebalances when a trace is added/removed —
// no fixed palette to exhaust. Fixed S/L keeps every hue legible on the dark bg.
// Opt-in via PlotFrame's `autoColor`; the 2-tone plots keep their kind-class CSS.
const hueOf = (i, n) => `hsl(${Math.round((i * 360) / Math.max(n, 1))}, 68%, 62%)`;

// In-flight handle-drag readout: {label, f0, db0, f, db} — the dragged handle's
// name, its values at pointerdown, and where it is now. Module-level because
// only one pointer drag can be live at a time; cleared on release. Written only
// from pointer handlers, so it is invisible to SSR tests by design (see
// docs/testing.md "Branches that cannot be reached") — the hand-back protocol
// covers it.
const dragHud = signal(null);
// The HUD keeps its own frequency and delta formatters rather than taking
// lib/units.js's. It updates under the pointer, and its text is centre-anchored,
// so a figure that loses a digit re-centres the whole line mid-drag — fixed
// decimals hold the width still. `hz()` trims trailing zeros by design, which is
// right for a chip you read once and wrong for a readout you watch move.
const fmtF = (f) => (f >= 1000 ? `${(f / 1000).toFixed(2)} kHz` : `${Math.round(f)} Hz`);
const fmtDeltaF = (df) => `${df >= 0 ? "+" : ""}${Math.round(df)} Hz`;

// Exported for the matrix RESPONSE card. Optional second y-axis (y2Min/y2Max):
// traces flagged `y2: true` (phase) map through it instead of the dB scale.
/**
 * @param {{
 *   traces: any[], yMin: number, yMax: number, dbStep: number, height: number,
 *   caption?: any, y2Min?: number, y2Max?: number, handles?: any[], autoColor?: boolean
 * }} props
 */
export function PlotFrame({ traces, yMin, yMax, dbStep, height, caption, y2Min, y2Max, handles, autoColor }) {
  const plotH = height - PADT - PADB;
  const yOf = (db) => PADT + (1 - (clamp(db, yMin, yMax) - yMin) / (yMax - yMin)) * plotH;
  const yOf2 = (v) => PADT + (1 - (clamp(v, y2Min, y2Max) - y2Min) / (y2Max - y2Min)) * plotH;
  const scaleOf = (t) => (t.y2 ? yOf2 : yOf);
  // draggable EQ handles: a dot at (f, db); a pointer drag streams (f, db) to
  // onDrag, then lands the release on onEnd. The drag is RELATIVE to the grab:
  // it baselines on the handle's own value and applies the pointer's axis-space
  // delta, so grabbing a dot slightly off-centre never teleports it under the
  // cursor — the dot holds still until the pointer actually moves.
  const startDrag = (h) => (e) => {
    if (h.onSelect) h.onSelect(); // grabbing a dot selects its band (docks strip + editor)
    const svg = e.target.ownerSVGElement;
    const rect = svg.getBoundingClientRect();
    const x0 = e.clientX;
    const y0 = e.clientY;
    // dB clamps to the handle's own policy range when it carries one — the
    // visible axis may be auto-scaled tighter than the legal value range, and
    // the viewport must never cap a drag (the axis regrows to follow).
    const dbLo = h.dbMin === undefined ? yMin : h.dbMin;
    const dbHi = h.dbMax === undefined ? yMax : h.dbMax;
    const at = { f: clamp(h.f, F0, F1), db: clamp(h.db, dbLo, dbHi) };
    const pt = (ev) => {
      const dx = (ev.clientX - x0) * (W / rect.width);
      const dy = (ev.clientY - y0) * (height / rect.height);
      return {
        f: clamp(at.f * Math.exp((dx / (W - PADL - PADR)) * LOGSPAN), F0, F1),
        db: clamp(at.db - (dy / plotH) * (yMax - yMin), dbLo, dbHi),
      };
    };
    dragHud.value = { label: h.label, f0: at.f, db0: at.db, ...at };
    // click slop: a real click carries a px or two of incidental travel, which
    // must neither nudge the value nor commit on release. Nothing engages until
    // the pointer clearly leaves the press point; a sub-slop release is a
    // selection click, full stop.
    let live = false;
    const move = (ev) => {
      if (!live && Math.abs(ev.clientX - x0) < 4 && Math.abs(ev.clientY - y0) < 4) return;
      live = true;
      const q = pt(ev);
      dragHud.value = { ...dragHud.value, f: q.f, db: q.db };
      h.onDrag(q.f, q.db);
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      dragHud.value = null;
      if (!live) return;
      const q = pt(ev);
      h.onEnd(q.f, q.db);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    e.preventDefault();
  };
  const poly = (pts, sc) => pts.map(([f, d]) => `${xOf(f).toFixed(1)},${sc(d).toFixed(1)}`).join(" ");
  const dbLines = [];
  for (let db = Math.ceil(yMin / dbStep) * dbStep; db <= yMax; db += dbStep) dbLines.push(db);
  // `ghost: true` traces (reference curves) keep their muted CSS look: the
  // autoColor hue cycle skips them, so a reference appearing never reshuffles
  // the row hues around it.
  const colorable = traces.filter((t) => !t.ghost).length;
  let ci = 0;
  const colors = traces.map((t) => (autoColor && !t.ghost ? hueOf(ci++, colorable) : null));
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
          (f) =>
            html`<line
              class="plot-grid"
              x1=${xOf(f).toFixed(1)}
              y1=${PADT}
              x2=${xOf(f).toFixed(1)}
              y2=${PADT + plotH}
            />`,
        )}
        ${FREQ_LABELS.map(
          (f) =>
            html`<text class="plot-lbl" x=${xOf(f).toFixed(1)} y=${height - 6} text-anchor="middle">${fmtHz(f)}</text>`,
        )}
        <text class="plot-lbl plot-axis" x=${PADL - 4} y="10" text-anchor="end">dB</text>
        <text class="plot-lbl plot-axis" x=${(xOf(F1) + 14).toFixed(1)} y=${height - 6}>Hz</text>
        ${y2Min !== undefined ? html`<text class="plot-lbl plot-axis" x=${W - PADR + 4} y="10">°</text>` : null}
        ${
          yMin < 0 && yMax > 0
            ? html`<line class="plot-zero" x1=${PADL} y1=${yOf(0).toFixed(1)} x2=${W - PADR} y2=${yOf(0).toFixed(1)} />`
            : null
        }
        ${traces.map(
          (t, i) =>
            html`<polyline
              class="plot-trace ${t.kind}"
              style=${colors[i] ? `stroke:${colors[i]}` : ""}
              points=${poly(t.points, scaleOf(t))}
            />`,
        )}
        ${(() => {
          // labels sit at their trace's endpoint y, but nudge apart when traces
          // converge at the right edge so they never stack on top of each other
          const gap = 11;
          const maxY = PADT + plotH;
          // right-aligned at the frame edge (long labels would clip the 52 px
          // margin); the CSS halo keeps them legible over the curve tails
          const items = traces.map((t, i) => {
            const [, d] = t.points[t.points.length - 1];
            return {
              x: W - 2,
              y: scaleOf(t)(d),
              text: t.label,
              kind: t.kind,
              color: colors[i],
            };
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
            (it) =>
              html`<text
                class="plot-tlbl ${it.kind}"
                style=${it.color ? `fill:${it.color}` : ""}
                x=${it.x.toFixed(1)}
                y=${it.y.toFixed(1)}
                text-anchor="end"
                >${it.text}</text
              >`,
          );
        })()}
        ${(handles || []).map(
          (h) => html`
            <circle
              class="plot-dot ${h.kind || ""} ${h.active ? "active" : ""}"
              cx=${xOf(clamp(h.f, F0, F1)).toFixed(1)}
              cy=${yOf(h.db).toFixed(1)}
              r=${h.active ? "9" : "7"}
              onPointerDown=${startDrag(h)}
            />
          `,
        )}
        ${(() => {
          // item 21: while a handle drags, quantify it — absolute (f, dB) plus
          // Δ from grab. Two lines pinned above the dot, x/y clamped inside the
          // frame so the readout never clips at an edge.
          const d = dragHud.value;
          if (!d) return null;
          const x = clamp(xOf(clamp(d.f, F0, F1)), PADL + 56, W - PADR - 56);
          const y1 = Math.max(yOf(d.db) - 26, PADT + 10);
          return html`
            <text class="plot-hud" x=${x.toFixed(1)} y=${y1.toFixed(1)} text-anchor="middle">
              <tspan x=${x.toFixed(1)}>${d.label ? `${d.label} · ` : ""}${fmtF(d.f)} · ${dbOffset(d.db, 1)}</tspan>
              <tspan x=${x.toFixed(1)} dy="12">Δ ${fmtDeltaF(d.f - d.f0)} · ${dbOffset(d.db - d.db0, 1)}</tspan>
            </text>
          `;
        })()}
      </svg>
      ${caption ? html`<div class="plot-caption mono">${caption}</div>` : null}
    </div>
  `;
}

export function CrossfeedPlot() {
  const fc = num(effective("crossfeed_frequency"), 700);
  const level = num(effective("crossfeed_level"), 4.5);
  const freqs = bandFreqs(128);
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
  const freqs = bandFreqs(160);
  const pct = Math.round(scale * 100);
  // REW-style drag handles at each band's (frequency, level) corner — dragging
  // streams live overrides (instant repaint) and stages both params on release.
  // Steepness/Q/type stay on their own controls.
  const r1 = (v) => Math.round(v * 10) / 10;
  const handle = (side, fk, lk, f, lvl, label) => ({
    f,
    db: lvl,
    label,
    // grabbing a dot points the Loudness strip at that dot's side
    onSelect: () => (loudnessSide.value = side),
    onDrag: (nf, ndb) => {
      setLive(fk, Math.round(nf));
      setLive(lk, r1(ndb));
    },
    onEnd: (nf, ndb) => {
      edit(fk, Math.round(nf));
      edit(lk, r1(ndb));
    },
  });
  return PlotFrame({
    traces: [
      { points: freqs.map((f) => [f, loudnessMagDb(p, f, LOUDNESS_FS, 1)]), kind: "ghost", label: "max", dy: -3 },
      {
        points: freqs.map((f) => [f, loudnessMagDb(p, f, LOUDNESS_FS, scale)]),
        kind: "applied",
        label: "applied",
        dy: 3,
      },
    ],
    yMin: -3,
    yMax: 24,
    dbStep: 6,
    height: 210,
    caption: `at ${fmtLevel(vol, 1)} volume: ${pct}% of maximum shelving applied`,
    handles: [
      handle("low", "loudness_low_freq", "loudness_low_level", p.lowFreq, p.lowLevel, "low shelf"),
      handle("high", "loudness_high_freq", "loudness_high_level", p.highFreq, p.highLevel, "high shelf"),
    ],
  });
}
