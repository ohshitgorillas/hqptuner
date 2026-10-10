// The Signal path drawer (Settings → Signal path): every path HQPlayer can take, one map, the path playing now lit, with
// the key under it. Read-only: nothing stages. The nodes, edges and lamps are the store's
// (store/faceplate/settings/sigpath.js, decided from railNow); this draws them: rate zones, group frames, the Direct
// SDM bypass, the edges and the nodes, in that order.

import { html } from "../../../lib/dom.js";
import { useTextBox } from "../KnockedText.js";
import { knockout } from "../../../model/gauges/knockout.js";
import { classNames } from "../../../model/shell/format.js";
import { groupFrame } from "../../../model/gauges/wire.js";
import { NODES, EDGES, signalMap } from "../../../store/faceplate/settings/sigpath.js";
import { railNow } from "../../../store/faceplate/chain.js";

/** @typedef {import("../../../store/faceplate/settings/sigpath.js").SgNode} SgNode */
/** @typedef {import("../../../store/faceplate/settings/sigpath.js").SgEdge} SgEdge */
/** @typedef {import("../../../store/faceplate/settings/sigpath.js").SignalMap} SignalMap */
/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/xref.js").XrefHere} XrefHere */

const W = 1040,
  H = 606;
const ZONE_Y = 22; // the rate zones' labels
const NW = 118,
  NH = 50;
const HATCH = "sg-hatch";

/**
 * Group frames: engraved title over a hairline box.
 * @type {{ label: string, ids: string[], sub?: string }[]}
 */
const GROUPS = [
  { label: "DSD Processing", ids: ["nf", "de", "rm"] },
  { label: "Matrix engine", ids: ["pl", "xf", "ld"] },
  { label: "Resampling", ids: ["f1", "fn", "rc"] },
  { label: "Shaping", ids: ["di", "mo"] },
];

// DRAFT (agent): the drawer's key, one line per mark.
/** @type {[string, string][]} */
const KEY = [
  ["lit", "Playing now"],
  ["tag", "PCM or SDM: that output mode only"],
  ["tags", "Both output modes, a separate list each"],
  ["hatch", "Bypassed"],
  ["dash", "Position not confirmed (output rate, before Shaping)"],
];

/** The nodes by id. @type {Record<string, SgNode>} */
const N = Object.fromEntries(NODES.map((n) => [n.id, n]));

const L = (/** @type {SgNode} */ n) => n.x - NW / 2,
  R = (/** @type {SgNode} */ n) => n.x + NW / 2,
  T = (/** @type {SgNode} */ n) => n.y - NH / 2,
  B = (/** @type {SgNode} */ n) => n.y + NH / 2;
const box = (/** @type {SgNode} */ n) => ({ left: L(n), top: T(n), width: NW, height: NH });

/** The Signal path drawer: one tab, the map. @type {DrawerSchema} */
export const SIGPATH_DRAWER = {
  id: "sigpath",
  title: "Signal path",
  aria: "Signal path",
  tabs: [{ id: "sigpath", label: "Signal path", body: [{ block: "sigpath" }] }],
};

/** The Settings rail's live readout: the path playing now. */
export const SIGPATH_LIVE = { label: "Playing", value: () => signalMap(railNow()).name };

/** The hatch pattern a bypassed node is filled with: 45° stripes every 6 units over a backing square. */
const Hatch = () => html`
  <defs>
    <pattern id=${HATCH} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect class="sghb" width="6" height="6" />
      <line class="sghl" x1="0" y1="0" x2="0" y2="6" />
    </pattern>
  </defs>
`;

/**
 * Rate zones: everything before Resampling runs at the source rate (DSD: after decimation, 1/16 of it), everything after
 * at the output rate. Resampling is the seam: it converts one to the other. Tinted bands under the map, seam dashed.
 */
function Zones() {
  const seam = N.f1.x;
  return html`
    <rect class="sgz zs" x="0" y="0" width=${seam} height=${H - 34} rx="6" />
    <rect class="sgz zo" x=${seam} y="0" width=${W - seam} height=${H - 34} rx="6" />
    <line class="sgseam" x1=${seam} y1="0" x2=${seam} y2=${H - 34} />
    <text class="sgzt" x="12" y=${ZONE_Y}>SOURCE RATE</text>
    <text class="sgzt" x=${W - 12} y=${ZONE_Y} text-anchor="end">OUTPUT RATE</text>
  `;
}

/** Each group's frame and engraved title, and its subtitle where it has one. */
const Groups = () =>
  GROUPS.map((g) => {
    const { frame, title, sub } = groupFrame({ boxes: g.ids.map((id) => box(N[id])), sub: !!g.sub });
    return html`
      <rect class="sgg" ...${frame} rx="5" />
      <text class="sggt" x=${title.x} y=${title.y}>${g.label.toUpperCase()}</text>
      ${g.sub ? html`<text class="sggs" x=${sub.x} y=${sub.y}>${g.sub}</text>` : null}
    `;
  });

const BYPASS_Y = H - 18,
  BYPASS_X = W - 8,
  BYPASS_R = 10;
