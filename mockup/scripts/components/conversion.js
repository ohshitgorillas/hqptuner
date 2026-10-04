// Page home of the filters + shaper (Resampling and Shaping sections), the output Mode segment, and the mock
// cross-effects between them and the stage drawers (DSD Processing, Resampling, Shaping: one state, two homes).
//
// The page shows what runs: the running chain is the one the source plays through (SDM mode → SDM chain, PCM → PCM; a
// daemon left in Auto ([source]) elsewhere → the source's family). Only that chain shows. One field is open per section, the rest are one-line folds, so expanding never changes the height. The rail Resampling / Shaping values
// name what runs now. The drawer opens on the same running chain (setRunning).
//
// Mock scenario (data/scenarios.js, the switch above the plate): what plays decides which field runs. A field that isn't
// in this track's path reads `· idle` and its select dims: both filters and the shaper when nothing plays, the 1x filter
// at 192 kHz (Nx runs), the filters and shaper on a DSD → SDM path (remodulation, or Direct: nothing). The section stays
// (nothing hides). The rail names what runs in each slot: on DSD → SDM, Resampling = SDM → SDM
// conversion and Shaping = the integrator …: a processed DSD path adds one conversion stage ahead of
// Resampling (manual 6.1.0: one block of settings), see rail(). The DSD settings never reach the page (not live).
// The path is reported out (hosts.onPath).

import { h } from '../lib/dom.js';
import { optCopy, fitCopy } from './vselect.js';
import { chainPick } from './chain-pick.js';
import { FIELDS, CHAIN_LISTS, CHAIN_NAMES, runningChain } from '../data/conversion.js';
import { pathOf } from '../data/scenarios.js';
import { subscribe } from '../lib/narrow.js';
import { PLATFORM } from '../lib/clock.js';
import { scale } from '../lib/plate.js';
import {
  FIT_PASSES, bothRows, fieldRuns, fitStep, openOn, overrunOf, overruns, railValues, sectionRows,
} from '../model/conversion.js';

/**
 * @typedef {object} ConvState  one mounted page's state, shared by the helpers below
 * @property {object} hosts
 * @property {Function} out
 * @property {object} scene
 * @property {Record<string, string>} vals
 * @property {string} mode
 * @property {boolean} direct     DSD playback as applied (Direct SDM)
 * @property {string} reported
 * @property {object | null} drawer
 * @property {import('../model/conversion.js').Open | null} open
 * @property {boolean} both
 * @property {{ host: HTMLElement, ch: string, k: string }[]} copies  the open fields' copy
 */

const running = (st) => runningChain(st.mode, { playing: st.scene.playing, family: st.scene.family });
const path = (st) => pathOf(st.scene, running(st), st.direct);
/** What plays: the running chain, the scenario path, the filter stage the source rate selects. */
const playOf = (st) => ({ run: running(st), path: path(st), stage: st.scene.stage });
// The page shows the running chain only. Auto ([source]) isn't offered; when the daemon reports it (set elsewhere) the
// page still shows just the chain it runs now (the drawer holds both chains, as always).
const chains = (st) => [running(st)];
const tag = () => null;
// Idle: every field this track's path doesn't run.
const idle = (st, ch, k) => !fieldRuns(playOf(st), ch, k);
const why = (st, f, ch, k) => (idle(st, ch, k) ? f.sub + ' · idle' : f.sub);
const listOf = (ch, k) => (k === 'sh' ? CHAIN_LISTS[ch].shapers : CHAIN_LISTS[ch].filters);
const fieldOf = (ch, k) => (k === 'sh' ? FIELDS[ch + 'sh'] : FIELDS[k]);

/** The page's picker: nameplate + knob + siblings (components/chain-pick.js). */
function pick(st, id, ch, k, aria) {
  return chainPick({ id: 'pg-' + id, aria, idle: idle(st, ch, k), value: st.vals[id], stage: k === 'nx' ? 'nx' : '1x',
    list: k === 'sh' ? (ch === 'sdm' ? 'modulators' : 'dithers') : ch + 'Filters',
    onChange: (v) => { update(st, id, v); st.drawer?.set(id, v); } });
}

/** One-line fold (▸): names a field or a chain, its value at the right; tapping it opens it. */
function line(name, ch, whyText, value, onOpen) {
  return h('button.fline', { type: 'button', on: { click: onOpen } },
    h('b', { text: name }), tag(ch), whyText && h('span', { text: whyText }), h('span.fn', { text: value }));
}

/** The open field: head + select (dim while idle). Its copy goes to the section's right column. */
function field(st, ch, k) {
  const f = fieldOf(ch, k), id = ch + k;
  // What narrowing leaves of the list reads in the nameplate (`4 of 21`), so the head carries no count.
  return [h('div.fh', {}, h('b', { text: f.label }), tag(ch), h('span.s', { text: why(st, f, ch, k) })), pick(st, id, ch, k, f.label)];
}

