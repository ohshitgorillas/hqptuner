// Settings: the gear swaps the chain body (rail + page + stage drawers) for the settings body. Header, engine row and Setting
// Switcher stay (the engine row shows what Hardware acceleration does to the process speed and buffers).
//   Rail    one entry per category, the chain's stage grammar minus wire and lamps: engraved name, then that drawer's
//           settings as readouts (label | value), left-hand amber selection bar while its drawer is open. Opens its drawer.
//   Drawers drawer.js schemas (data/settings.js), the chain drawers' shell, rows and apply group. Timing, Hardware
//           acceleration and the log rows stage (restart lanes); Visual settings apply at once.
//   Page    About (engine identity, Backup / restore) + About HQPTuner: read-only, so the page under the drawers.
// Exit: the gear again, or Escape with no drawer or popover open. Entering or leaving closes every drawer.
// Readouts follow staged rows on Apply, live rows at once (the chain rail's rule).

import { h } from '../lib/dom.js';
import { PLATFORM } from '../lib/clock.js';
import { revertAfter } from '../model/timing.js';
import { rowsOf } from '../model/schema.js';
import { readoutOf, effectOf } from '../model/settings.js';
import { secHead, manPara } from '../lib/controls.js';
import { swapBody, escapeLeaves } from '../lib/builder.js';
import { mountDrawer } from './drawer.js';
import { setOptionStyle } from './vselect.js';
import { mountSignalPath, PATH_NAME } from './signal-path.js';
import { SETTINGS_RAIL, READOUT_LABEL, ABOUT, LOG_TAIL, ACCENTS, HIDEABLE, MIRROR } from '../data/settings.js';

/**
 * @param {{gear: HTMLButtonElement, chain: HTMLElement, body: HTMLElement, rail: HTMLElement, page: HTMLElement}} el
 * @param {import('../lib/bus.js').Bus} bus
 * @param {import('../lib/clock.js').Clock} [clock]
 */
export function mountSettings({ gear, chain, body, rail, page }, bus, clock = PLATFORM) {
  const readouts = new Map();   // control id → {dd, fmt}

  // ── Rail ────────────────────────────────────────────────────────────────
  for (const cat of SETTINGS_RAIL) {
    const ctls = controlsOf(cat.drawer);
    const rows = cat.show.map((id) => {
      const { c, label } = ctls.get(id);
      const dd = h('dd');
      const wide = c.type === 'text' || c.type === 'toggles';   // own line: a path, a list
      readouts.set(id, { dd, fmt: fmtOf(c) });
      dd.replaceChildren(...[].concat(readouts.get(id).fmt(String(c.value))));
      return h('div', { class: wide && 'wide' }, h('dt', { text: READOUT_LABEL[id] || label }), dd);
    });
    // A live readout that isn't a setting (Signal path: the path playing now).
    if (cat.live) {
      const dd = h('dd', { text: PATH_NAME.idle });
      bus.on('sigpath', (d) => { dd.textContent = PATH_NAME[d.p] ?? d.p; });
      rows.push(h('div', {}, h('dt', { text: cat.live }), dd));
    }
    const btn = h('button.st.sst', { type: 'button', data: { stage: cat.id } },
      h('span.n', { text: cat.name }), h('dl.sro', {}, rows));
    rail.append(btn);

    const live = cat.show.filter((id) => ctls.get(id).r.live);
    // One setting in two homes (Apply to all stations on both Hardware tabs): a change in one moves the other.
    const mirrors = [...ctls.keys()].filter((id) => MIRROR[id]).map((id) => [id, (v) => api.set(MIRROR[id], v)]);
    const api = mountDrawer(body, btn, cat.drawer, {
      blocks: { logtail: (host) => logTail(host, clock), sigpath: (host) => mountSignalPath(host, bus) },
      on: Object.fromEntries([...live.map((id) => [id, (v) => { show(id, v); effect(id, v, bus); }]), ...mirrors]),
      onApply: (v) => { for (const id of cat.show) show(id, v[id]); },
    });
    api.setOpen(false);
  }

  function show(id, v) {
    const ro = readouts.get(id);
    if (ro) ro.dd.replaceChildren(...[].concat(ro.fmt(String(v))));
  }

  mountAbout(page);

  // ── Swap ────────────────────────────────────────────────────────────────
  function setOn(on) {
    swapBody({ btn: gear, chain, body, bus }, on);
    gear.setAttribute('aria-label', on ? 'Close settings' : 'Settings');
  }
  gear.setAttribute('aria-pressed', 'false');
  gear.setAttribute('aria-label', 'Settings');
  gear.addEventListener('click', () => setOn(body.hidden));
  escapeLeaves(body, () => setOn(false));

  return { setOn };
}

/**
 * The page under the drawers. A section's .two takes left | right pairs, one grid row each (Backup / restore | its line);
 * `.span` cells take the row. About HQPlayer (renamed, its read-only line cut, expanded): the identity as a row of
 * labelled VFD windows across the full width (the Rate / Volume window grammar), then Backup / restore | its line.
 * @param {HTMLElement} page
 */
