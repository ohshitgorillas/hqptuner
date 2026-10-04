// The Range block's bar: Min, Startup and Max on one linear dBFS axis (lib/volume.js AXIS_MIN … AXIS_MAX), the span
// between the brackets filled as the range the engine will allow, the loudness bounds as parentheses over a strip for
// reference, the live playback needle, ticks every 10 dB to 0 with +12, numbers at −120 dB, −90, −60, −30, −3, 0 and
// +12, and heavy ticks at 0 (the limiter threshold) and −3 (the recommended ceiling when resampling).
//
// A press on the bar takes the nearest handle, Startup anywhere in the pin row above it, and a drag moves it through
// the clamp; the dragged value shows in a bubble. Nothing moves while the block is grayed. The bar draws at the width
// its box measures, in plate px.

import { useEffect, useRef, useState } from "preact/hooks";
import { html } from "../../../../lib/dom.js";
import { AXIS_MAX, AXIS_MIN } from "../../../../lib/volume.js";
import {
  barValueAt,
  barX,
  labelAnchor,
  pickVolumeHandle,
  tickMarks,
  ticksEvery,
} from "../../../../model/gauges/range-axis.js";
import { signed } from "../../../../model/shell/format.js";
import { plate } from "../../../../store/faceplate/view.js";
import { moveVolumeHandle, RANGE_KEYS } from "../../../../store/faceplate/drawers/volume.js";

/** @typedef {import("../../../../store/faceplate/drawers/volume.js").VolumeKey} VolumeKey */
/** @typedef {import("../../../../store/faceplate/drawers/volume.js").VolumeRangeView} VolumeRangeView */
/**
 * @typedef {{ clientX: number, clientY: number, pointerId: number,
 *   currentTarget: { getBoundingClientRect(): { left: number, top: number }, setPointerCapture(id: number): void } }} PressEv
 */

const AXIS = { min: AXIS_MIN, max: AXIS_MAX };
const PADX = 16; // track inset, room for the end labels
const Y = { pin: 3, bar: 30, barH: 14, tick: 56, label: 80, H: 86 };
const FIRST_W = 960; // px drawn at before the box is measured
const LABELS = new Map([
  [-120, "−120 dB"],
  [-90, "−90"],
  [-60, "−60"],
  [-30, "−30"],
  [-3, "−3"],
  [0, "0"],
  [AXIS.max, signed(AXIS.max)],
]);
const MARKS = tickMarks([...ticksEvery(AXIS.min, 0, 10), -3, AXIS.max], LABELS, [0, -3]);

/**
 * A Min or Max bracket, arms pointing in at the span (`dir` 1 for Min, −1 for Max).
 *
 * @param {{ k: VolumeKey, xx: number, dir: number, db: number, act: boolean }} props
 */
const Bracket = ({ k, xx, dir, db, act }) => {
  const by = Y.bar,
    arm = 6 * dir;
  return html`<path
    class=${act ? "brk act" : "brk"}
    data-mark=${RANGE_KEYS[k]}
    data-db=${db}
    d=${`M${xx + arm},${by - 5} H${xx} V${by + Y.barH + 5} H${xx + arm}`}
  />`;
};

/**
 * The Startup pin above the bar, grabbable at Min or Max.
 *
 * @param {{ px: number, db: number, act: boolean }} props
 */
const Pin = ({ px, db, act }) => {
  const t = Y.pin;
  return html`<path
    class=${act ? "pin act" : "pin"}
    data-mark=${RANGE_KEYS.startup}
    data-db=${db}
    d=${`M${px - 6},${t + 3} Q${px - 6},${t} ${px - 3},${t} H${px + 3} Q${px + 6},${t} ${px + 6},${t + 3} V${t + 14} L${px},${t + 21} L${px - 6},${t + 14} Z`}
  />`;
};

/**
 * A loudness bound's parenthesis, bowing in at the strip (`dir` 1 for the lower, −1 for the upper).
 *
 * @param {{ mark: string, xx: number, dir: number, db: number }} props
 */
const Paren = ({ mark, xx, dir, db }) => {
  const by = Y.bar,
    bow = 5 * dir;
  return html`<path
    class="paren"
    data-mark=${mark}
    data-db=${db}
    d=${`M${xx},${by - 7} Q${xx - bow},${by + Y.barH / 2} ${xx},${by + Y.barH + 7}`}
  />`;
};

/**
 * The loudness strip inside the bar and its parentheses.
 *
 * @param {{ x: (d: number) => number, low: number, high: number }} props
 */
