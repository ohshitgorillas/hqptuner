// Wire and map geometry, free of the DOM: where the chain rail's lamp dots land and the path joining them, the frame a
// signal-path group draws around its nodes, and which map nodes and edges read lit or bypassed. A test drives these
// from tables.

const CHAMFER = 5;

/**
 * A measured box in screen px (a DOMRect satisfies it).
 *
 * @typedef {object} Box
 * @property {number} left
 * @property {number} top
 * @property {number} width
 * @property {number} height
 */

/**
 * One rail lamp as measured: its box, its stage's nesting level, and whether the wire taps it.
 *
 * @typedef {object} Lamp
 * @property {Box} box
 * @property {number} level
 * @property {boolean} on
 */

/**
 * A lamp's dot in rail layout px, on the half pixel so a 1.5 px stroke lands crisp.
 *
 * @typedef {object} Dot
 * @property {number} x
 * @property {number} y
 * @property {number} level
 * @property {boolean} on
 */

/**
 * The dots of the rail's lamps, in rail layout px from the rail's corner.
 *
 * @param {{rail: Box, lamps: Lamp[], scale: number}} o
 * @returns {Dot[]}
 */
export function lampDots({ rail, lamps, scale }) {
  return lamps.map(({ box, level, on }) => ({
    x: Math.round((box.left + box.width / 2 - rail.left) / scale) + 0.5,
    y: Math.round((box.top + box.height / 2 - rail.top) / scale) + 0.5,
    level,
    on,
  }));
}

/**
 * One path visiting every dot in order, turning on chamfered elbows between columns.
 *
 * @param {Dot[]} pts
 * @param {string[]} d
 */
function routed(pts, d) {
  const c = CHAMFER;
  d.push(`M${pts[0].x},${pts[0].y}`);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i];
    if (Math.abs(a.x - b.x) < 1) {
      d.push(`L${b.x},${b.y}`);
      continue;
    }
    const sx = b.x > a.x ? 1 : -1;
    const ym = sx > 0 ? b.y - 11 : Math.round((a.y + b.y) / 2) + 0.5;
    d.push(
      `L${a.x},${ym - c}`,
      `L${a.x + sx * c},${ym}`,
      `L${b.x - sx * c},${ym}`,
      `L${b.x},${ym + c}`,
      `L${b.x},${b.y}`,
    );
  }
}

/**
 * The engaged children one level under the parent at `i`.
 *
 * @param {Dot[]} pts
 * @param {number} i
 * @returns {Dot[]}
 */
function engagedKids(pts, i) {
  const parent = pts[i];
  const kids = [];
  for (let j = i + 1; j < pts.length && pts[j].level > parent.level; j++) {
    if (pts[j].level === parent.level + 1 && pts[j].on) kids.push(pts[j]);
  }
  return kids;
}

/**
 * A vertical trunk through the top-level dots; each engaged parent drops a bus at its own x to its engaged children,
 * the last joining on a chamfered elbow unless the trunk continues past it.
 *
 * @param {Dot[]} pts
 * @param {string[]} d
 */
function trunk(pts, d) {
  const c = CHAMFER;
  const top = pts.filter((p) => p.level === 0);
  const trunkEnd = top[top.length - 1];
  d.push(`M${top[0].x},${top[0].y}`, `L${trunkEnd.x},${trunkEnd.y}`);
  pts.forEach((parent, i) => {
    if (!parent.on) return;
    const kids = engagedKids(pts, i);
    if (!kids.length) return;
    const last = kids[kids.length - 1];
    const busContinues = parent.level === 0 && trunkEnd.y > last.y;
    for (const k of kids) {
      if (k === last && !busContinues)
        d.push(`M${parent.x},${parent.y}`, `L${parent.x},${k.y - c}`, `L${parent.x + c},${k.y}`, `L${k.x},${k.y}`);
      else d.push(`M${parent.x},${k.y}`, `L${k.x},${k.y}`);
    }
  });
}

/**
 * SVG path data for the wire joining the rail's dots, in either wire style.
 *
 * @param {Dot[]} pts   at least one dot
 * @param {'trunk' | 'routed'} style
 * @returns {string}
 */
export function wirePath(pts, style) {
  /** @type {string[]} */
  const d = [];
  if (style === "routed") routed(pts, d);
  else trunk(pts, d);
  return d.join(" ");
}

/**
 * A point in map px.
 *
 * @typedef {object} Point
 * @property {number} x
 * @property {number} y
 */

/**
 * The hairline frame around a group's node boxes and where its title and subtitle sit.
 *
 * @param {{boxes: Box[], sub: boolean}} o
 * @returns {{frame: {x: number, y: number, width: number, height: number}, title: Point, sub: Point}}
 */
export function groupFrame({ boxes, sub }) {
  const x0 = Math.min(...boxes.map((b) => b.left)) - 9,
    x1 = Math.max(...boxes.map((b) => b.left + b.width)) + 9;
  const y0 = Math.min(...boxes.map((b) => b.top)) - (sub ? 46 : 30),
    y1 = Math.max(...boxes.map((b) => b.top + b.height)) + 12;
  return {
    frame: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    title: { x: x0 + 9, y: y0 + 18 },
    sub: { x: x0 + 9, y: y0 + 34 },
  };
}

/**
 * A map node; `rail` is the chain stage whose lamp says engaged.
 *
 * @typedef {object} MapNode
 * @property {string} id
 * @property {string} [rail]
 */

/**
 * A map edge between two node ids; `direct` marks the Direct SDM bypass, lit only on that path.
 *
 * @typedef {object} MapEdge
 * @property {string} a
 * @property {string} b
 * @property {boolean} [direct]
 */

/**
 * Which nodes read lit (on the path playing) or bypassed (on it but not running), and which edges read lit. A node in
 * `matrix` is bypassed while the `matrix` stage is disengaged; a node with its own rail stage, while that stage is.
 *
 * @param {{lit: Set<string>, engaged: Set<string>, nodes: MapNode[], edges: MapEdge[], matrix: string[], direct: boolean}} o
 * @returns {{nodes: Record<string, {lit: boolean, off: boolean}>, edges: boolean[]}}
 */
export function pathLamps({ lit, engaged, nodes, edges, matrix, direct }) {
  /** @type {Record<string, {lit: boolean, off: boolean}>} */
  const byId = {};
  for (const { id, rail } of nodes) {
    const gated =
      (matrix.includes(id) && !engaged.has("matrix")) || (!!rail && rail !== "matrix" && !engaged.has(rail));
    byId[id] = { lit: lit.has(id), off: lit.has(id) && gated };
  }
  return { nodes: byId, edges: edges.map((e) => (e.direct ? direct : lit.has(e.a) && lit.has(e.b))) };
}
