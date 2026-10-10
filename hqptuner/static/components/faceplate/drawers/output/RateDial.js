// The Output drawer's rate dial: one tuner glass, two bands. Tiers are octaves 1x to 2048x evenly spaced on one axis,
// so 32x PCM to 64x SDM is the next octave and the glass is continuous; it carries two settings, the PCM limit and the
// SDM limit, so each band has its own needle confined to its band, the 32x|64x seam a hard stop. Both bands are
// settable in either output mode. Hatched: the device announced it cannot carry the tier. The green lamp: the rate
// running now. While pinned rates are allowed, the pin picker (Auto or a family) parks on the Rate row's label line
// and the pinned rate is boxed in accent on its tier. Every decision is the store's
// (store/faceplate/drawers/output.js); the arithmetic of where things sit is model/gauges/output.js.
//
// The drawing keeps its own aspect, fitted whole and centered in the glass; its box carries the drawing and the band
// sliders, so each slider is a transparent region over its half of the drawing: press or drag onto a tier, arrow keys
// step, Home and End go to the band's ends. Layers: hatch, seam, band legends, rule and minor ticks, needles, tier
// printing, playing lamp, band sliders.

import { useRef } from "preact/hooks";
import { html } from "../../../../lib/dom.js";
import {
  bandEdges,
  bandSpan,
  dialScale,
  drawingX,
  minorTicks,
  nearestTier,
  seamX,
} from "../../../../model/gauges/output.js";
import { dialView, dragTier, keyTier, pickPin, pickTier } from "../../../../store/faceplate/drawers/output.js";

/** @typedef {import("../../../../store/faceplate/drawers/output.js").DialTier} DialTier */
/** @typedef {import("../../../../store/faceplate/drawers/output.js").DialView} DialView */
/** @typedef {import("../../../../store/faceplate/drawers/output.js").Fam} Fam */
/** @typedef {import("../../../../store/faceplate/drawers/output.js").PinPick} PinPick */
/** @typedef {import("../../../../model/gauges/output.js").DialScale} DialScale */
/** @typedef {import("../../../../model/gauges/output.js").TierSpan} TierSpan */
/** @typedef {{ id: "pcm" | "sdm", legend: string }} Band */
/**
 * A pointer or key event on a band slider, the members read here; the slider's parent is the drawing's box, and its
 * parent the glass.
 *
 * @typedef {object} SliderEvent
 * @property {number} [clientX]
 * @property {number} [pointerId]
 * @property {string} [key]
 * @property {() => void} [preventDefault]
 * @property {{ setPointerCapture?: (id: number) => void, parentElement: { parentElement: Element } }} currentTarget
 */

const W = 806; // viewBox width: the Format row at the 1080 plate, so the printing is 1:1
const H = 106;
const X0 = 38; // x of the first tier
const RULE_Y = 56;
const INSET = 8; // a band's legend and rule stop this far inside its outer tiers' cells
const HATCH = "rate-dial-hatch";
const VIEWBOX = { w: W, h: H };
const FREQ_Y = { f44: 67, f48: 79 }; // middle of each member's frequency line, the line centered on it
const FREQ_PITCH = FREQ_Y.f48 - FREQ_Y.f44;
const PIN_PAD = 2; // the pin box stops this far inside its tier's cell

/** Each tier's members, in printing order. @type {Fam[]} */
const FAMS = ["f44", "f48"];

/** The pin picker's options: Auto, then the families, the family labels kept in their own case. */
const PICKS = [
  { pin: "auto", label: "Auto", fam: false },
  { pin: "f44", label: "44.1k", fam: true },
  { pin: "f48", label: "48k", fam: true },
];

/** @type {Band[]} */
const BANDS = [
  { id: "pcm", legend: "PCM" },
  { id: "sdm", legend: "SDM (DSD)" },
];

/** Where each key sends a band's key origin `c`. @type {Record<string, (c: number, st: TierSpan) => number>} */
const KEYS = {
  ArrowLeft: (c) => c - 1,
  ArrowDown: (c) => c - 1,
  ArrowRight: (c) => c + 1,
  ArrowUp: (c) => c + 1,
  Home: (c, st) => st.lo,
  End: (c, st) => st.hi,
};

/**
 * The box round the pinned member's frequency line: its tier's cell wide, one line pitch tall, on the line's middle.
 *
 * @param {{ x: number, cell: number, fam: Fam }} props
 */
