// The Loudness drawer's range bar: both bounds on their own −120 … 0 dBFS axis as parentheses over a strip (the Volume
// range bar's glyphs, amber here: they are this drawer's settings), the live playback volume as the green needle, the
// bound being dragged named in a bubble, and under the bar each bound's box with its manual line. Press anywhere to
// take the nearer bound. Marks and clamps are store/faceplate/drawers/loudness.js's; geometry is the lifted
// model/gauges/range-axis.js.

import { html } from "../../../../lib/dom.js";
import { signed } from "../../../../model/shell/format.js";
import {
  barValueAt,
  barX,
  labelAnchor,
  pickBound,
  tickMarks,
  ticksEvery,
} from "../../../../model/gauges/range-axis.js";
import { schema as catalog } from "../../../../store/schema.js";
import { describe } from "../../../../store/prose.js";
import { AXIS, dropBound, loudnessBar, moveBound, typeBound } from "../../../../store/faceplate/drawers/loudness.js";
import { pointerIn, useBox } from "./parts.js";

/** @typedef {import("../../../../store/faceplate/drawers/loudness.js").Side} Side */
/** @typedef {PointerEvent & { currentTarget: Element }} BarEvent */

const PAD_X = 14;
const Y = { bar: 10, barH: 14, tick: 33, label: 54, H: 59 };
const LABELS = new Map([
  [-120, "−120"],
  [-90, "−90"],
  [-60, "−60"],
  [-30, "−30"],
  [0, "0 dBFS"],
]);
const MARKS = tickMarks(ticksEvery(AXIS.min, AXIS.max, 10), LABELS, []);

/** The key glyphs beside the boxes, named where each mark is typed. */
const GLYPH = {
  lparen: html`<path class="paren" d="M9,1 Q3,9 9,17" />`,
  rparen: html`<path class="paren" d="M5,1 Q11,9 5,17" />`,
  needle: html`<line class="nl" x1="7" x2="7" y1="1" y2="13" /><circle class="nd" cx="7" cy="15.5" r="2" />`,
};

/** @param {{ kind: keyof typeof GLYPH }} props */
const Key = ({ kind }) =>
  html`<svg class="vrkey" viewBox="0 0 14 18" width="14" height="18" aria-hidden="true">${GLYPH[kind]}</svg>`;

/**
 * The bar's drawing at width `W`.
 *
 * @param {{ W: number, m: import("../../../../store/faceplate/drawers/loudness.js").LoudnessBar }} props
 */
function Marks({ W, m }) {
  const x = barX(W, AXIS, PAD_X);
  const { bar: by, barH: bh } = Y;
  const parenOf = (/** @type {Side} */ k, /** @type {number} */ dir) => {
    const xx = x(m[k]);
    const bow = 5 * dir;
    return html`<path
      class=${`paren ${m.active === k ? "act" : ""}`}
      d="M${xx},${by - 7} Q${xx - bow},${by + bh / 2} ${xx},${by + bh + 7}"
    />`;
  };
  return html`
    <rect class="trk" x=${PAD_X - 3} y=${by} width=${W - 2 * PAD_X + 6} height=${bh} rx="3" />
    <rect class="lspan" x=${x(m.low)} y=${by} width=${Math.max(0, x(m.high) - x(m.low))} height=${bh} />
    ${MARKS.map(
      ({ d, weight, len }) =>
        html`<line class=${`tk ${weight === "minor" ? "" : weight}`} x1=${x(d)} x2=${x(d)} y1=${Y.tick} y2=${Y.tick + len} />`,
    )}
    ${[...LABELS].map(
      ([d, t]) => html`<text class="tl" x=${x(d)} y=${Y.label} text-anchor=${labelAnchor(d, AXIS)}>${t}</text>`,
    )}
    ${
      m.needle === null
        ? null
        : html`<g class="needle">
          <line x1=${x(m.needle)} x2=${x(m.needle)} y1=${by - 3} y2=${by + bh + 3} />
          <circle cx=${x(m.needle)} cy=${by + bh + 7} r="2.5" />
        </g>`
    }
    ${parenOf("low", 1)} ${parenOf("high", -1)}
    ${
      m.active
        ? html`<text class="bub" x=${x(m[m.active])} y=${Y.label} text-anchor="middle">${signed(m[m.active], 0)} dBFS</text>`
        : null
    }
  `;
}

/**
 * One bound's box: its glyph and name, the whole-dB number, the unit, and its manual line under it.
 *
 * @param {{ k: Side, value: number, other: number, disabled: boolean }} props
 */
function Bound({ k, value, other, disabled }) {
  const key = `loudness_range_${k}`;
  const entry = catalog[key];
  return html`
    <div class="lbound">
      <label class="vrbox">
        <${Key} kind=${k === "low" ? "lparen" : "rparen"} />
        <span class="cl">${k === "low" ? "Lower" : "Upper"}</span>
        <input
          type="number"
          class="vfd"
          data-k=${key}
          step="1"
          min=${k === "low" ? AXIS.min : other}
          max=${k === "low" ? other : AXIS.max}
          value=${String(value)}
          aria-label=${entry ? describe(entry, key).label : key}
          disabled=${disabled}
          onChange=${(/** @type {{ currentTarget: HTMLInputElement }} */ e) =>
            typeBound(k, Number(e.currentTarget.value))}
        />
        <span class="u">dBFS</span>
      </label>
      <p class="man">${entry ? describe(entry, key).tooltip : ""}</p>
    </div>
  `;
}

/**
 * The range: head line with the playback readout, the bar in its well, then each bound's box.
 *
 * @param {{ grayed: boolean }} props
 */
export function RangeBar({ grayed }) {
  const [ref, box] = useBox({ W: 300, H: Y.H });
  const m = loudnessBar();
  const W = box.W;
  /** @param {BarEvent} e */
  const valueAt = (e) => barValueAt(W, AXIS, PAD_X, pointerIn(e, { W, H: Y.H })[0]);
  /** @param {BarEvent} e */
  const down = (e) => {
    if (grayed) return;
    const v = valueAt(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    moveBound(pickBound(v, m), v);
  };
  /** @param {BarEvent} e */
  const move = (e) => (m.active ? moveBound(m.active, valueAt(e)) : undefined);
  return html`
    <div class=${grayed ? "lrange grayed" : "lrange"}>
      <div class="fh lrh">
        <b>Range</b>
        <div class="vrbox lpb">
          <${Key} kind="needle" />
          <span class="cl">Playback</span>
          <output class="vfd ro live" aria-label="Playback volume">${m.needle === null ? "" : signed(m.needle, 1)}</output>
          <span class="u">dB</span>
        </div>
      </div>
      <div class="vrwell" ref=${ref}>
        <svg
          class="vrbar lrbar"
          role="img"
          aria-label="Loudness range"
          width=${W}
          height=${Y.H}
          viewBox="0 0 ${W} ${Y.H}"
          onPointerDown=${down}
          onPointerMove=${move}
          onPointerUp=${dropBound}
          onPointerCancel=${dropBound}
        >
          <${Marks} W=${W} m=${m} />
        </svg>
      </div>
      <${Bound} k="low" value=${m.low} other=${m.high} disabled=${grayed} />
      <${Bound} k="high" value=${m.high} other=${m.low} disabled=${grayed} />
    </div>
  `;
}