function copyOf(st, ch, k) {
  const host = h('div.man', {}, optCopy(listOf(ch, k), st.vals[ch + k]));
  st.copies.push({ host, ch, k });
  return host;
}

/**
 * Keep every section on the plate: while the page's last section runs past its bottom, the tallest open copy gives up
 * the overrun (its prose cut short, `… see more` opens it whole). Matrix engine's plot is the stretch and has its
 * 150px floor, so in PCM a long option line is what would push Output off.
 */
function fit(st) {
  const page = st.hosts.rs.closest('main');
  if (!page || !page.offsetParent) return;
  const k = scale();
  const overrun = () => {
    const kids = [...page.children].filter((c) => c.offsetParent);
    return overrunOf({ bottoms: kids.map((c) => c.getBoundingClientRect().bottom),
      pageBottom: page.getBoundingClientRect().bottom, scale: k, padding: parseFloat(getComputedStyle(page).paddingBottom) });
  };
  for (const c of st.copies) c.host.replaceChildren(...optCopy(listOf(c.ch, c.k), st.vals[c.ch + c.k]).filter(Boolean));
  const measure = (c) => ({ height: c.host.offsetHeight, left: c.host.previousElementSibling.offsetHeight });
  for (let i = 0; i < FIT_PASSES && overruns(overrun()); i++) {
    const step = fitStep(st.copies.map(measure), overrun());
    if (!step) break;
    const c = st.copies[step.index];
    fitCopy(c.host, listOf(c.ch, c.k), st.vals[c.ch + c.k], step.height);
  }
}

/** Resampling: one field open (the open chain's other filter and every other chain folded), or both filters open. */
function renderResampling(st, cs) {
  const o = st.open.rs;
  const chainLine = (ch) => line(CHAIN_NAMES[ch], null, ch === running(st) ? '' : 'idle', st.vals[ch + '1x'], () => { o.chain = ch; o.field = '1x'; render(st); });
  if (st.both) {
    // One row per filter (field | its copy).
    const { fields, others } = bothRows(cs, o.chain);
    st.hosts.rs.replaceChildren(h('div.rsboth', {},
      fields.map(({ ch, k }) => h('div.two', {}, h('div.fld', {}, field(st, ch, k)), copyOf(st, ch, k))),
      others.length > 0 && h('div.two', {}, h('div.fld', {}, others.map(chainLine)))));
  } else {
    const left = sectionRows(cs, o, ['1x', 'nx']).flatMap(({ kind, ch, k }) => (kind === 'field' ? field(st, ch, k)
      : kind === 'line' ? [line(FIELDS[k].label, ch, why(st, FIELDS[k], ch, k), st.vals[ch + k], () => { o.field = k; render(st); })]
        : [chainLine(ch)]));
    st.hosts.rs.replaceChildren(h('div.two', {}, h('div.fld', {}, left), copyOf(st, o.chain, o.field)));
  }
}

/** Shaping: the open chain's shaper open, every other chain's folded. */
function renderShaping(st, cs) {
  const sl = sectionRows(cs, { chain: st.open.sh, field: 'sh' }, ['sh']).flatMap(({ kind, ch }) => (kind === 'field' ? field(st, ch, 'sh')
    : [line(fieldOf(ch, 'sh').label, ch, ch === running(st) ? '' : 'idle', st.vals[ch + 'sh'], () => { st.open.sh = ch; render(st); })]));
  st.hosts.sh.replaceChildren(h('div.two', {}, h('div.fld', {}, sl), copyOf(st, st.open.sh, 'sh')));
}

function render(st) {
  st.copies.length = 0;
  const cs = chains(st);
  if (!st.open) st.open = openOn(playOf(st), cs[0]);
  renderResampling(st, cs);
  renderShaping(st, cs);
  rail(st);
  fit(st);
}

/** A stage name that wraps (the DSD conversion stage) puts its lamp on the first line; re-measured once fonts land. */
function wraps(hosts) {
  for (const id of ['dsd', 'resampling', 'shaping']) {
    const n = hosts.stages.get(id).querySelector('.n');
    n.parentElement.classList.toggle('wrap', n.offsetHeight > 30);
  }
}

