// The Crossfeed block's Structural line (HQPTuner's sixteen-pipeline block): Preset, Speaker angle, Head circumference,
// Center character and the settings an install would change; its manual copy; and under the lines v1's top-down
// drawing (xfeed/Geometry.js conventions) with v1's readouts beside it. Speakers toed in at ±angle, the head sized by
// the circumference, solid = each ear's near path, dashed = the far path crossfeed synthesizes, ±30° reference ticks.
// The coordinates are the lifted model/gauges/crossfeed.js's.

import { html, wheelGuard } from "../../../../lib/dom.js";
import { minus, plusMinus } from "../../../../model/shell/format.js";
import { geometryReadouts, listeningGeometry } from "../../../../model/gauges/crossfeed.js";
import { PRESETS } from "../../../../lib/binaural-setup.js";
import { pathParams } from "../../../../vendor/eqlab/core/binaural/geometry.js";
import {
  commitStructural,
  dragStructural,
  pickStructuralPreset,
  structuralView,
} from "../../../../store/faceplate/drawers/crossfeed/structural.js";
import { ManPara } from "../loudness/parts.js";
import { Slider } from "./Slider.js";
import { LABEL, NAME, READOUT, STRUCTURAL_MAN, radiusSub } from "./copy.js";

/** @typedef {import("../../../../store/faceplate/drawers/crossfeed.js").CrossfeedLive} CrossfeedLive */
/** @typedef {[number, number]} Point */

/** The Structural line's controls. @param {{ live: CrossfeedLive }} props */
export function StructuralControls({ live }) {
  const s = structuralView();
  const off = !live.controls;
  return html`
    <div class=${live.linesGrayed ? "xctl grayed" : "xctl"}>
      <div class="ci">
        <span class="cl">${LABEL.preset}</span>
        <select
          class="vfd xspre"
          aria-label=${LABEL.preset}
          disabled=${off}
          onWheel=${wheelGuard}
          onChange=${(/** @type {{ currentTarget: HTMLSelectElement }} */ e) =>
            pickStructuralPreset(e.currentTarget.value)}
        >
          ${PRESETS.map((p) => html`<option value=${p.id} selected=${p.id === s.preset}>${p.label}</option>`)}
          ${s.preset === "custom" ? html`<option value="custom" selected>${LABEL.custom}</option>` : null}
        </select>
      </div>
      <${Slider}
        label=${LABEL.angle}
        min=${5}
        max=${60}
        step=${0.5}
        unit="°"
        dp=${1}
        value=${s.angle}
        disabled=${off}
        onDrag=${(/** @type {number} */ angle) => dragStructural({ angle })}
        onCommit=${(/** @type {number} */ angle) => commitStructural({ angle })}
      />
      <${Slider}
        label=${LABEL.circ}
        sub=${radiusSub((s.headRadius * 100).toFixed(2))}
        min=${41}
        max=${66}
        step=${0.25}
        unit="cm"
        dp=${2}
        value=${s.circ}
        disabled=${off}
        onDrag=${(/** @type {number} */ circ) => dragStructural({ circ })}
        onCommit=${(/** @type {number} */ circ) => commitStructural({ circ })}
      />
      <${Slider}
        label=${LABEL.lambda}
        min=${0}
        max=${150}
        step=${1}
        unit="%"
        dp=${0}
        value=${Math.round(s.lambda * 100)}
        disabled=${off}
        onDrag=${(/** @type {number} */ v) => dragStructural({ lambda: v / 100 })}
        onCommit=${(/** @type {number} */ v) => commitStructural({ lambda: v / 100 })}
      />
      ${s.conflicts.map((c) => html`<span class="gr" data-k=${c.key}>${c.reason}</span>`)}
    </div>
  `;
}

/** The Structural line's manual copy. */
export const StructuralCopy = () => html`
  <div class="man">
    <${ManPara} label=${LABEL.angle} text=${STRUCTURAL_MAN.angle} />
    <${ManPara} label=${LABEL.circ} text=${STRUCTURAL_MAN.circ} />
    <${ManPara} label=${LABEL.lambda} text=${STRUCTURAL_MAN.lambda} />
  </div>
`;

