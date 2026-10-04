// Speakers drawer body (under the Speakers Off/On row, a plain schema row).
//   Left   Speaker set (v1: which channels you are configuring; the daemon keeps all eight either way, so it is a view
//          choice and never stages) + one row per channel in the set: name, level (dBFS), distance (cm). Rows stage.
//   Right  v1's top-down room plan: the listener faces up the page, each speaker at its layout angle, toed in, at a radius
//          set by its own distance (6 m spans the ring); the box fits the set's speakers, centred on the listener;
//          level rides as a label. Only the set's channels are drawn: v1 drew the rest dimmed, but at the
//          daemon's default distance (0) they pile onto the listener.

import { h, s } from '../lib/dom.js';
import { withXref } from '../lib/xref.js';
import { numBox } from '../lib/controls.js';
import { headGlyph, speakerGlyph } from '../lib/glyphs.js';
import { minus } from '../model/format.js';

const CX = 0, CY = 0, HEAD = 13, R_MAX = 122, DIST_FULL = 600, SUB_OUT = 1.35, SUB_MAX = 140;

/**
 * @param {HTMLElement} host
 * @param {object} cfg   SPEAKERS + SETS
 * @param {{set:Function, init:Function, watch:Function}} ctx
 * @param {(set:object) => void} onSet   the set changed (rail value)
 */
export function mountSpeakers(host, cfg, ctx, onSet) {
  const ch = cfg.channels.map((c) => ({ ...c }));
  let set = cfg.sets.find((x) => x.id === cfg.set);
  ch.forEach((c, i) => { ctx.init(`spl${i}`, c.level); ctx.init(`spd${i}`, c.distance); });

  const setSel = h('select.vfd.spset', { 'aria-label': 'Speaker set' },
    cfg.sets.map((x) => h('option', { value: x.id, text: x.label, selected: x.id === set.id })));
  setSel.addEventListener('change', () => { set = cfg.sets.find((x) => x.id === setSel.value); rows(); plan(); onSet(set); });

  const num = (i, k, step, unit) => {
    const { el, input } = numBox({ step, value: ch[i][k], aria: `${ch[i].name} ${k}`, unit });
    input.addEventListener('change', () => { ch[i][k] = Number(input.value); ctx.set(`sp${k[0]}${i}`, ch[i][k]); plan(); });
    return el;
  };
  const cells = ch.map((c, i) => ({ level: num(i, 'level', 0.1, 'dBFS'), distance: num(i, 'distance', 1, 'cm') }));
  // Discard (mock): every channel's level and distance go back; the plan follows.
  ctx.onDiscard((b) => {
    ch.forEach((c, i) => {
      c.level = Number(b[`spl${i}`]); c.distance = Number(b[`spd${i}`]);
      cells[i].level.querySelector('input').value = c.level; cells[i].distance.querySelector('input').value = c.distance;
    });
    plan();
  });
  const rowsHost = h('div.sprows');
  function rows() {
    rowsHost.replaceChildren(...set.channels.map((i) =>
      h('div.sprow', {}, h('span.spn', { text: ch[i].name }), cells[i].level, cells[i].distance)));
  }

  const svg = s('svg.spplan', { role: 'img', 'aria-label': 'Room plan' });
  host.append(h('div.spbody', {},
    h('div.spleft', {}, h('label.ci', {}, h('span.cl', { text: 'Speaker set' }), setSel), rowsHost),
    h('div.spright', {}, svg)));

  const radius = (i, d) => {
    const r = HEAD + (Math.max(0, Math.min(DIST_FULL, d)) / DIST_FULL) * (R_MAX - HEAD);
    return i === 3 ? Math.min(r * SUB_OUT, SUB_MAX) : r;
  };
  function plan() {
    const pts = set.channels.map((i) => {
      const c = ch[i], a = cfg.layout[i] * Math.PI / 180, r = radius(i, c.distance);
      return { c, i, deg: cfg.layout[i], x: CX + r * Math.sin(a), y: CY - r * Math.cos(a), on: true };
    });
    // Fit the box to what is drawn (v1), centred on the listener so left/right and front/back stay true to each other.
    const R = Math.max(HEAD + 20, ...pts.map((p) => Math.max(Math.abs(p.x) + 26, Math.abs(p.y) + 40)));
    svg.setAttribute('viewBox', `${-R} ${-R} ${2 * R} ${2 * R}`);
    svg.replaceChildren(...[
      headGlyph(CX, CY, HEAD, 5),
      // Out-of-set first so the set's speakers draw on top.
      pts.map((p) => s('g', { class: `spk ${p.on ? '' : 'off'}` },
        speakerGlyph(p.x, p.y, p.deg, p.i === 3),
        s('text.sl', { x: p.x, y: p.y + 22, 'text-anchor': 'middle', text: p.c.short }),
        s('text.sv', { x: p.x, y: p.y + 33, 'text-anchor': 'middle', text: minus(p.c.level, 1) }))),
    ].flat(2).filter(Boolean));
  }

  // Direct SDM playing (mock scenario): the level trims do nothing, the delays still apply (v1 Card.js): the level column
  // grays with v1's note under the rows (it links to DSD playback, where Direct SDM is set); distances stay live.
  const sdmNote = h('p.spsdm', { hidden: true });
  rowsHost.after(sdmNote);
  function direct(on, why) {
    sdmNote.hidden = !on;
    sdmNote.replaceChildren(...(on ? withXref(why) : []));
    for (const c of cells) c.level.querySelector('input').disabled = on;
    host.querySelector('.spleft').classList.toggle('sdm', on);
  }

  rows();
  plan();
  onSet(set);
  return { direct };
}
