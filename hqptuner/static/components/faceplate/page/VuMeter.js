// The page Source section's VU pair: one needle meter per channel, stacked L over R. Each face is an arc scale from
// −20 to +3 VU with its red zone above 0, `VU` and the channel's letter, the lettering laid over the drawing at the
// type scale's sizes so it stays legible as the face shrinks. The face's drawing takes the shape of its box: the arc
// stays a true circle and grows as large as the box allows. Like an analog meter the needle swings
// linearly in voltage, so its angle and the ticks follow the reading's place along the scale (model/gauges/meter/vu.js)
// across the arc. What renders holds still; each animation frame turns the needles only (paintVu, from sourcepaint.js).

import { useEffect, useRef, useState } from "preact/hooks";
import { html } from "../../../lib/dom.js";
import { suiteLineStops } from "../../../model/gauges/meter/spectrumfx.js";
import { SCALE_MAX_VU as MAX_VU, SCALE_MIN_VU as MIN_VU, scaleShare } from "../../../model/gauges/meter/vu.js";
import { minusText } from "../../../model/shell/format.js";
import { spectrumColors } from "../../../store/ui/prefs.js";
import { accentInForce } from "../../../store/ui/theme.js";

const VW = 160; // a face's viewBox, wide; its height follows the face's box
const VH_HALF_SQUARE = VW / 2; // the viewBox's height on a 2:1 face, half of a square pair
const PX = VW / 2; // the needle's pivot, centered
const DROP = 9; // and this far below the face's lower edge on a 2:1 face or a taller one
const HEAD = 18; // the room over the dial's top for its labels
const LABEL = 71; // a tick label's inner edge, just past its tick, on a 2:1 face; the radii below scale with it
const SCALE = 65 / LABEL; // the scale arc's radius
const MAJOR = 70 / LABEL; // a labeled tick's outer end
const MINOR = 68 / LABEL; // an unlabeled tick's outer end
const NEEDLE = 67 / LABEL; // the needle's tip, just past the arc
const MAX_HALF = 53; // half the arc's sweep at most, degrees: its ends clear the lettering in the lower corners
const REACH = LABEL * Math.sin((MAX_HALF * Math.PI) / 180); // the end labels' places, across from the pivot
const RED_VU = 0; // the red zone runs from here to the top
const TICKS = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
const LABELED = new Set([-20, -7, -3, 0, 3]); // the ticks whose labels clear each other on the smallest face

/**
 * A face's dial in its viewBox: the viewBox's height, the pivot's height, half the arc's sweep in degrees, and the
 * radius of the tick labels' inner edge that every other radius scales with.
 *
 * @typedef {{ vh: number, py: number, half: number, label: number }} Dial
 */

/**
 * The dial on a face whose viewBox is `vh` tall, its labels' top the same room under the face's top edge and its end
 * labels as far from the side edges as on a 2:1 face. A face taller than 2:1 grows the dial into its height with the
 * pivot just below its lower edge, the sweep narrowing to keep the end labels in place; one wider than that keeps the
 * widest sweep and the 2:1 dial across its width, the pivot dropping further below, a shallower slice of the circle.
 *
 * @param {number} vh
 * @returns {Dial}
 */
function faceGeometry(vh) {
  const label = Math.max(vh + DROP - HEAD, LABEL);
  const half = label > LABEL ? (Math.asin(REACH / label) * 180) / Math.PI : MAX_HALF;
  return { vh, py: HEAD + label, half, label };
}

/**
 * The needle's angle at reading `vu` on a dial sweeping `half` degrees each way, degrees from upright: its place along
 * the scale spread across the arc.
 *
 * @param {number} vu
 * @param {number} half
 */
const turn = (vu, half) => 2 * half * (scaleShare(vu) - 0.5);

/**
 * The point on `dial` at `r` from the pivot along the arc at reading `vu`.
 *
 * @param {Dial} dial
 * @param {number} vu
 * @param {number} r
 * @returns {[number, number]}
 */
function at(dial, vu, r) {
  const a = (turn(vu, dial.half) * Math.PI) / 180;
  return [PX + r * Math.sin(a), dial.py - r * Math.cos(a)];
}

/** @param {number} n */
const f1 = (n) => n.toFixed(1);

/**
 * The scale arc on `dial` from reading `from` to reading `to`, as a path.
 *
 * @param {Dial} dial
 * @param {number} from
 * @param {number} to
 */
function arc(dial, from, to) {
  const r = dial.label * SCALE;
  const [x0, y0] = at(dial, from, r);
  const [x1, y1] = at(dial, to, r);
  return `M${f1(x0)},${f1(y0)} A${f1(r)},${f1(r)} 0 0 1 ${f1(x1)},${f1(y1)}`;
}

/**
 * A tick label: a true minus below 0, a plus above it.
 *
 * @param {number} vu
 */
const tickText = (vu) => (vu > 0 ? `+${vu}` : minusText(vu));

/**
 * A fraction of a face as a CSS percentage.
 *
 * @param {number} f
 */
const pct = (f) => `${(f * 100).toFixed(2)}%`;

/**
 * A tick label's place on `dial`: the point just past its tick, and the outward direction at reading `vu` the
 * stylesheet sets the label off along, so its near edge stays on that point whatever size the face draws at.
 *
 * @param {Dial} dial
 * @param {number} vu
 */