const BYPASS = EDGES.find((e) => e.direct); // the Direct SDM bypass, labelled along the foot
const KNOCK = "sg-knock"; // the clip that holds the edges off the bypass label

/**
 * Where an edge runs: the Direct SDM bypass down under everything from the DSD source, along the foot, up the right edge
 * and into Speakers' right side (Output hangs under Speakers); a vertical edge bottom to top; the rest a curve from the
 * right side of one node to the left side of the next.
 *
 * @param {SgEdge} e
 * @returns {string}
 */
function edgePath(e) {
  const na = N[e.a],
    nb = N[e.b];
  if (e.direct) {
    const yb = BYPASS_Y,
      xr = BYPASS_X,
      r = BYPASS_R;
    return `M ${na.x} ${B(na)} V ${yb - r} Q ${na.x} ${yb} ${na.x + r} ${yb} H ${xr - r} Q ${xr} ${yb} ${xr} ${yb - r} V ${nb.y + r} Q ${xr} ${nb.y} ${xr - r} ${nb.y} H ${R(nb)}`;
  }
  if (e.vertical) return `M ${na.x} ${B(na)} V ${T(nb)}`;
  const x0 = R(na),
    x1 = L(nb),
    mx = (x0 + x1) / 2;
  return `M ${x0} ${na.y} C ${mx} ${na.y} ${mx} ${nb.y} ${x1} ${nb.y}`;
}

/**
 * Every edge, each lit while the path playing runs it, and the Direct SDM bypass's label. The label is letter-spaced and
 * sits on the drawer's gradient, which no flat fill matches, so its knockout is a hole clipped out of the edges rather
 * than a patch painted over them.
 *
 * @param {{ map: SignalMap }} props
 */
function Edges({ map }) {
  const [label, labelBox] = useTextBox();
  const k = labelBox === null ? null : knockout(labelBox);
  return html`
    ${
      k === null
        ? null
        : html`<clipPath id=${KNOCK}>
            <path clip-rule="evenodd" d=${`M0 0 H${W} V${H} H0 Z M${k.x} ${k.y} h${k.width} v${k.height} h${-k.width} Z`} />
          </clipPath>`
    }
    <g clip-path=${k === null ? undefined : `url(#${KNOCK})`}>
      ${EDGES.map(
        (e, i) =>
          html`<path class=${classNames("sge", map.edges[i] && "lit")} data-a=${e.a} data-b=${e.b} d=${edgePath(e)} />`,
      )}
    </g>
    ${
      BYPASS
        ? html`<text ref=${label} class="sgel" x=${(N[BYPASS.a].x + BYPASS_X) / 2} y=${BYPASS_Y + 5} text-anchor="middle">DIRECT SDM</text>`
        : null
    }
  `;
}

/**
 * A node's output-mode tag, at its top right corner.
 *
 * @param {{ n: SgNode, tag: string }} props
 */
function Tag({ n, tag }) {
  const tw = tag.length * 7.6 + 10;
  return html`
    <rect class="sgtb" x=${R(n) - tw + 6} y=${T(n) - 9} width=${tw} height="17" rx="2" />
    <text class="sgt" x=${R(n) - tw / 2 + 6} y=${T(n) + 4} text-anchor="middle">${tag}</text>
  `;
}

/**
 * One node: its box, the hatch over it, its label, sub-label and output-mode tag, lit or bypassed as the map reads it.
 *
 * @param {{ n: SgNode, lamp: { lit: boolean, off: boolean } }} props
 */
function Node({ n, lamp }) {
  const cls = classNames("sgn", n.unv && "unv", lamp.lit && "lit", lamp.off && "off");
  return html`
    <g class=${cls} data-id=${n.id}>
      <rect x=${L(n)} y=${T(n)} width=${NW} height=${NH} rx=${n.src ? NH / 2 : 4} />
      <rect class="hx" x=${L(n)} y=${T(n)} width=${NW} height=${NH} rx="4" />
      <text class="sgl" x=${n.x} y=${n.sub ? n.y - 3 : n.y + 6} text-anchor="middle">${n.label}</text>
      ${n.sub ? html`<text class="sgs" x=${n.x} y=${n.y + 15} text-anchor="middle">${n.sub}</text>` : null}
      ${n.tag ? html`<${Tag} n=${n} tag=${n.tag} />` : null}
    </g>
  `;
}

/**
 * The Signal path drawer's block: the map, lit for what runs now, then the key, one line per mark.
 *
 * @param {{ schema: DrawerSchema, here: XrefHere }} _props
 */
export function SignalPathBlock(_props) {
  const map = signalMap(railNow());
  return html`
    <svg
      class="sgp"
      viewBox=${`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMin meet"
      role="img"
      aria-label="Signal path"
    >
      <${Hatch} />
      <${Zones} />
      <${Groups} />
      <${Edges} map=${map} />
      ${NODES.map((n) => html`<${Node} n=${n} lamp=${map.nodes[n.id]} />`)}
    </svg>
    <div class="sgkey">${KEY.map(([k, t]) => html`<span><i class=${`k-${k}`}></i>${t}</span>`)}</div>
  `;
}

/** The components the drawer's blocks mount, by name. */
export const SIGPATH_BLOCKS = { sigpath: SignalPathBlock };
