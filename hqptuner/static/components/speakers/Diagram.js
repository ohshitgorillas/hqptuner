// Top-down room plan for the speaker-processing card. Not decoration: distance
// and level are otherwise eight pairs of numbers with no shape to them, and the
// two settings mean nothing until you can see WHICH speaker each row is.
//
// Conventions: the listener faces up the page. Each speaker sits at its layout
// angle, toed in toward the listener, at a radius scaled by ITS OWN distance
// setting — so a speaker set further away in the config is drawn further away.
// Level rides as a label, since it has no spatial meaning. Channels outside the
// chosen speaker set are drawn dimmed rather than hidden: they exist in the
// daemon's form either way, and hiding them makes the set control look like it
// deletes things.
//
// The viewBox is measured from the artwork on every render, never fixed. A box
// sized for the worst case (every speaker at six meters) leaves the drawing
// floating in empty bands at typical distances, and those bands are card height:
// they padded the card top and bottom the moment the plan was enlarged. Fitting
// the box to what is actually drawn means the plan fills its width at any
// distance and the card is only ever as tall as the drawing needs.
//
// Distinct from xfeed/Geometry.js, which draws crossfeed's simulated stereo
// pair and its ear paths — a different quantity (angle, head size), a different
// audience, and no room in it for a rear channel.
import { html } from "../../lib/dom.js";
import { polarAround } from "../../lib/geometry.js";

/**
 * @typedef {{
 *   index: number, label: string, level: number | string, distance: number | string,
 *   level_min?: number | string, level_max?: number | string, level_step?: number | string,
 *   distance_min?: number | string, distance_max?: number | string, distance_step?: number | string,
 * }} SpeakerChannel
 *   One channel of the daemon's /speakers form as conf/httpconf.py parses it:
 *   index and the daemon's own label, the two settings, and each input's
 *   min/max/step — present only where the form's `<input>` carried the
 *   attribute, and text wherever the value did not parse as a number.
 * @typedef {{ minX: number, maxX: number, minY: number, maxY: number }} Extent
 *   How far one speaker's drawing reaches, in user units. Feeds the measured
 *   viewBox.
 */

const CX = 160;
const CY = 150;
const R_MIN = 62; // ring radius at a distance of 0
const R_MAX = 122; // ring radius at DIST_FULL and beyond
const HEAD = 13;

// Layout angles, degrees clockwise from front. Index order is the daemon's own
// channel order (readme §1.9): Left, Right, Center, LFE, Left rear, Right rear,
// Left side, Right side.
const LAYOUT = [-30, 30, 0, -55, -145, 145, -90, 90];
// The sub sits OUTSIDE the ring, off the front-left, which is where one actually
// ends up in a room. Its radius is pushed past the mains and capped, so it stays
// outside them at every distance.
const OUTSET = { 3: 1.35 };
const SUB_MAX = 140;
const SHORT = ["L", "R", "C", "Sub", "Lr", "Rr", "Ls", "Rs"];

const polar = polarAround(CX, CY);

// Distance -> radius, on an ABSOLUTE scale. Scaling relative to the largest
// distance in the set made the drawing a lie: with one speaker at 3 cm and the
// rest at 0, that 3 cm stretched to the full ring — a meter of displacement at
// any believable room size. Six meters spans the ring instead, so a 3 cm trim
// moves its speaker by half a pixel, which is what 3 cm deserves.
const DIST_FULL = 600; // cm at the outermost radius
/**
 * @param {number} index
 * @param {number | string} distance
 * @returns {number}
 */
function radiusOf(index, distance) {
  const d = Math.max(0, Math.min(DIST_FULL, Number(distance) || 0));
  const r = HEAD + (d / DIST_FULL) * (R_MAX - HEAD);
  return index === 3 ? Math.min(r * OUTSET[3], SUB_MAX) : r;
}

// Where a speaker's two labels sit relative to its box: under it for everything
// on the ring, and to the LEFT for the sub, which sits between the left and
// left-side speakers where a label hung underneath lands on one of them.
const labelPos = (/** @type {number} */ index, /** @type {number} */ x) =>
  index === 3 ? { x: x - 13, anchor: "end", dy1: -4, dy2: 7 } : { x, anchor: "middle", dy1: 22, dy2: 33 };

// How far a speaker's drawing reaches around its own center — the rotated box,
// plus wherever its labels land. Feeds the measured viewBox.
/**
 * The bounding box one speaker glyph plus its label text occupies at `(x, y)`, so
 * the diagram's viewBox can be fitted to what is drawn.
 *
 * @param {number} index
 * @param {number} x
 * @param {number} y
 * @returns {Extent}
 */