function labelPlace(dial, vu) {
  const [x, y] = at(dial, vu, dial.label);
  const a = (turn(vu, dial.half) * Math.PI) / 180;
  const ux = Math.sin(a).toFixed(3);
  const uy = (-Math.cos(a)).toFixed(3);
  return `left:${pct(x / VW)};top:${pct(y / dial.vh)};--ux:${ux};--uy:${uy}`;
}

/**
 * The needle's transform at reading `vu` on a dial sweeping `half` degrees each way, about the pivot it hangs from.
 *
 * @param {number} vu
 * @param {number} half
 */
const needleAt = (vu, half) => `rotate(${f1(turn(vu, half))})`;

/**
 * One tick on `dial`: from the arc out to its labeled or unlabeled length.
 *
 * @param {{ dial: Dial, vu: number }} props
 */
function Tick({ dial, vu }) {
  const [x0, y0] = at(dial, vu, dial.label * SCALE);
  const [x1, y1] = at(dial, vu, dial.label * (LABELED.has(vu) ? MAJOR : MINOR));
  return html`<line x1=${f1(x0)} y1=${f1(y0)} x2=${f1(x1)} y2=${f1(y1)} />`;
}

/**
 * The height of the viewBox that takes the shape of the box `ref` holds, kept as the box resizes; a 2:1 face until the
 * box is measured.
 *
 * @param {{ current: HTMLElement | null }} ref
 */
function useFaceHeight(ref) {
  const [vh, setVh] = useState(VH_HALF_SQUARE);
  useEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) setVh(Number(f1((VW * rect.height) / rect.width)));
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, []);
  return vh;
}

/**
 * One face: the scale colored through a gradient across it, the red zone, the labels, `VU` and the channel letter,
 * and the needle at rest, drawn to the shape of the face's box.
 *
 * @param {{ name: string, stops: [number, string][] }} props
 */
function Face({ name, stops }) {
  const box = useRef(/** @type {HTMLElement | null} */ (null));
  const dial = faceGeometry(useFaceHeight(box));
  const ink = `vuink-${name}`;
  const [left] = at(dial, MIN_VU, dial.label * SCALE);
  const [right] = at(dial, MAX_VU, dial.label * SCALE);
  const below = TICKS.filter((vu) => vu < RED_VU);
  const above = TICKS.filter((vu) => vu >= RED_VU);
  return html`
    <div class="vu" data-testid="vu-meter" ref=${box}>
      <svg viewBox=${`0 0 ${VW} ${dial.vh}`} preserveAspectRatio="none" role="img" aria-label=${`VU ${name}`}>
        <defs>
          <linearGradient id=${ink} gradientUnits="userSpaceOnUse" x1=${f1(left)} y1="0" x2=${f1(right)} y2="0">
            ${stops.map(([off, color]) => html`<stop offset=${off} stop-color=${color} />`)}
          </linearGradient>
        </defs>
        <g class="vusc" stroke=${`url(#${ink})`}>
          <path d=${arc(dial, MIN_VU, RED_VU)} />
          ${below.map((vu) => html`<${Tick} dial=${dial} vu=${vu} />`)}
        </g>
        <g class="vured">
          <path d=${arc(dial, RED_VU, MAX_VU)} />
          ${above.map((vu) => html`<${Tick} dial=${dial} vu=${vu} />`)}
        </g>
        <g transform=${`translate(${PX} ${f1(dial.py)})`}>
          <line
            class="vun"
            x1="0"
            y1="0"
            x2="0"
            y2=${f1(-dial.label * NEEDLE)}
            data-half=${f1(dial.half)}
            transform=${needleAt(MIN_VU, dial.half)}
          />
        </g>
      </svg>
      ${TICKS.filter((vu) => LABELED.has(vu)).map(
        (vu) =>
          html`<span class=${vu > RED_VU ? "vul red" : "vul"} style=${labelPlace(dial, vu)} aria-hidden="true">
            ${tickText(vu)}
          </span>`,
      )}
      <span class="vum mark" aria-hidden="true">VU</span>
      <span class="vum ch" aria-hidden="true">${name}</span>
    </div>
  `;
}

/**
 * The VU pair: one face per channel named in `names`, stacked, in the Display palette: the palette's own shades on
 * the scale, and the palette written on the pair for the stylesheet's face and needle.
 *
 * @param {{ names: string[] }} props
 */
export function VuPair({ names }) {
  const palette = spectrumColors.value;
  const stops = suiteLineStops(palette, accentInForce());
  return html`
    <div class="vupair" data-palette=${palette}>
      ${names.map((name) => html`<${Face} name=${name} stops=${stops} />`)}
    </div>
  `;
}

/**
 * Turn each needle under `root` to its channel's reading in `vu`, across the sweep its face's dial has; a needle with
 * no reading rests at the bottom of the scale.
 *
 * @param {Element} root
 * @param {readonly number[]} vu
 */
export function paintVu(root, vu) {
  root.querySelectorAll(".vun").forEach((needle, i) => {
    needle.setAttribute("transform", needleAt(vu[i] ?? MIN_VU, Number(needle.getAttribute("data-half"))));
  });
}
