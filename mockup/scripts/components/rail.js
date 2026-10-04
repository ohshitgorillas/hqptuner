// Signal-chain rail: stage buttons from CHAIN data + the silkscreen wire joining their dots.
//
// Wire styles:
//   trunk (default)  vertical trunk through the top-level dots; each engaged parent drops a bus at its own x
//                    to its engaged children; the last child joins on a 45° chamfered elbow unless the trunk
//                    continues past it. Off stages get no tap; an off parent's subtree gets no bus.
//   routed (#routed) one path visiting every dot in order.
// .byp (mock scenario): an engaged stage this track's path doesn't run (Direct SDM: everything but Speakers). Its lamp
// reads unlit and the wire drops its tap, as for an off stage; its own engaged state is kept (the class only overlays it).
// .dead (alerts.js): the same look for stages nothing reaches (an SDM modulator below its rate floor: no output).
// [data-alert] (alerts.js): the lamp blinks red (crit) or amber (warn) over whatever state it is in.

import { h } from '../lib/dom.js';
import { scale } from '../lib/plate.js';

const CHAMFER = 5;

/**
 * @param {HTMLElement} rail  nav.rail containing svg.wire
 * @param {object[]} chain    CHAIN data
 * @param {'trunk'|'routed'} style   wire style (model/flags.js `wire`)
 * @param {import('../lib/bus.js').Bus} bus   the wire redraws on `relayout`
 * @returns {Map<string, HTMLButtonElement>} stage buttons by id
 */
export function mountRail(rail, chain, style, bus) {
  const stages = new Map();
  for (const st of chain) {
    const btn = h('button.st', {
      type: 'button',
      class: [st.level >= 1 && 'sub', st.level === 2 && 'sub2', !st.on && 'off'].filter(Boolean).join(' '),
      data: { stage: st.id, level: st.level },
    },
      h('span.lamp', { class: st.on && 'on' }),
      h('span.n', { text: st.name }),
      st.value !== undefined && h('span.v', { text: st.value }),
    );
    if (st.hidden) btn.hidden = true;
    rail.append(btn);
    stages.set(st.id, btn);
  }

  const svg = rail.querySelector('.wire');
  const redraw = () => drawWire(rail, svg, style);
  redraw();
  bus.on('relayout', redraw);
  window.addEventListener('load', redraw);
  document.fonts?.ready.then(redraw);
  return stages;
}

function dots(rail) {
  const rr = rail.getBoundingClientRect();
  const k = scale();
  return [...rail.querySelectorAll('.st:not([hidden]) > .lamp')].map((l) => {
    const b = l.getBoundingClientRect();
    return {
      x: Math.round((b.left + b.width / 2 - rr.left) / k) + 0.5,   // +.5 = crisp 1.5px stroke on the pixel grid
      y: Math.round((b.top + b.height / 2 - rr.top) / k) + 0.5,
      level: Number(l.parentElement.dataset.level),
      on: l.classList.contains('on') && !l.parentElement.matches('.byp, .dead'),   // byp: not in this track's path; dead: nothing reaches it
    };
  });
}

function drawWire(rail, svg, style) {
  const pts = dots(rail);
  if (!pts.length) return;
  const d = [];
  const M = (x, y) => d.push(`M${x},${y}`);
  const L = (x, y) => d.push(`L${x},${y}`);
  const c = CHAMFER;

  if (style === 'routed') {
    M(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (Math.abs(a.x - b.x) < 1) { L(b.x, b.y); continue; }
      const sx = b.x > a.x ? 1 : -1;
      const ym = sx > 0 ? b.y - 11 : Math.round((a.y + b.y) / 2) + 0.5;
      L(a.x, ym - c); L(a.x + sx * c, ym); L(b.x - sx * c, ym); L(b.x, ym + c); L(b.x, b.y);
    }
  } else {
    const top = pts.filter((p) => p.level === 0);
    const trunkEnd = top[top.length - 1];
    M(top[0].x, top[0].y); L(trunkEnd.x, trunkEnd.y);
    pts.forEach((parent, i) => {
      if (!parent.on) return;
      const kids = [];
      for (let j = i + 1; j < pts.length && pts[j].level > parent.level; j++) {
        if (pts[j].level === parent.level + 1 && pts[j].on) kids.push(pts[j]);
      }
      if (!kids.length) return;
      const last = kids[kids.length - 1];
      const busContinues = parent.level === 0 && trunkEnd.y > last.y;
      for (const k of kids) {
        if (k === last && !busContinues) { M(parent.x, parent.y); L(parent.x, k.y - c); L(parent.x + c, k.y); L(k.x, k.y); }
        else { M(parent.x, k.y); L(k.x, k.y); }
      }
    });
  }

  svg.setAttribute('width', rail.offsetWidth);
  svg.setAttribute('height', rail.offsetHeight);
  svg.firstElementChild.setAttribute('d', d.join(' '));
}
