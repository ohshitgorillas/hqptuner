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
import { classNames } from '../model/format.js';
import { lampDots, wirePath } from '../model/wire.js';

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
      class: classNames(st.level >= 1 && 'sub', st.level === 2 && 'sub2', !st.on && 'off'),
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
  const lamps = [...rail.querySelectorAll('.st:not([hidden]) > .lamp')].map((l) => ({
    box: l.getBoundingClientRect(),
    level: Number(l.parentElement.dataset.level),
    on: l.classList.contains('on') && !l.parentElement.matches('.byp, .dead'),   // byp: not in this track's path; dead: nothing reaches it
  }));
  return lampDots({ rail: rr, lamps, scale: k });
}

function drawWire(rail, svg, style) {
  const pts = dots(rail);
  if (!pts.length) return;
  svg.setAttribute('width', rail.offsetWidth);
  svg.setAttribute('height', rail.offsetHeight);
  svg.firstElementChild.setAttribute('d', wirePath(pts, style));
}