function extent(index, x, y) {
  const box = 15; // rotated 20x16 box, half-diagonal
  const left = index === 3 ? 46 : 18; // sub's labels run out to its left
  const down = index === 3 ? 12 : 38; // everything else labels underneath
  return { minX: x - Math.max(box, left), maxX: x + box + 2, minY: y - box, maxY: y + down };
}

/**
 * Renders the overhead plan view of the speaker set: each channel with a distance
 * placed at its layout angle around the listener, labeled with its channel name
 * and level trim.
 *
 * @param {{ channels: SpeakerChannel[] | null, active: Set<number> }} props
 */
export function SpeakersDiagram({ channels, active }) {
  const rows = channels || [];
  // A speaker with no distance set has no position: it is not placed in the room
  // yet, so it is not drawn. Distance is measured from the listener, so the scale
  // starts at the listener — 0 cm is the head, 3 cm is on top of it.
  const placed = rows
    .filter((c) => Number(c.distance) > 0)
    .map((c) => {
      const deg = LAYOUT[c.index] ?? 0;
      const [x, y] = polar(deg, radiusOf(c.index, c.distance));
      return { ch: c, deg, x, y, ext: extent(c.index, x, y) };
    });
  // The frame never collapses onto the listener: an empty plan (nothing placed
  // yet) would otherwise measure a viewBox the size of the head and blow it up
  // to fill the card.
  const spans = [
    ...placed.map((p) => p.ext),
    { minX: CX - R_MIN, maxX: CX + R_MIN, minY: CY - R_MIN, maxY: CY + R_MIN },
  ];
  const pad = 4;
  const minX = Math.min(...spans.map((s) => s.minX)) - pad;
  const minY = Math.min(...spans.map((s) => s.minY)) - pad;
  const w = Math.max(...spans.map((s) => s.maxX)) + pad - minX;
  const h = Math.max(...spans.map((s) => s.maxY)) + pad - minY;
  return html`
    <svg
      class="room-diagram"
      viewBox="${minX.toFixed(1)} ${minY.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}"
      role="img"
      aria-label="Top-down speaker layout: ${rows.filter((c) => active.has(c.index)).length} active channels"
    >
      <!-- no reference ring: it marked where an unplaced speaker sat, and nothing
           sits there now — a speaker's radius is its distance from the listener -->
      <line x1=${CX} y1=${CY} x2=${CX} y2=${CY - R_MIN - 6} class="room-axis" />
      <circle cx=${CX} cy=${CY} r=${HEAD} class="room-head" />
      <path d="M${CX - 3} ${CY - HEAD} L${CX} ${CY - HEAD - 4} L${CX + 3} ${CY - HEAD}" class="room-nose" />
      ${placed.map(
        (p) => html`
          <${Speaker}
            index=${p.ch.index}
            deg=${p.deg}
            x=${p.x}
            y=${p.y}
            label=${p.ch.label}
            level=${p.ch.level}
            distance=${p.ch.distance}
            on=${active.has(p.ch.index)}
          />
        `,
      )}
    </svg>
  `;
}

/**
 * @param {{
 *   index: number, deg: number, x: number, y: number,
 *   label: string, level: number | string, distance: number | string, on: boolean,
 * }} props
 */
function Speaker({ index, deg, x, y, label, level, distance, on }) {
  const lp = labelPos(index, x);
  const cls = on ? "room-spk" : "room-spk room-off";
  const box =
    index === 3
      ? html`<rect x="-9" y="-9" width="18" height="18" rx="2" />`
      : html`
          <rect x="-10" y="-8" width="20" height="16" rx="2" />
          <line x1="-10" y1="8" x2="10" y2="8" class="room-baffle" />
          <circle cx="0" cy="3.5" r="3" class="room-driver" />
        `;
  return html`
    <g class=${cls}>
      <title>${label} — ${Number(level).toFixed(1)} dBFS, ${Math.round(Number(distance) || 0)} cm</title>
      <g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg.toFixed(1)})">${box}</g>
      <text x=${lp.x.toFixed(1)} y=${(y + lp.dy1).toFixed(1)} class="room-label" text-anchor=${lp.anchor}>
        ${SHORT[index]}
      </text>
      <!-- the bare figure, no " dB": at three front channels' spacing the suffix
           made adjacent labels touch, and the unit is already on the row's own
           column header and in this speaker's tooltip -->
      <text x=${lp.x.toFixed(1)} y=${(y + lp.dy2).toFixed(1)} class="room-level" text-anchor=${lp.anchor}>
        ${Number(level).toFixed(1)}
      </text>
    </g>
  `;
}
