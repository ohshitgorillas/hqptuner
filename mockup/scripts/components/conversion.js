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

/**
 * @param {object} hosts   {rs, sh: section body hosts; mode: Output Mode seg host; rate: Rate readout .v; stages: rail Map}
 * @param {object} conv    CONV mock state
 * @param {(run:string, path:string, scene:object) => {rate:string, value:string}} out   Output readouts for what plays
 * @param {object} scene   the mock scenario playing (data/scenarios.js)
 * @returns {{update(id:string, v:string):void, setMode(m:string):void, bindDrawer(api):void}}
 */
export function mountConversion(hosts, conv, out, scene) {
  const vals = { ...conv.values };
  let mode = conv.mode;
  let direct = vals.dsdplay === '1';   // DSD playback as applied (Direct SDM)
  let reported = '';
  let drawer = null;
  // One field open per section (expanding Nx pushed Output off the page). The open field shows its head
  // and select, its copy in the right column; every other field is one line (no accent: ink-2 like any fold). So a
  // section's height never changes with what is open. Resampling: the running chain's 1x / Nx.
  let open = null;   // {rs: {chain, field}, sh: chain}
  // Room for both filters: the open chain shows 1x and Nx open, each with its copy beside it; nothing folds. Only where
  // the plate is tall enough to hold both (13″; lib/plate.js SIZES both, setRoom). With the Matrix engine bypassed its
  // room goes to the page's Source meter at every size, not to the idle filter (main.js paintPageMeter).
  let both = false;

  const running = () => runningChain(mode, { playing: scene.playing, family: scene.family });
  const path = () => pathOf(scene, running(), direct);
  /** Field k of chain ch runs for this track (scenario path). */
  const runs = (ch, k) => {
    if (ch !== running() || !scene.playing) return false;
    const p = path();
    if (p === 'direct') return false;
    // The modulator runs whatever the source (official config page: Output defaults); on DSD → SDM the
    // filters don't.
    if (p === 'sdm-sdm') return k === 'sh';
    return k === 'sh' || k === (p === 'dsd-pcm' ? 'nx' : scene.stage);
  };
  // The page shows the running chain only. Auto ([source]) isn't offered; when the daemon reports it (set elsewhere) the
  // page still shows just the chain it runs now (the drawer holds both chains, as always).
  const chains = () => [running()];
  const tag = () => null;
  // Idle: every field this track's path doesn't run.
  const idle = (ch, k) => !runs(ch, k);
  const why = (f, ch, k) => (idle(ch, k) ? f.sub + ' · idle' : f.sub);
  const listOf = (ch, k) => (k === 'sh' ? CHAIN_LISTS[ch].shapers : CHAIN_LISTS[ch].filters);
  const fieldOf = (ch, k) => (k === 'sh' ? FIELDS[ch + 'sh'] : FIELDS[k]);

  /** The page's picker: nameplate + knob + siblings (components/chain-pick.js). */
  function pick(id, ch, k, aria) {
    return chainPick({ id: 'pg-' + id, aria, idle: idle(ch, k), value: vals[id], stage: k === 'nx' ? 'nx' : '1x',
      list: k === 'sh' ? (ch === 'sdm' ? 'modulators' : 'dithers') : ch + 'Filters',
      onChange: (v) => { update(id, v); drawer?.set(id, v); } });
  }

  /** One-line fold (▸): names a field or a chain, its value at the right; tapping it opens it. */
  function line(name, ch, whyText, value, onOpen) {
    return h('button.fline', { type: 'button', on: { click: onOpen } },
      h('b', { text: name }), tag(ch), whyText && h('span', { text: whyText }), h('span.fn', { text: value }));
  }

  /** The open field: head + select (dim while idle). Its copy goes to the section's right column. */
  function field(ch, k) {
    const f = fieldOf(ch, k), id = ch + k;
    // What narrowing leaves of the list reads in the nameplate (`4 of 21`), so the head carries no count.
    return [h('div.fh', {}, h('b', { text: f.label }), tag(ch), h('span.s', { text: why(f, ch, k) })), pick(id, ch, k, f.label)];
  }
  const copies = [];   // the open fields' copy: {host, ch, k}
  const copyOf = (ch, k) => {
    const host = h('div.man', {}, optCopy(listOf(ch, k), vals[ch + k]));
    copies.push({ host, ch, k });
    return host;
  };

  /**
   * Keep every section on the plate: while the page's last section runs past its bottom, the tallest open copy gives up
   * the overrun (its prose cut short, `… see more` opens it whole). Matrix engine's plot is the stretch and has its
   * 150px floor, so in PCM a long option line is what would push Output off.
   */
  function fit() {
    const page = hosts.rs.closest('main');
    if (!page || !page.offsetParent) return;
    // In layout px: the plate is scaled below 1080×810 (screen px = layout px × k), so screen rects are divided by k before
    // the padding (layout px) is taken off.
    const k = page.getBoundingClientRect().height / page.offsetHeight || 1;
    const overrun = () => {
      const kids = [...page.children].filter((c) => c.offsetParent);
      const low = Math.max(...kids.map((c) => c.getBoundingClientRect().bottom));
      return (low - page.getBoundingClientRect().bottom) / k + parseFloat(getComputedStyle(page).paddingBottom);
    };
    for (const c of copies) c.host.replaceChildren(...optCopy(listOf(c.ch, c.k), vals[c.ch + c.k]).filter(Boolean));
    // A copy can only give back what it stands above its own left column (the section is as tall as the taller one).
    const spare = (c) => c.host.offsetHeight - c.host.previousElementSibling.offsetHeight;
    for (let i = 0; i < 4 && overrun() > 0.5; i++) {
      const c = [...copies].sort((x, y) => spare(y) - spare(x))[0];
      if (spare(c) <= 0) break;
      const left = c.host.previousElementSibling.offsetHeight;
      fitCopy(c.host, listOf(c.ch, c.k), vals[c.ch + c.k], Math.max(left, c.host.offsetHeight - overrun()));
    }
  }

  function render() {
    copies.length = 0;
    const cs = chains();
    if (!open) open = { rs: { chain: cs[0], field: runs(cs[0], 'nx') ? 'nx' : '1x' }, sh: cs[0] };

    // Resampling
    const o = open.rs;
    const chainLine = (ch) => line(CHAIN_NAMES[ch], null, ch === running() ? '' : 'idle', vals[ch + '1x'], () => { o.chain = ch; o.field = '1x'; render(); });
    if (both) {
      // One row per filter (field | its copy).
      const others = cs.filter((ch) => ch !== o.chain);
      hosts.rs.replaceChildren(h('div.rsboth', {},
        ['1x', 'nx'].map((k) => h('div.two', {}, h('div.fld', {}, field(o.chain, k)), copyOf(o.chain, k))),
        others.length > 0 && h('div.two', {}, h('div.fld', {}, others.map(chainLine)))));
    } else {
      const left = cs.flatMap((ch) => (ch === o.chain
        ? ['1x', 'nx'].flatMap((k) => (k === o.field ? field(ch, k)
          : [line(FIELDS[k].label, ch, why(FIELDS[k], ch, k), vals[ch + k], () => { o.field = k; render(); })]))
        : [chainLine(ch)]));
      hosts.rs.replaceChildren(h('div.two', {}, h('div.fld', {}, left), copyOf(o.chain, o.field)));
    }

    // Shaping
    const sl = cs.flatMap((ch) => (ch === open.sh ? field(ch, 'sh')
      : [line(fieldOf(ch, 'sh').label, ch, ch === running() ? '' : 'idle', vals[ch + 'sh'], () => { open.sh = ch; render(); })]));
    hosts.sh.replaceChildren(h('div.two', {}, h('div.fld', {}, sl), copyOf(open.sh, 'sh')));

    rail();
    fit();
  }
  // The page's height changes under it (Matrix engine section shown / hidden, bottom bar, resize): refit.
  window.addEventListener('resize', () => requestAnimationFrame(() => { fit(); wraps(); }));
  /** A stage name that wraps (the DSD conversion stage) puts its lamp on the first line; re-measured once fonts land. */
  function wraps() {
    for (const id of ['dsd', 'resampling', 'shaping']) {
      const n = hosts.stages.get(id).querySelector('.n');
      n.parentElement.classList.toggle('wrap', n.offsetHeight > 30);
    }
  }

  function rail() {
    const run = running(), p = path();
    // DSD Processing: always on the rail (hideable); in this track's path only on a processed DSD source. Its value names
    // what it runs for the running mode: PCM out = noise filter · decimation; SDM out = the integrator, or Direct.
    const dsd = hosts.stages.get('dsd');
    dsd.classList.toggle('byp', !['dsd-pcm', 'sdm-sdm'].includes(p));
    dsd.querySelector('.v').textContent = run === 'pcm' ? `${vals.noise} · ${vals.decim}` : direct ? 'Direct' : vals.integ;
    // Direct: Resampling and Shaping aren't in the path, so they leave the chain while it plays.
    const remod = p === 'sdm-sdm';
    let moved = false;
    for (const id of ['resampling', 'shaping']) {
      const st = hosts.stages.get(id);
      if (st.hidden !== (p === 'direct')) { st.hidden = p === 'direct'; moved = true; }
    }
    // DSD → SDM processed: nothing resamples; Resampling's slot carries `Rate conversion` (SDM → SDM).
    const rn = hosts.stages.get('resampling').querySelector('.n'), name = remod ? 'Rate conversion' : 'Resampling';
    if (rn.textContent !== name) { rn.textContent = name; moved = true; }
    if (moved) window.dispatchEvent(new Event('resize'));   // rail wire redraws
    hosts.stages.get('resampling').querySelector('.v').textContent = remod ? vals.sdmconv : vals[run + (runs(run, 'nx') || p === 'dsd-pcm' ? 'nx' : '1x')];
    hosts.stages.get('shaping').querySelector('.v').textContent = vals[run + 'sh'];
    wraps();
    const o = out(run, p, scene);
    hosts.onOut?.({ mode, run, tier: o.tier, rate: o.rate, rest: o.rest });   // the page's Output tuner
    hosts.onRun?.(run);
    hosts.stages.get('output').querySelector('.v').textContent = o.value;
    const key = `${scene.id}|${p}|${run}`;
    if (key !== reported) { reported = key; hosts.onPath?.(p, run, scene); }
  }

  /** A filter or shaper changed (drawer or page): the page re-renders (what is open stays open), then the rail. */
  function update(id, v) {
    vals[id] = v;
    render();
  }

  /** The scenario switch, or DSD playback applied (Direct): the path changes; the running chain may too (a daemon in Auto). */
  function setScene(sc, dir = direct) {
    scene = sc; direct = dir;
    open = null;
    drawer?.setRunning(running());
    render();
  }

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    open = null;   // a new mode opens on its running 1x and shaper
    drawer?.setRunning(running());
    render();
  }

  render();
  subscribe(() => render());   // narrowing moved: the filters' sibling strips follow
  window.addEventListener('optstyle', () => render());   // Option style: the nameplates' names (vselect.js setOptionStyle)
  /** What the engine runs now (Snapshot builder's Live column): mode, running chain, both chains' picks. */
  const state = () => ({ mode, run: running(), pcm: { '1x': vals.pcm1x, nx: vals.pcmnx, sh: vals.pcmsh }, sdm: { '1x': vals.sdm1x, nx: vals.sdmnx, sh: vals.sdmsh } });
  return { update, setMode, setScene, running, path, state, bindDrawer: (api) => { drawer = api; },
    /** Matrix engine bypassed as applied: both filters open on the page. */
    /** The display size holds both filters open (13″): the spare height goes to the idle filter, not the Matrix plot. */
    setRoom: (on) => { if (both !== on) { both = on; render(); } },
    /** Something the Output readouts read changed (DAC bits applied): repaint them. */
    refresh: () => render() };
}
