// The page's Source section body: the Range column, the spectrum and one level bar per channel, stretched to the
// section's height; at 13″ each half carries its title and the bars their readings table, slim neither. Where there is
// no stream to draw, the line saying why sits in an empty glass well in the meter's place. The Range is a view, not a
// setting: it writes the page's own preference and nothing stages. What it renders holds still
// (store/faceplate/page/meter.js); the trace, the bars and the readings are painted into it each animation frame
// (sourcepaint.js), and the picked spectrum style onto the canvas over the trace (spectrumfx.js).

import { useEffect, useRef } from "preact/hooks";
import { html } from "../../../lib/dom.js";
import { classNames, minusText } from "../../../model/shell/format.js";
import { METER_NOTES as NOTES } from "../../../store/faceplate/drawers/source.js";
import { pageMeter } from "../../../store/faceplate/page/meter.js";
import { onMeterPaint } from "../../../store/meter/loop.js";
import { PAGE_RANGES, setPageRange } from "../../../store/ui/faceplate.js";
import { spectrumStyle } from "../../../store/ui/prefs.js";
import { specRamp } from "../tokencolours.js";
import { withXref } from "../Xref.js";
import { SH, SW, paintSourcePage } from "./sourcepaint.js";
import { fitCanvas, fxPainter } from "./spectrumfx.js";

/** @typedef {import("../../../store/faceplate/page/meter.js").PageMeterView} PageMeterView */
/** @typedef {import("./spectrumfx.js").FxColours} FxColours */
/** @typedef {ReturnType<typeof fxPainter>} FxPainter */
/** @typedef {{ current: HTMLCanvasElement | null }} CanvasRef */
/** @typedef {{ current: HTMLElement | null }} BoxRef */

const STEREO = 2;

/**
 * A fraction of an axis as a CSS percentage.
 *
 * @param {number} f
 */
const pct = (f) => `${(f * 100).toFixed(2)}%`;

/**
 * A dB tick's label: the unit on full scale, a true minus below it.
 *
 * @param {number} db
 */
const dbText = (db) => (db === 0 ? "0 dBFS" : minusText(db));

/**
 * A channel's name on its bar and in the readings table: L and R on a stereo source, numbered otherwise.
 *
 * @param {number} i
 * @param {number} count
 */
const channelName = (i, count) => (count === STEREO ? ["L", "R"][i] : String(i + 1));

/**
 * The dB scale down an edge: one label per tick at its fraction from the top, the end labels marked so the stylesheet
 * keeps them inside their track.
 *
 * @param {{ cls: string, db: PageMeterView["db"] }} props
 */
function DbScale({ cls, db }) {
  const last = db.length - 1;
  return html`
    <div class=${cls} aria-hidden="true">
      ${db.map(
        (t, i) =>
          html`<span style=${`top:${pct(t.at)}`} class=${classNames(i === 0 && "first", i === last && "last") || undefined}>
            ${dbText(t.db)}
          </span>`,
      )}
    </div>
  `;
}

/**
 * The frequency axis under the spectrum: kHz across from 0, the unit on the 0 tick, the source Nyquist on the right
 * edge.
 *
 * @param {{ freq: PageMeterView["freq"] }} props
 */
function FreqScale({ freq }) {
  return html`
    <div class="xaxis" aria-hidden="true">
      ${freq.ticks.map(
        (t) =>
          html`<span style=${`left:${pct(t.at)}`} class=${t.khz === 0 ? "first" : undefined}>
            ${t.khz ? String(t.khz) : "0 kHz"}
          </span>`,
      )}
      <span class="last" data-nyq style=${`left:${pct(freq.nyq.at)}`} title="Source Nyquist">${`${freq.nyq.khz} kHz`}</span>
    </div>
  `;
}

/**
 * The spectrum: its title at 13″, the dB scale beside a glass well holding the grid, the filled trace and the held
 * peaks under the effects canvas the picked style draws on, the frequency axis under it.
 *
 * @param {{ view: PageMeterView, plot: BoxRef, fx: CanvasRef }} props
 */
function Spectrum({ view, plot, fx }) {
  return html`
    <div class="sside">
      ${!view.slim && html`<div class="mhead"><b class="mt">Spectrum</b></div>`}
      <div class="sgrid1" data-style=${spectrumStyle.value}>
        <${DbScale} cls="gut gy" db=${view.db} />
        <div class="splot" ref=${plot}>
          <svg class="spectrum" viewBox=${`0 0 ${SW} ${SH}`} preserveAspectRatio="none" role="img" aria-label="Spectrum">
            <g class="sgridl">
              ${view.db.slice(1, -1).map((t) => html`<line class="gdb" x1="0" x2=${SW} y1=${t.at * SH} y2=${t.at * SH} />`)}
              ${view.freq.ticks.slice(1).map((t) => html`<line x1=${t.at * SW} x2=${t.at * SW} y1="0" y2=${SH} />`)}
            </g>
            <path class="sarea" />
            <path class="shold" />
            <path class="strace" />
          </svg>
          <canvas class="sfx" ref=${fx}></canvas>
        </div>
        <span></span>
        <${FreqScale} freq=${view.freq} />
      </div>
    </div>
  `;
}