function mountAbout(page) {
  const sec = (title, ...cells) => h('section.sec', { 'aria-label': title },
    secHead('sh', title),
    h('div.two.pairs', {}, cells));
  page.append(
    sec('About HQPlayer',
      h('div.idrow.span', { role: 'list', 'aria-label': 'Engine identity' },
        ABOUT.rows.map(([k, v]) => h('div.vfd', { role: 'listitem' }, h('span.l', { text: k }), h('span.v', { text: v })))),
      h('div.inline.bkup', {},
        h('button.btn', { type: 'button', text: 'Download backup' }),
        h('button.btn', { type: 'button', text: 'Upload backup' })),
      h('div.man', {}, manPara({ text: ABOUT.backup }))),
    sec('About HQPTuner',
      h('div.stack', {}, h('span.cap', {}, `HQPTuner ${ABOUT.app} · Released under the `,
        h('a', { href: 'https://opensource.org/license/mit', target: '_blank', rel: 'noopener noreferrer', text: 'MIT License' }), '.')),
      h('div.man.prose', {}, ABOUT.prose.map((p) => manPara({ text: [].concat(p).map((x) =>
        typeof x === 'string' ? x : h('a', { href: x.href, target: '_blank', rel: 'noopener noreferrer', text: x.a })) })))),
  );
}

/** Control id → {c, r, label} across a schema (group items included). */
function controlsOf(schema) {
  const m = new Map();
  for (const r of rowsOf(schema)) {
    const add = (c) => c.id && m.set(c.id, { c, r, label: r.label });
    add(r.control);
    for (const i of r.control.items || []) add(i);
  }
  return m;
}

/** How a readout prints a value (model/settings.js readoutOf): its text, after the accent's swatch where it has one. */
function fmtOf(c) {
  return (v) => {
    const r = readoutOf(c, v, ACCENTS);
    return r.swatch === null ? r.text : [h('i.sw', { style: `--sw:${r.swatch}` }), r.text];
  };
}

// ── Visual settings that the mock acts on ──────────────────────────────────
// model/settings.js effectOf decides which effect a change causes and its values; this acts on it.
// Bottom bar: swaps the bottom bar (and the engine-row volume). Option style: every chain select's option text (Standard =
// engine names, Simplified = plain titles). Setting / Option descriptions and the Apodizing indicator are not modelled.
function effect(id, v, bus) {
  const root = document.documentElement.style;
  const fx = effectOf(id, v, ACCENTS, HIDEABLE);
  // Allow pinned rates (Behavior): shows the page's Output section, the rate pins (main.js listens).
  if (fx.kind === 'pinallow') bus.emit('pinallow', fx.on);
  if (fx.kind === 'accent') for (const [name, val] of Object.entries(fx.tokens)) root.setProperty(name, val);
  // Bottom bar: the plate's data-bottom picks Setting Switcher | Volume | None (settings.css shows / hides; the body takes
  // whatever height is freed).
  // Top of page: the page's top section (main.js paintFill listens).
  if (fx.kind === 'fill') bus.emit('vfill', fx.value);
  if (fx.kind === 'bottom') {
    document.getElementById('plate').dataset.bottom = fx.value;
    bus.emit('relayout');   // rail wire, plots re-measure
  }
  // Hide from signal chain: each listed stage leaves the chain rail (its drawer closes if open); the wire re-routes.
  if (fx.kind === 'hide') {
    for (const { id: sid, hidden } of fx.stages) {
      // The chain rail, and the Profile builder's rail (the same stages, the profile's own chain).
      for (const st of document.querySelectorAll(`:is(#rail, #prail) [data-stage="${sid}"]`)) {
        if (hidden && st.classList.contains('open')) st.click();
        st.hidden = hidden;
      }
    }
    bus.emit('relayout');
  }
  if (fx.kind === 'style') setOptionStyle(fx.value, bus);
  // Dyslexic font: the body family swaps (the font's stylesheet loads once, on first use).
  if (fx.kind === 'font') {
    if (fx.family && !document.getElementById('f-atkinson')) {
      document.head.append(h('link#f-atkinson', { rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap' }));
    }
    if (fx.family) root.setProperty('--f-body', fx.family);
    else root.removeProperty('--f-body');
  }
}

/**
 * Logging drawer: v1 LogTail, always shown — the last 50 lines + Copy; read-only, never stages.
 * @param {HTMLElement} host
 * @param {import('../lib/clock.js').Clock} clock
 */
function logTail(host, clock) {
  const copy = h('button.btn.xs', { type: 'button', text: 'Copy' });
  const pre = h('pre.logtail', { text: LOG_TAIL.mock.join('\n') });
  host.append(
    h('div.drow.ltrow', {},
      h('div.ctl', {}, h('div.fh', {}, h('b', { text: 'Live log tail' })),
        h('div.act', {}, copy)),
      h('div.man', {}, manPara({ text: LOG_TAIL.man }))),
    pre);
  const restore = revertAfter(1500, () => { copy.textContent = 'Copy'; }, clock);
  copy.addEventListener('click', () => { copy.textContent = 'Copied'; restore(); });
  clock.requestAnimationFrame(() => { pre.scrollTop = pre.scrollHeight; });
}
