// Top-down geometry for the structural crossfeed card. Not decoration: it is the
// readout that makes "speaker angle" and "head size" legible as the physical
// quantities they are, and it tracks the controls live.
//
// Drawn conventions, from the mockup review: speakers are TOED IN, facing the
// listener, not parallel. Solid lines are each ear's near path, dashed are the
// far paths — the ones crossfeed synthesizes and headphones otherwise omit. The
// ±30° reference ticks mark the stereo standard.
import { html } from "../lib/dom.js";
import { polarAround } from "../lib/geometry.js";

const W = 340;
const H = 200;
const CX = W / 2;
const CY = 158; // listener sits low; the stage occupies the upper two thirds
const R = 104; // speaker distance, fixed — angle is the variable, not the radius

// Head radius in metres to pixels. Real spread is ~7-10 cm and the difference
// has to be visible without the head becoming a boulder, so the range is mapped
// across a deliberately narrow band.
const headPx = (metres) => 15 + ((Math.min(0.105, Math.max(0.065, metres)) - 0.065) / 0.04) * 10;

const polar = polarAround(CX, CY);

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

// The far-ear path is not a straight line to the far ear: sound grazes the head
// and wraps around it to the shadowed side, and that wrap IS the interaural
// delay the structural model encodes (docs/crossfeed-math.md). Drawing it
// straight sent it through the head, where the filled head disc painted over it
// — so the dashed line appeared to stop at the listener's nose instead of
// reaching an ear.
//
// So: straight from the speaker to a tangent point, then round the head to the
// far ear. earDeg is the far ear's position on the head circle (0 = right,
// 180 = left); the path passes the front, which is the shorter way round for
// every angle the control allows.
//
// The arc is struck on a circle STANDOFF px outside the head rather than on the
// head itself. Riding the skull read as the line wrapping the listener's face —
// and the nose, which projects 4px, punched straight through it. The standoff
// clears the nose and leaves visible air, so the path reads as going around the
// head instead of being painted onto it, then steps in to meet the ear.
// It is ONE curve, speaker to ear, with no straight segment and no join in it.
// Every attempt to build this out of pieces — a straight run plus an arc, or a
// straight run plus a spiral — put a visible corner where the pieces met, even
// when the tangents matched, because the curvature still jumped from zero to
// tight in one step. Sound bending round a head has no corner in it.
//
// A single cubic has no interior joins at all. The two control points do the
// work: the first sits along the line the sound would travel if the head were
// not there (75% of the way to where that ray grazes it), which keeps the early
// part of the path nearly straight and pointed at the listener; the second sits
// out on the standoff ring near the ear, which swings the tail round the head.
//
// The three constants are not taste: they were solved for. A cubic sags between
// its control points, and at the widest speaker angle with the largest head the
// first values tried cut 2.2px INTO the skull. These clear the head across the
// whole of both sliders' range (angle 5-60°, circumference 41-66 cm) — worst
// case touches the surface only at the ear itself, which is where it belongs.
// Changing any of them needs that sweep re-run, not an eyeball at one setting.
const STANDOFF = 12;
const BEND = (40 * Math.PI) / 180;
const LEAD = 0.8; // how far along the graze ray the first control point sits

const at = (r, a) => [CX + r * Math.cos(a), CY + r * Math.sin(a)];

function farPath([sx, sy], earDeg, hr) {
  const ro = hr + STANDOFF;
  const theta = Math.atan2(sy - CY, sx - CX);
  const alpha = Math.acos(Math.min(1, ro / Math.hypot(sx - CX, sy - CY)));
  const dir = earDeg === 0 ? 1 : -1; // swing toward that ear: 0 = right, 180 = left
  const rad = (earDeg * Math.PI) / 180;
  const f = (n) => n.toFixed(1);

  const [gx, gy] = at(ro, theta + dir * alpha); // where an undeflected ray grazes
  const [c1x, c1y] = [sx + (gx - sx) * LEAD, sy + (gy - sy) * LEAD];
  const [c2x, c2y] = at(ro, rad - dir * BEND);
  const [ex, ey] = at(hr, rad);
  return `M${f(sx)} ${f(sy)} C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(ex)} ${f(ey)}`;
}

export function CrossfeedGeometry({ angle, headRadius }) {
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

      <!-- head first: the far paths run along its rim, so they must sit on top
           of the filled disc or the wrap disappears under it -->
      <circle cx=${CX} cy=${CY} r=${hr.toFixed(1)} class="spk-head" />

      <path d=${path([lx, ly], earL)} class="spk-near" />
      <path d=${path([rx, ry], earR)} class="spk-near" />
      <path d=${farPath([lx, ly], 0, hr)} class="spk-far" />
      <path d=${farPath([rx, ry], 180, hr)} class="spk-far" />

      <${Speaker} deg=${-angle} />
      <${Speaker} deg=${angle} />

      <path d="M${(CX - hr).toFixed(1)} ${CY - 2} a3 3 0 0 0 0 5" class="spk-ear" />
      <path d="M${(CX + hr).toFixed(1)} ${CY - 2} a3 3 0 0 1 0 5" class="spk-ear" />
      <path
        d="M${CX - 3} ${(CY - hr).toFixed(1)} L${CX} ${(CY - hr - 4).toFixed(1)} L${CX + 3} ${(CY - hr).toFixed(1)}"
        class="spk-nose"
      />
    </svg>
  `;
}