/**
 * One channel's bar: the peak fill, the RMS bar inside it and the hold mark, all painted.
 *
 * @param {{ name: string }} props
 */
function Bar({ name }) {
  return html`
    <div class="lvb">
      <div class="trough">
        <i class="pk"></i>
        <i class="rm"></i>
        <i class="hd" style="visibility:hidden"></i>
      </div>
      <span class="lvn">${name}</span>
    </div>
  `;
}

/**
 * The levels: their title at 13″, the dB scale, one bar per channel and, at 13″, the readings table.
 *
 * @param {{ view: PageMeterView }} props
 */
function Levels({ view }) {
  const n = view.channels;
  const names = Array.from({ length: n }, (_, i) => channelName(i, n));
  return html`
    <div class="lside">
      ${!view.slim && html`<div class="mhead"><b class="mt">Levels</b></div>`}
      <div class="lvwrap">
        <${DbScale} cls="lvs" db=${view.db} />
        ${names.map((name) => html`<${Bar} name=${name} />`)}
        ${
          !view.slim &&
          html`
          <div class="lvtab">
            <span class="u">dBFS</span>
            ${names.map((name) => html`<span class="lvh">${name}</span>`)}
            <span class="lvh l">Peak</span>
            ${names.map(() => html`<span class="npk"></span>`)}
            <span class="lvh l">RMS</span>
            ${names.map(() => html`<span class="nrm"></span>`)}
          </div>
        `
        }
      </div>
    </div>
  `;
}

/**
 * The Range column: its label over the stacked switch, the page's range lit; tapping another writes it.
 *
 * @param {{ range: number }} props
 */
function RangeColumn({ range }) {
  return html`
    <div class="mrange">
      <div class="lbl"><span class="eng">Range</span><span class="u">dB</span></div>
      <div class="seg view vert" role="radiogroup" aria-label="Range, dB" data-testid="page-range">
        ${PAGE_RANGES.map((v) => {
          const on = v === String(range);
          return html`
            <button type="button" class=${on ? "on" : undefined} data-v=${v} onClick=${() => on || setPageRange(v)}>
              ${v}
            </button>
          `;
        })}
      </div>
    </div>
  `;
}

/**
 * The colours the effects canvas paints with, read from the tokens in force on `el`.
 *
 * @param {Element} el
 * @returns {FxColours}
 */
function fxColours(el) {
  const cs = getComputedStyle(el);
  return {
    lo: cs.getPropertyValue("--vis-lo").trim(),
    mid: cs.getPropertyValue("--vis-mid").trim(),
    hi: cs.getPropertyValue("--vis-hi").trim(),
    meter: cs.getPropertyValue("--meter").trim(),
    glass: cs.getPropertyValue("--glass").trim(),
    ramp: specRamp(cs),
  };
}

/**
 * A painter for the effects canvas while it is mounted, its backing size kept to the plot's box at the device's
 * pixel ratio; null while there is no canvas.
 *
 * @param {BoxRef} plot
 * @param {CanvasRef} fx
 * @param {boolean} live
 * @returns {{ current: FxPainter | null }}
 */
function useFxPainter(plot, fx, live) {
  const painter = useRef(/** @type {FxPainter | null} */ (null));
  useEffect(() => {
    const box = plot.current;
    const canvas = fx.current;
    if (!box || !canvas) return undefined;
    painter.current = fxPainter(canvas, fxColours(canvas));
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const size = fitCanvas(rect, devicePixelRatio);
      if (canvas.width !== size.width) canvas.width = size.width;
      if (canvas.height !== size.height) canvas.height = size.height;
    });
    ro.observe(box);
    return () => {
      ro.disconnect();
      painter.current = null;
    };
  }, [live]);
  return painter;
}

/**
 * Paint the meter loop's scenes into the section under `root` and onto the effects canvas while they are mounted, at
 * the Range in `range` and the picked spectrum style.
 *
 * @param {BoxRef} root
 * @param {{ current: number }} range
 * @param {{ current: FxPainter | null }} painter
 */
function useSourcePaint(root, range, painter) {
  useEffect(
    () =>
      onMeterPaint((scene) => {
        const style = spectrumStyle.value;
        if (root.current) paintSourcePage(root.current, scene, range.current, style);
        painter.current?.paint(scene.spectrum, range.current, style);
      }),
    [],
  );
}

/** The page's Source section body, or the line saying why there is no meter. */
export function SourceMeter() {
  const view = pageMeter();
  const root = useRef(/** @type {HTMLElement | null} */ (null));
  const plot = useRef(/** @type {HTMLElement | null} */ (null));
  const fx = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  const range = useRef(view.range);
  range.current = view.range;
  useSourcePaint(root, range, useFxPainter(plot, fx, view.state === "live"));
  if (view.state !== "live") {
    return html`
      <div class="pmeter" data-meter=${view.state}>
        <div class="mnone"><p>${withXref(NOTES[view.state], null)}</p></div>
      </div>
    `;
  }
  return html`
    <div class="pmeter" data-meter=${view.state} ref=${root}>
      <div class="mblk mtop">
        <${RangeColumn} range=${view.range} />
        <${Spectrum} view=${view} plot=${plot} fx=${fx} />
        <${Levels} view=${view} />
      </div>
    </div>
  `;
}
