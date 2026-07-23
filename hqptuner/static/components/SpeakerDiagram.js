// Top-down geometry for the structural crossfeed card. Not decoration: it is the
// readout that makes "speaker angle" and "head size" legible as the physical
// quantities they are, and it tracks the controls live.
//
// Drawn conventions, from the mockup review: speakers are TOED IN, facing the
// listener, not parallel. Solid lines are each ear's near path, dashed are the
// far paths — the ones crossfeed synthesizes and headphones otherwise omit. The
// ±30° reference ticks mark the stereo standard.
import { html } from "../lib/dom.js";

const W = 340;
const H = 200;
const CX = W / 2;
const CY = 158; // listener sits low; the stage occupies the upper two thirds
const R = 104; // speaker distance, fixed — angle is the variable, not the radius

// Head radius in metres to pixels. Real spread is ~7-10 cm and the difference
// has to be visible without the head becoming a boulder, so the range is mapped
// across a deliberately narrow band.
const headPx = (metres) => 15 + ((Math.min(0.105, Math.max(0.065, metres)) - 0.065) / 0.04) * 10;

const polar = (deg, r) => {
  const rad = (deg * Math.PI) / 180;
  return [CX + r * Math.sin(rad), CY - r * Math.cos(rad)];
};

function Speaker({ deg }) {
  const [x, y] = polar(deg, R);
  // rotate by the same angle so the baffle faces the listener — toed in
  return html`
    <g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg.toFixed(1)})" class="spk">
      <rect x="-11" y="-9" width="22" height="18" rx="2" />
      <line x1="-11" y1="9" x2="11" y2="9" class="spk-baffle" />
      <circle cx="0" cy="4" r="3.2" class="spk-driver" />
    </g>
  `;
}

// The angle itself, swept from the forward axis to a speaker ray at the listener.
// Without this the control reads as moving the speakers wider and further away —
// the constant radius is true but invisible, so the quantity being changed is not
// the one the diagram appears to show.
function angleArc(deg, r) {
  const [sx, sy] = polar(0, r);
  const [ex, ey] = polar(deg, r);
  const sweep = deg > 0 ? 1 : 0;
  return `M${sx.toFixed(1)} ${sy.toFixed(1)} A${r} ${r} 0 0 ${sweep} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
}

export function SpeakerDiagram({ angle, headRadius }) {
  const hr = headPx(headRadius);
  const [lx, ly] = polar(-angle, R);
  const [rx, ry] = polar(angle, R);
  const earL = [CX - hr, CY];
  const earR = [CX + hr, CY];
  const path = (from, to) => `M${from[0].toFixed(1)} ${from[1].toFixed(1)} L${to[0].toFixed(1)} ${to[1].toFixed(1)}`;
  return html`
    <svg
      class="spk-diagram"
      viewBox="0 0 ${W} ${H}"
      role="img"
      aria-label="Top-down view: two speakers at plus and minus ${angle.toFixed(0)} degrees, toed in toward the listener"
    >
      <circle cx=${CX} cy=${CY} r=${R} class="spk-arc" />
      <line x1=${CX} y1=${CY} x2=${CX} y2=${CY - R - 6} class="spk-axis" />
      <path d=${angleArc(angle, 46)} class="spk-angle" />
      <text
        x=${polar(angle / 2, 60)[0].toFixed(1)}
        y=${(polar(angle / 2, 60)[1] + 3).toFixed(1)}
        class="spk-angle-label"
        text-anchor="middle"
      >
        ${angle.toFixed(0)}°
      </text>

      <path d=${path([lx, ly], earL)} class="spk-near" />
      <path d=${path([rx, ry], earR)} class="spk-near" />
      <path d=${path([lx, ly], earR)} class="spk-far" />
      <path d=${path([rx, ry], earL)} class="spk-far" />

      <${Speaker} deg=${-angle} />
      <${Speaker} deg=${angle} />

      <circle cx=${CX} cy=${CY} r=${hr.toFixed(1)} class="spk-head" />
      <path d="M${(CX - hr).toFixed(1)} ${CY - 2} a3 3 0 0 0 0 5" class="spk-ear" />
      <path d="M${(CX + hr).toFixed(1)} ${CY - 2} a3 3 0 0 1 0 5" class="spk-ear" />
      <path
        d="M${CX - 3} ${(CY - hr).toFixed(1)} L${CX} ${(CY - hr - 4).toFixed(1)} L${CX + 3} ${(CY - hr).toFixed(1)}"
        class="spk-nose"
      />
    </svg>
  `;
}