const Loudness = ({ x, low, high }) => html`
  <rect class="lband" x=${x(low)} y=${Y.bar + Y.barH - 4} width=${x(high) - x(low)} height="3" />
  <${Paren} mark="loudness_range_low" xx=${x(low)} dir=${1} db=${low} />
  <${Paren} mark="loudness_range_high" xx=${x(high)} dir=${-1} db=${high} />
`;

/**
 * The live playback needle, a readout and never a handle.
 *
 * @param {{ xx: number, db: number }} props
 */
const Needle = ({ xx, db }) => html`
  <g class="needle" data-mark="needle" data-db=${db}>
    <line x1=${xx} x2=${xx} y1=${Y.bar - 3} y2=${Y.bar + Y.barH + 3} />
    <circle cx=${xx} cy=${Y.bar + Y.barH + 7} r="2.5" />
  </g>
`;

/**
 * The axis under the bar: its ticks and their numbers.
 *
 * @param {{ x: (d: number) => number }} props
 */
const Axis = ({ x }) => html`
  ${MARKS.map(
    ({ d, weight, len }) =>
      html`<line class=${`tk ${weight}`} x1=${x(d)} x2=${x(d)} y1=${Y.tick} y2=${Y.tick + len} />`,
  )}
  ${[...LABELS].map(([d, t]) => html`<text class="tl" x=${x(d)} y=${Y.label} text-anchor=${labelAnchor(d, AXIS)}>${t}</text>`)}
`;

/**
 * The width the bar's box measures, FIRST_W until it has been.
 *
 * @param {{ current: SVGSVGElement | null }} ref
 */
function useWidth(ref) {
  const [w, setW] = useState(FIRST_W);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0];
      if (box && box.contentRect.width > 0) setW(box.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/**
 * The bar in its well.
 *
 * @param {{ view: VolumeRangeView }} props
 */
export function RangeBar({ view }) {
  const ref = useRef(/** @type {SVGSVGElement | null} */ (null));
  const W = useWidth(ref);
  /** @type {[VolumeKey | null, (k: VolumeKey | null) => void]} */
  const [drag, setDrag] = useState(/** @type {VolumeKey | null} */ (null));
  const { cur, loud, level } = view;
  const x = barX(W, AXIS, PADX);
  /** The press's place on the bar in plate px. @param {PressEv} e */
  const place = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const s = plate.value.scale;
    return { v: barValueAt(W, AXIS, PADX, (e.clientX - r.left) / s), y: (e.clientY - r.top) / s };
  };
  const onPointerDown = (/** @type {PressEv} */ e) => {
    if (view.gray) return;
    const { v, y } = place(e);
    const k = pickVolumeHandle(v, y, cur, Y.bar - 2);
    setDrag(k);
    e.currentTarget.setPointerCapture(e.pointerId);
    moveVolumeHandle(k, v);
  };
  const onPointerMove = (/** @type {PressEv} */ e) => {
    if (drag) moveVolumeHandle(drag, place(e).v);
  };
  const end = () => setDrag(null);
  return html`
    <div class="vrwell">
      <svg
        class=${drag ? "vrbar drag" : "vrbar"}
        ref=${ref}
        role="img"
        aria-label="Volume range"
        viewBox=${`0 0 ${W} ${Y.H}`}
        width=${W}
        height=${Y.H}
        onPointerDown=${onPointerDown}
        onPointerMove=${onPointerMove}
        onPointerUp=${end}
        onPointerCancel=${end}
      >
        <rect class="trk" x=${PADX - 3} y=${Y.bar} width=${W - 2 * PADX + 6} height=${Y.barH} rx="3" />
        <rect class="span" x=${x(cur.min)} y=${Y.bar} width=${Math.max(0, x(cur.max) - x(cur.min))} height=${Y.barH} />
        ${loud && html`<${Loudness} x=${x} low=${loud.low} high=${loud.high} />`}
        <${Axis} x=${x} />
        ${level !== null && html`<${Needle} xx=${x(level)} db=${level} />`}
        <${Bracket} k="min" xx=${x(cur.min)} dir=${1} db=${cur.min} act=${drag === "min"} />
        <${Bracket} k="max" xx=${x(cur.max)} dir=${-1} db=${cur.max} act=${drag === "max"} />
        <${Pin} px=${x(cur.startup)} db=${cur.startup} act=${drag === "startup"} />
        ${
          drag &&
          html`<text class="bub" x=${x(cur[drag])} y=${Y.label} text-anchor="middle">${`${signed(cur[drag])} dBFS`}</text>`
        }
      </svg>
    </div>
  `;
}