function rail(st) {
  const { hosts } = st;
  const play = playOf(st), { run, path: p } = play;
  const r = railValues(play, st.direct, st.vals);
  // DSD Processing: always on the rail (hideable); in this track's path only on a processed DSD source.
  const dsd = hosts.stages.get('dsd');
  dsd.classList.toggle('byp', !r.dsdInPath);
  dsd.querySelector('.v').textContent = r.dsd;
  // Direct: Resampling and Shaping aren't in the path, so they leave the chain while it plays.
  let moved = false;
  for (const id of ['resampling', 'shaping']) {
    const stage = hosts.stages.get(id);
    if (stage.hidden !== r.offChain) { stage.hidden = r.offChain; moved = true; }
  }
  const rn = hosts.stages.get('resampling').querySelector('.n'), name = r.rateConversion ? 'Rate conversion' : 'Resampling';
  if (rn.textContent !== name) { rn.textContent = name; moved = true; }
  if (moved) hosts.bus.emit('relayout');   // rail wire redraws
  hosts.stages.get('resampling').querySelector('.v').textContent = r.resampling;
  hosts.stages.get('shaping').querySelector('.v').textContent = r.shaping;
  wraps(hosts);
  const o = st.out(run, p, st.scene);
  hosts.onOut?.({ mode: st.mode, run, tier: o.tier, rate: o.rate, rest: o.rest });   // the page's Output tuner
  hosts.onRun?.(run);
  hosts.stages.get('output').querySelector('.v').textContent = o.value;
  const key = `${st.scene.id}|${p}|${run}`;
  if (key !== st.reported) { st.reported = key; hosts.onPath?.(p, run, st.scene); }
}

/** A filter or shaper changed (drawer or page): the page re-renders (what is open stays open), then the rail. */
function update(st, id, v) {
  st.vals[id] = v;
  render(st);
}

/** The scenario switch, or DSD playback applied (Direct): the path changes; the running chain may too (a daemon in Auto). */
function setScene(st, sc, dir) {
  st.scene = sc; st.direct = dir;
  st.open = null;
  st.drawer?.setRunning(running(st));
  render(st);
}

function setMode(st, m) {
  if (m === st.mode) return;
  st.mode = m;
  st.open = null;   // a new mode opens on its running 1x and shaper
  st.drawer?.setRunning(running(st));
  render(st);
}

/** What the engine runs now (Snapshot builder's Live column): mode, running chain, both chains' picks. */
function state(st) {
  const { vals } = st;
  return { mode: st.mode, run: running(st), pcm: { '1x': vals.pcm1x, nx: vals.pcmnx, sh: vals.pcmsh }, sdm: { '1x': vals.sdm1x, nx: vals.sdmnx, sh: vals.sdmsh } };
}

/**
 * @param {object} hosts   {rs, sh: section body hosts; mode: Output Mode seg host; rate: Rate readout .v; stages: rail Map;
 *                          bus: the shared bus (lib/bus.js)}
 * @param {object} conv    CONV mock state
 * @param {(run:string, path:string, scene:object) => {rate:string, value:string}} out   Output readouts for what plays
 * @param {object} scene   the mock scenario playing (data/scenarios.js)
 * @param {import('../lib/clock.js').Clock} [clock]
 * @returns {{update(id:string, v:string):void, setMode(m:string):void, bindDrawer(api):void}}
 */
export function mountConversion(hosts, conv, out, scene, clock = PLATFORM) {
  const vals = { ...conv.values };
  /** @type {ConvState} */
  const st = {
    hosts, out, scene, vals, mode: conv.mode,
    direct: vals.dsdplay === '1',   // DSD playback as applied (Direct SDM)
    reported: '',
    drawer: null,
    // One field open per section (expanding Nx pushed Output off the page). The open field shows its head
    // and select, its copy in the right column; every other field is one line (no accent: ink-2 like any fold). So a
    // section's height never changes with what is open. Resampling: the running chain's 1x / Nx.
    open: null,   // {rs: {chain, field}, sh: chain}
    // Room for both filters: the open chain shows 1x and Nx open, each with its copy beside it; nothing folds. Only where
    // the plate is tall enough to hold both (13″; lib/plate.js SIZES both, setRoom). With the Matrix engine bypassed its
    // room goes to the page's Source meter at every size, not to the idle filter (main.js paintPageMeter).
    both: false,
    copies: [],
  };
  // The page's height changes under it (Matrix engine section shown / hidden, bottom bar, resize): refit.
  hosts.bus.on('relayout', () => clock.requestAnimationFrame(() => { fit(st); wraps(hosts); }));

  render(st);
  subscribe(() => render(st));   // narrowing moved: the filters' sibling strips follow
  hosts.bus.on('optstyle', () => render(st));   // Option style: the nameplates' names (vselect.js setOptionStyle)
  return { update: (id, v) => update(st, id, v), setMode: (m) => setMode(st, m),
    setScene: (sc, dir = st.direct) => setScene(st, sc, dir),
    running: () => running(st), path: () => path(st), state: () => state(st),
    bindDrawer: (api) => { st.drawer = api; },
    /** Matrix engine bypassed as applied: both filters open on the page. */
    /** The display size holds both filters open (13″): the spare height goes to the idle filter, not the Matrix plot. */
    setRoom: (on) => { if (st.both !== on) { st.both = on; render(st); } },
    /** Something the Output readouts read changed (DAC bits applied): repaint them. */
    refresh: () => render(st) };
}