/** @param {Point} p */
const xy = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

/**
 * The top-down drawing at speaker angle `angle` and head circumference `circ`.
 *
 * @param {{ angle: number, circ: number }} props
 */
function Diagram({ angle, circ }) {
  const g = listeningGeometry(angle, circ);
  const { cx, cy, r, earL, earR, arc } = g;
  const far = (/** @type {(typeof g.far)[0]} */ p) =>
    `M${xy(p.from)} L${xy(p.via)} A${r},${r} 0 0 ${p.sweep} ${xy(p.to)}`;
  const line = (/** @type {{ x1: number, y1: number, x2: number, y2: number }} */ l, /** @type {string} */ cls) =>
    html`<line class=${cls} x1=${l.x1} y1=${l.y1} x2=${l.x2} y2=${l.y2} />`;
  const ear = (/** @type {number} */ x) => html`<rect class="ear" x=${x} y=${cy - 5} width="4" height="10" rx="1.5" />`;
  return html`
    <svg class="xfdiag" role="img" aria-label=${NAME.diagram} viewBox="52 6 296 172" preserveAspectRatio="xMidYMid meet">
      ${line(g.axis, "axis")} ${g.ref.map((l) => line(l, "ref"))}
      <path class="arc" d="M${xy(arc.from)} A${arc.r},${arc.r} 0 0 1 ${xy(arc.to)}" />
      <text class="ang" x=${g.label[0]} y=${g.label[1]} text-anchor="middle">${minus(angle, 1)}°</text>
      <path class="far" d=${far(g.far[0])} />
      <path class="far" d=${far(g.far[1])} />
      ${line({ x1: g.speakers[0].p[0], y1: g.speakers[0].p[1], x2: earL[0], y2: earL[1] }, "near")}
      ${line({ x1: g.speakers[1].p[0], y1: g.speakers[1].p[1], x2: earR[0], y2: earR[1] }, "near")}
      <circle class="head" cx=${cx} cy=${cy} r=${r} />
      <path class="nose" d="M${cx - 4},${cy - r + 1} L${cx},${cy - r - 6} L${cx + 4},${cy - r + 1}" />
      ${ear(earL[0] - 3)} ${ear(earR[0] - 1)}
      ${g.speakers.map(
        ({ d, p }, i) => html`
          <g class="spk">
            <g transform="translate(${p[0].toFixed(1)} ${p[1].toFixed(1)}) rotate(${d})">
              <rect x="-10" y="-8" width="20" height="16" rx="2" />
              <circle class="drv" cx="0" cy="3.5" r="3" />
            </g>
            <text class="sl" x=${p[0] + (i ? 18 : -18)} y=${p[1] + 4} text-anchor=${i ? "start" : "end"}>
              ${i ? "R" : "L"}
            </text>
          </g>
        `,
      )}
    </svg>
  `;
}

/** The drawing with v1's readouts beside it. @param {{ grayed: boolean }} props */
export function Geometry({ grayed }) {
  const s = structuralView();
  const pp = pathParams(s.angle, s.headRadius);
  const ro = geometryReadouts(
    { an: pp.alphaNear, af: pp.alphaFar, itd: pp.itd, gdN: pp.groupDelayNear, gdF: pp.groupDelayFar },
    s.lambda,
  );
  return html`
    <div class=${grayed ? "xfgeo grayed" : "xfgeo"}>
      <div class="xfpic"><${Diagram} angle=${s.angle} circ=${s.circ} /></div>
      <dl class="xfro">
        <div>
          <dt>${READOUT.itd}</dt>
          <dd>${ro.itd} µs<span>${READOUT.itdLow(ro.itdLow)}</span></dd>
        </div>
        <div>
          <dt>${READOUT.far}</dt>
          <dd>${minus(ro.far, 1)} dB</dd>
        </div>
        <div>
          <dt>${READOUT.center}</dt>
          <dd>${plusMinus(ro.center, 2)} dB</dd>
        </div>
      </dl>
    </div>
  `;
}
