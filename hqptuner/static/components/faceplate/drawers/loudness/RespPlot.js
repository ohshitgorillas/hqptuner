// The response plot of the matrix-family drawer blocks (Loudness, Crossfeed): log frequency 20 Hz to 20 kHz at true
// decade positions, linear dB, labels in a left gutter and a bottom band, on the page plot's glass (.eq). Each trace is
// named once at its right end, nudged apart where two would collide. Classes: none = amber (what you get), `ghost` =
// the reference, `side` = ink-2. Handles are draggable dots (v1 REW-style). Geometry from model/gauges/plot-axes.js;
// draws 1:1 at its box's size.

import { useRef, useState } from "preact/hooks";
import { html } from "../../../../lib/dom.js";
import { signed } from "../../../../model/shell/format.js";
import {
  GUTTER,
  PAD,
  levelGrid,
  plotGeometry,
  pointAt,
  round1 as r,
  tracePath,
} from "../../../../model/gauges/plot-axes.js";
import { pointerIn, useBox } from "./parts.js";
import { classNames } from "../../../../model/shell/format.js";

/** @typedef {import("../../../../model/gauges/plot-axes.js").PlotGeometry} PlotGeometry */
/** @typedef {import("../../../../model/gauges/plot-axes.js").LevelGrid} LevelGrid */
/** @typedef {{ fn: (f: number) => number, cls?: string, label?: string, id?: string }} Trace  dB at f; id as data-trace */
/**
 * One draggable dot.
 *
 * @typedef {object} Handle
 * @property {number} f
 * @property {number} db
 * @property {boolean} [off]  drawn, not draggable
 * @property {() => void} [onGrab]
 * @property {(f: number, db: number) => void} onDrag
 * @property {(f: number, db: number) => void} onEnd
 */
/** @typedef {{ lo: number, hi: number, step: number, minor?: number }} Scale */

const F_MIN = 20;
const F_MAX = 20000;
/** @param {number} f */
const hzLabel = (f) => (f >= 1000 ? `${f / 1000}k` : String(f));

/**
 * The grid behind the traces: decade lines and the lines between them, the level grid, the 0 dB line.
 *
 * @param {{ geo: PlotGeometry, grid: LevelGrid }} props
 */
function Grid({ geo, grid }) {
  const { x, y, lo, hi, x0, x1, yb } = geo;
  const v = (/** @type {number} */ f) => html`<line x1=${r(x(f))} y1=${PAD} x2=${r(x(f))} y2=${yb} />`;
  const h = (/** @type {number} */ d) => html`<line x1=${x0} y1=${r(y(d))} x2=${x1} y2=${r(y(d))} />`;
  return html`
    <g class="grid minor">${[50, 200, 500, 2000, 5000].map(v)} ${grid.roomy ? grid.minor.map(h) : null}</g>
    <g class="grid">${[100, 1000, 10000].map(v)} ${grid.major.map(h)}</g>
    ${lo < 0 && hi > 0 ? html`<line class="zero" x1=${x0} y1=${r(y(0))} x2=${x1} y2=${r(y(0))} />` : null}
  `;
}

/**
 * The axis labels: dB in the gutter, frequency in the band.
 *
 * @param {{ geo: PlotGeometry, grid: LevelGrid }} props
 */
function Labels({ geo, grid }) {
  const { x, y, H, x0, x1 } = geo;
  return html`
    <g class="lbl">
      ${grid.labels.map((d) => html`<text x=${GUTTER - 5} y=${r(y(d) + 3)} text-anchor="end">${signed(d, 0)}</text>`)}
      <text x=${GUTTER - 5} y=${H - 4} text-anchor="end">dB</text>
      <text x=${x0} y=${H - 4}>20 Hz</text>
      ${[100, 1000, 10000].map((f) => html`<text x=${r(x(f))} y=${H - 4} text-anchor="middle">${hzLabel(f)}</text>`)}
      <text x=${x1} y=${H - 4} text-anchor="end">20k</text>
    </g>
  `;
}

/**
 * The traces' names at their right ends, above their lines, nudged 11 px apart.
 *
 * @param {{ geo: PlotGeometry, traces: Trace[] }} props
 */
function TraceLabels({ geo, traces }) {
  const lab = traces
    .filter((t) => t.label)
    .map((t) => ({ t, yy: geo.y(t.fn(F_MAX * 0.82)) - 5 }))
    .sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < lab.length; i++) if (lab[i].yy - lab[i - 1].yy < 11) lab[i].yy = lab[i - 1].yy + 11;
  return html`
    <g class="tl">
      ${lab.map(
        ({ t, yy }) =>
          html`<text class=${t.cls} data-trace=${t.id} x=${geo.x1 - 2} y=${r(Math.max(PAD + 9, Math.min(geo.yb - 3, yy)))} text-anchor="end">
            ${t.label}
          </text>`,
      )}
    </g>
  `;
}

/**
 * A response plot filling its `.eq` box.
 *
 * @param {{ cls: string, aria: string, scale: Scale, traces: Trace[], handles?: Handle[] }} props
 */
export function RespPlot({ cls, aria, scale, traces, handles = [] }) {
  const [ref, box] = useBox({ W: 560, H: 200 });
  const drag = useRef(/** @type {number | null} */ (null));
  const [act, setAct] = useState(/** @type {number | null} */ (null));
  const geo = plotGeometry({ ...box, fMin: F_MIN, fMax: F_MAX, lo: scale.lo, hi: scale.hi });
  const grid = levelGrid(scale, geo.plotH, 12);
  const N = Math.max(160, Math.round(box.W / 2));
  /** @param {PointerEvent & { currentTarget: Element }} e */
  const at = (e) => pointAt(geo, ...pointerIn(e, box));
  /** @param {PointerEvent & { currentTarget: Element }} e */
  const end = (e) => {
    const i = drag.current;
    if (i === null) return;
    drag.current = null;
    setAct(null);
    handles[i]?.onEnd(...at(e));
  };
  /** @param {number} i @returns {(e: PointerEvent) => void} */
  const grab = (i) => (e) => {
    if (handles[i].off) return;
    drag.current = i;
    setAct(i);
    /** @type {Element} */ (e.currentTarget).closest("svg")?.setPointerCapture(e.pointerId);
    handles[i].onGrab?.();
  };
  const clampDb = (/** @type {number} */ d) => Math.max(scale.lo - 2, Math.min(scale.hi + 2, d));
  return html`
    <div class=${cls} ref=${ref}>
      <svg
        role="img"
        aria-label=${aria}
        width=${box.W}
        height=${box.H}
        viewBox="0 0 ${box.W} ${box.H}"
        onPointerMove=${(/** @type {PointerEvent & { currentTarget: Element }} */ e) =>
          drag.current === null ? undefined : handles[drag.current]?.onDrag(...at(e))}
        onPointerUp=${end}
        onPointerCancel=${end}
      >
        <${Grid} geo=${geo} grid=${grid} />
        ${traces.map(
          (t) => html`<path class=${`trace ${t.cls || ""}`} d=${tracePath(geo, N, (f) => clampDb(t.fn(f)))} />`,
        )}
        <${TraceLabels} geo=${geo} traces=${traces} />
        <${Labels} geo=${geo} grid=${grid} />
        ${handles.map(
          (hd, i) =>
            html`<circle
              class=${classNames("hdl", act === i && "act", hd.off && "off")}
              cx=${r(geo.x(hd.f))}
              cy=${r(geo.y(Math.max(scale.lo, Math.min(scale.hi, hd.db))))}
              r="6"
              onPointerDown=${grab(i)}
            />`,
        )}
      </svg>
    </div>
  `;
}