function PinBox({ x, cell, fam }) {
  const w = cell - 2 * PIN_PAD;
  return html`<rect class="pinbox" x=${x - w / 2} y=${FREQ_Y[fam] - FREQ_PITCH / 2} width=${w} height=${FREQ_PITCH} rx="2" />`;
}

/**
 * One tier's printing: major tick, name, both exact rates, the box round a pinned rate, and the unavailable note.
 *
 * @param {{ t: DialTier, i: number, x: number, cell: number, sel: boolean, pin: Fam | null }} props
 */
function TierMark({ t, i, x, cell, sel, pin }) {
  const cls = [t.unavailable ? "unav" : "", sel ? "sel" : "", pin ? "pinned" : ""].filter(Boolean).join(" ");
  const line = (/** @type {Fam} */ fam) => `${t[fam]} ${t.unit}`;
  return html`
    <g class=${cls || undefined} data-i=${i}>
      <line class="major" x1=${x} y1=${RULE_Y - 12} x2=${x} y2=${RULE_Y} />
      <text class="tier" x=${x} y="38" text-anchor="middle">${t.name}</text>
      ${pin ? html`<${PinBox} x=${x} cell=${cell} fam=${pin} />` : null}
      ${FAMS.map(
        (fam) =>
          html`<text class=${pin === fam ? "freq pf" : "freq"} x=${x} y=${FREQ_Y[fam]} text-anchor="middle" dominant-baseline="central">${line(fam)}</text>`,
      )}
      ${t.unavailable ? html`<text class="note" x=${x} y="99" text-anchor="middle">unavailable</text>` : null}
    </g>
  `;
}

/**
 * One band: legend over its bracket, rule and minor ticks, the needle on its limit, the tier printing.
 *
 * @param {{ b: Band, view: DialView, scale: DialScale }} props
 */
function BandGlass({ b, view, scale }) {
  const span = bandSpan(view.tiers, b.id);
  const { x1, x2 } = bandEdges(scale, span, INSET);
  const cur = view.limits[b.id];
  const marks = [];
  for (let i = span.lo; i <= span.hi; i++) {
    const pin = view.pin && view.pin.tier === i ? view.pin.fam : null;
    marks.push(
      html`<${TierMark} t=${view.tiers[i]} i=${i} x=${scale.xs[i]} cell=${scale.dx} sel=${i === cur} pin=${pin} />`,
    );
  }
  return html`
    <g class="band" data-band=${b.id}>
      <path class="bl" d=${`M${x1},20 V14 H${x2} V20`} />
      <text class="legend" x=${(x1 + x2) / 2} y="18" text-anchor="middle">${b.legend}</text>
      <line class="rule" x1=${x1} y1=${RULE_Y} x2=${x2} y2=${RULE_Y} />
      ${minorTicks(scale, span, { x1, x2 }).map((x) => html`<line class="minor" x1=${x} y1=${RULE_Y - 5} x2=${x} y2=${RULE_Y} />`)}
      ${
        cur == null
          ? null
          : html`<g class="ndl" style=${{ transform: `translateX(${scale.xs[cur]}px)` }}>
              <rect class="needle" x="-1.25" y="26" width="2.5" height="64" rx="1" />
            </g>`
      }
      ${marks}
    </g>
  `;
}

/** The glass a slider sits in. @param {SliderEvent} e */
const glassOf = (e) => e.currentTarget.parentElement.parentElement;

/**
 * The tier under a pointer: the drawing x it falls on inside the glass's inner box, which the drawing is fitted into.
 *
 * @param {DialScale} scale
 * @param {SliderEvent} e
 */
function tierAt(scale, e) {
  const glass = glassOf(e);
  const r = glass.getBoundingClientRect();
  const inner = { left: r.left + glass.clientLeft, width: glass.clientWidth, height: glass.clientHeight };
  return nearestTier(scale, drawingX(Number(e.clientX), inner, VIEWBOX));
}

/**
 * A band slider's pointer and key handlers: a press picks the tier under it and starts a drag, a drag picks each tier
 * it crosses, a key steps from the origin the store reads.
 *
 * @param {Band["id"]} band
 * @param {DialScale} scale
 */
