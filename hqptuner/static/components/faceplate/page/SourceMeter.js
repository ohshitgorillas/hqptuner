// The page's Source section body: the spectrum with the Range control in its corner, and one level bar per channel,
// stretched to the section's height. At 13″ each half carries its title and the bars lie across a strip at the levels
// column's top with the VU pair (VuMeter.js) under it; the slim layout has no titles, and with the VU pick on it shows
// the VU pair where the bars stand. Where there is no stream to draw, the line saying why sits in an empty glass well
// in the meter's place.
// The Range is a view, not a setting: it writes the page's own preference and nothing stages. What it renders holds
// still (store/faceplate/page/meter.js); the trace, the bars and the needles are painted into it each animation frame
// (sourcepaint.js), and the picked spectrum style onto the canvases over the trace (spectrumfx.js, aurora.js).

import { useEffect, useRef } from "preact/hooks";
import { classNames, html } from "../../../lib/dom.js";
import { traceStops } from "../../../model/gauges/meter/spectrumfx.js";
import { minusText } from "../../../model/shell/format.js";
import { METER_NOTES as NOTES } from "../../../store/faceplate/drawers/source.js";
import { pageMeter } from "../../../store/faceplate/page/meter.js";
import { onMeterPaint } from "../../../store/meter/loop.js";
import { rangeButtons, setPageRange, spectrumColors, spectrumStyle } from "../../../store/ui/prefs.js";
import { accentInForce } from "../../../store/ui/theme.js";
import { withXref } from "../Xref.js";
import { auroraPainter } from "./aurora.js";
import { SH, SW, sourcePainter } from "./sourcepaint.js";
import { fitCanvas, fxPainter } from "./spectrumfx.js";
import { VuPair } from "./VuMeter.js";

/** @typedef {import("../../../store/faceplate/page/meter.js").PageMeterView} PageMeterView */
/** @typedef {import("./spectrumfx.js").FxColors} FxColors */
/** @typedef {import("./sourcepaint.js").SourceElements} SourceElements */
/** @typedef {{ current: HTMLCanvasElement | null }} CanvasRef */
/** @typedef {{ current: HTMLElement | null }} BoxRef */
/** @typedef {{ plot: BoxRef, fx: CanvasRef, sgl: CanvasRef }} CanvasRefs */
/** @typedef {Pick<SourceElements, "fx" | "aurora">} CanvasPainters */
/** @typedef {{ current: CanvasPainters | null }} CanvasPaintersRef */

const STEREO = 2;
const LEVEL_INK = "slevel"; // the id of the trace's gradient colored by level

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
 * A channel's name on its bar and its VU face: L and R on a stereo source, numbered otherwise.
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
 * The frequency axis under the spectrum: kHz across from 0, the unit on the 0 tick, the top of the view on the right
 * edge, titled as the source Nyquist where it is one.
 *
 * @param {{ freq: PageMeterView["freq"], edgeIsNyquist: boolean }} props
 */
function FreqScale({ freq, edgeIsNyquist }) {
  return html`
    <div class="xaxis" aria-hidden="true">
      ${freq.ticks.map(
        (t) =>
          html`<span style=${`left:${pct(t.at)}`} class=${t.khz === 0 ? "first" : undefined}>
            ${t.khz ? String(t.khz) : "0 kHz"}
          </span>`,
      )}
      <span class="last" data-nyq style=${`left:${pct(freq.nyq.at)}`} title=${edgeIsNyquist ? "Source Nyquist" : undefined}>${`${freq.nyq.khz} kHz`}</span>
    </div>
  `;
}

/**
 * One of the Range control's step buttons: it writes the Range `to`, and where there is none it shows dimmed and a tap
 * does nothing.
 *
 * @param {{ to: string | null, glyph: string, label: string, testid: string }} props
 */
function RangeStep({ to, glyph, label, testid }) {
  return html`
    <button
      class="round vbtn"
      type="button"
      aria-label=${label}
      aria-disabled=${to ? undefined : "true"}
      data-testid=${testid}
      onClick=${() => to && setPageRange(to)}
    >
      ${glyph}
    </button>
  `;
}