function useBandInput(band, scale) {
  const dragging = useRef(false);
  /** @param {SliderEvent} e @param {boolean} on */
  const drag = (e, on) => {
    dragging.current = on;
    glassOf(e).classList[on ? "add" : "remove"]("drag");
  };
  return {
    onPointerDown: (/** @type {SliderEvent} */ e) => {
      drag(e, true);
      e.currentTarget.setPointerCapture?.(Number(e.pointerId));
      return pickTier(band, tierAt(scale, e));
    },
    onPointerMove: (/** @type {SliderEvent} */ e) => (dragging.current ? dragTier(band, tierAt(scale, e)) : undefined),
    onPointerUp: (/** @type {SliderEvent} */ e) => drag(e, false),
    onPointerCancel: (/** @type {SliderEvent} */ e) => drag(e, false),
    onKeyDown: (/** @type {SliderEvent} */ e) => {
      const step = KEYS[String(e.key)];
      if (!step) return undefined;
      e.preventDefault?.();
      return keyTier(band, step);
    },
  };
}

/**
 * A band's slider: a transparent region over its half of the drawing, reporting the needle's tier.
 *
 * @param {{ b: Band, view: DialView, scale: DialScale, seam: number }} props
 */
function BandSlider({ b, view, scale, seam }) {
  const span = bandSpan(view.tiers, b.id);
  const cur = view.limits[b.id];
  const input = useBandInput(b.id, scale);
  const split = (seam / W) * 100;
  const style = b.id === "pcm" ? `left:0%;width:${split}%` : `left:${split}%;width:${100 - split}%`;
  const t = cur == null ? null : view.tiers[cur];
  return html`
    <div
      class="bandsl"
      role="slider"
      tabindex="0"
      data-band=${b.id}
      data-dirty=${view.dirty[b.id] ? "" : undefined}
      style=${style}
      aria-label=${`${b.legend} rate`}
      aria-valuemin=${span.lo}
      aria-valuemax=${span.hi}
      aria-valuenow=${cur ?? undefined}
      aria-valuetext=${t ? t.name + (t.unavailable ? ", unavailable" : "") : undefined}
      ...${input}
    ></div>
  `;
}

/**
 * The hatch behind each tier the device cannot carry.
 *
 * @param {{ view: DialView, scale: DialScale }} props
 */
const Hatch = ({ view, scale }) => html`
  <defs>
    <pattern id=${HATCH} class="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6" />
    </pattern>
  </defs>
  ${view.tiers.map((t, i) =>
    t.unavailable
      ? html`<rect x=${scale.xs[i] - scale.dx / 2} y="0" width=${scale.dx} height=${H} fill=${`url(#${HATCH})`} />`
      : null,
  )}
`;

/**
 * The pin picker, parked on the Rate row's label line: Auto or a family, the pick lit.
 *
 * @param {{ pick: PinPick }} props
 */
const PinPicker = ({ pick }) => html`
  <div class="seg mini ratepin" role="radiogroup">
    ${PICKS.map(
      (o) => html`
        <button
          type="button"
          role="radio"
          class=${o.pin === pick ? "on" : undefined}
          aria-checked=${String(o.pin === pick)}
          data-pin=${o.pin}
          onClick=${() => pickPin(/** @type {PinPick} */ (o.pin))}
        >
          ${o.fam ? html`<span class="su">${o.label}</span>` : o.label}
        </button>
      `,
    )}
  </div>
`;

/**
 * The rate dial over `pcm_rate` and `sdm_rate`: both bands, their needles, the hatch, the playing lamp, and while
 * pinned rates are allowed the pin picker and the pinned rate's box.
 */
export function RateDial() {
  const view = dialView();
  const scale = dialScale(view.tiers.length, W, X0);
  const seam = seamX(scale, view.tiers);
  return html`
    ${view.picker === null ? null : html`<${PinPicker} pick=${view.picker} />`}
    <div
      class="dial"
      role="group"
      aria-label="Output rate"
      data-dirty=${view.dirty.pcm || view.dirty.sdm ? "" : undefined}
    >
      <div class="dwg" style=${`aspect-ratio:${W} / ${H}`}>
        <svg viewBox=${`0 0 ${W} ${H}`} width="100%" height="100%" aria-hidden="true">
          <${Hatch} view=${view} scale=${scale} />
          <g class="seam">
            <line class="sd" x1=${seam} y1="0" x2=${seam} y2=${H} />
            <line class="sl" x1=${seam + 1.5} y1="0" x2=${seam + 1.5} y2=${H} />
          </g>
          ${BANDS.map((b) => html`<${BandGlass} b=${b} view=${view} scale=${scale} />`)}
          ${view.playing == null ? null : html`<circle class="playing" cx=${scale.xs[view.playing]} cy="96" r="3.5" />`}
        </svg>
        ${BANDS.map((b) => html`<${BandSlider} b=${b} view=${view} scale=${scale} seam=${seam} />`)}
      </div>
    </div>
  `;
}