/**
 * The Range control in the spectrum's corner: a narrower and a wider step of the page's Range.
 *
 * @param {{ view: PageMeterView }} props
 */
function RangeControl({ view }) {
  return html`
    <div class="mzoom">
      <${RangeStep} to=${view.narrower} glyph="−" label="Narrower range" testid="range-narrower" />
      <${RangeStep} to=${view.wider} glyph="+" label="Wider range" testid="range-wider" />
    </div>
  `;
}

/**
 * The trace's filled area, its slower-falling shadow and its line, all drawn through one gradient up the plot: colored
 * by level under a color suite, solid in the accent in force under Accent.
 *
 * @param {{ suite: string }} props
 */
function TraceInk({ suite }) {
  const stops = traceStops(suite, accentInForce());
  return html`
    <defs>
      <linearGradient id=${LEVEL_INK} gradientUnits="userSpaceOnUse" x1="0" y1=${SH} x2="0" y2="0">
        ${stops.map(([at, color]) => html`<stop offset=${at} stop-color=${color} />`)}
      </linearGradient>
    </defs>
    <path class="sarea" style=${`fill:url(#${LEVEL_INK})`} />
    <path class="shold" style=${`stroke:url(#${LEVEL_INK})`} />
    <path class="strace" style=${`stroke:url(#${LEVEL_INK})`} />
  `;
}

/**
 * The spectrum: its title at 13″, the dB scale beside a glass well holding the grid, the filled trace and its shadow
 * under the effects canvas and the shader canvas the picked style draws on, the Range control in its corner while the
 * Range buttons are shown, the frequency axis under it.
 *
 * @param {{ view: PageMeterView, plot: BoxRef, fx: CanvasRef, sgl: CanvasRef }} props
 */
function Spectrum({ view, plot, fx, sgl }) {
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
            <${TraceInk} suite=${spectrumColors.value} />
          </svg>
          <canvas class="sfx" ref=${fx}></canvas>
          <canvas class="sgl" ref=${sgl}></canvas>
          ${rangeButtons.value && html`<${RangeControl} view=${view} />`}
        </div>
        <span></span>
        <${FreqScale} freq=${view.freq} edgeIsNyquist=${view.edgeIsNyquist} />
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
 * The levels column: at 13″ its title; the level bars and the VU pair under them, each where the view shows it.
 *
 * @param {{ view: PageMeterView }} props
 */
function Levels({ view }) {
  const n = view.channels;
  const names = Array.from({ length: n }, (_, i) => channelName(i, n));
  return html`
    <div class="lside">
      ${!view.slim && html`<div class="mhead"><b class="mt">Levels</b></div>`}
      ${view.shown.levels && html`<${Bars} view=${view} names=${names} />`}
      ${view.shown.vu && html`<${VuPair} />`}
    </div>
  `;
}

/**
 * The level bars: the dB scale and one bar per channel. Slim they stand upright; at 13″ they sit in a strip the
 * stylesheet lays across, with `--lv-n` giving the number of bars that sets its height.
 *
 * @param {{ view: PageMeterView, names: string[] }} props
 */
function Bars({ view, names }) {
  const bars = html`
    <div class="lvwrap">
      <${DbScale} cls="lvs" db=${view.levels} />
      ${names.map((name) => html`<${Bar} name=${name} />`)}
    </div>
  `;
  return view.slim ? bars : html`<div class="lvstrip" style=${`--lv-n:${names.length}`}>${bars}</div>`;
}

/**
 * The colors the effects canvas paints with, read from the tokens in force on `el`.
 *
 * @param {Element} el
 * @returns {FxColors}
 */
function fxColors(el) {
  const cs = getComputedStyle(el);
  return { glass: cs.getPropertyValue("--glass").trim() };
}

/**
 * Size `canvas`'s backing store to `size`, leaving a matching side alone so the canvas keeps what it holds.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ width: number, height: number }} size
 */
function fit(canvas, size) {
  if (canvas.width !== size.width) canvas.width = size.width;
  if (canvas.height !== size.height) canvas.height = size.height;
}

/**
 * A canvas of `width` by `height` off the page, for a painter's own drawing in 2D.
 *
 * @param {number} width
 * @param {number} height
 */
function offPage(width, height) {
  const canvas = new OffscreenCanvas(width, height);
  return { width, height, getContext: () => canvas.getContext("2d") };
}

/**
 * The elements of `kind` under `root`, in order.
 *
 * @param {Element} root
 * @param {string} kind
 * @returns {HTMLElement[]}
 */
const all = (root, kind) => Array.from(root.querySelectorAll(kind));

/**
 * The section's elements under `root`, found once, with the canvas painters `canvases`; null where the trace is not
 * mounted.
 *
 * @param {Element} root
 * @param {CanvasPainters} canvases
 * @returns {SourceElements | null}
 */
function sectionElements(root, canvases) {
  const area = root.querySelector(".sarea");
  const shadow = root.querySelector(".shold");
  const trace = root.querySelector(".strace");
  if (!area || !shadow || !trace) return null;
  return {
    peaks: all(root, ".lvb .pk"),
    rmses: all(root, ".lvb .rm"),
    holds: all(root, ".lvb .hd"),
    needles: all(root, ".vun"),
    area,
    shadow,
    trace,
    fx: canvases.fx,
    aurora: canvases.aurora,
  };
}

/**
 * While the spectrum's canvases are mounted, one painter on each, made when they mount and kept until they unmount
 * whatever else the section renders meanwhile, and both canvases' backing size kept to the plot's box at the device's
 * pixel ratio. The canvases mount with the live meter, `live`. The aurora painter is null where the page has no WebGL2.
 *
 * @param {CanvasRefs} refs
 * @param {boolean} live
 * @returns {CanvasPaintersRef}
 */
function useCanvasPainters({ plot, fx, sgl }, live) {
  const painters = useRef(/** @type {CanvasPainters | null} */ (null));
  useEffect(() => {
    const box = plot.current;
    const canvas = fx.current;
    const glCanvas = sgl.current;
    if (!box || !canvas || !glCanvas) return undefined;
    painters.current = {
      fx: fxPainter(canvas, fxColors(canvas), { random: Math.random, makeCanvas: offPage }),
      aurora: auroraPainter(glCanvas),
    };
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const size = fitCanvas(rect, devicePixelRatio);
      fit(canvas, size);
      fit(glCanvas, size);
    });
    ro.observe(box);
    return () => {
      ro.disconnect();
      painters.current = null;
    };
  }, [live]);
  return painters;
}

/**
 * While the section under `root` is mounted, one source painter on its elements and the canvas painters `canvases`
 * holds, made when they mount and fed every meter-loop paint. `mounted` names the set of elements rendered: a new set
 * makes a new source painter on the same canvas painters.
 *
 * @param {BoxRef} root
 * @param {CanvasPaintersRef} canvases
 * @param {string} mounted
 */
function useSourcePainter(root, canvases, mounted) {
  useEffect(() => {
    const section = root.current;
    const held = canvases.current;
    if (!section || !held) return undefined;
    const els = sectionElements(section, held);
    if (!els) return undefined;
    const painter = sourcePainter(els);
    return onMeterPaint((scene, dt) => painter.paint(scene, { dt }));
  }, [mounted]);
}

/**
 * The set of elements the section renders under `view`, as one name.
 *
 * @param {PageMeterView} view
 */
const mountedSet = (view) => [view.state, view.channels, view.slim, view.shown.levels, view.shown.vu].join(" ");

/** The page's Source section body, or the line saying why there is no meter. */
export function SourceMeter() {
  const view = pageMeter();
  const root = useRef(/** @type {HTMLElement | null} */ (null));
  const plot = useRef(/** @type {HTMLElement | null} */ (null));
  const fx = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  const sgl = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  const canvases = useCanvasPainters({ plot, fx, sgl }, view.state === "live");
  useSourcePainter(root, canvases, mountedSet(view));
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
        <${Spectrum} view=${view} plot=${plot} fx=${fx} sgl=${sgl} />
        <${Levels} view=${view} />
      </div>
    </div>
  `;
}
