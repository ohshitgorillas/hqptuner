// Profile builder: the page's `Profile builder` button (Matrix engine section) swaps the chain body for this one, as the
// gear does for Settings. Header, engine row and bottom bar stay. It covers the entire process of
// building a matrix profile, pipelines included; it edits a copy (nothing reaches the engine until
// Save, and saving restarts the engine), × on its title; it guides the user (even an expert on what they want isn't one
// on how HQPTuner lays it out), coherent and cohesive, no parts bin.
//   Rail   the walk, in the chain rail's grammar: Overview, then Listening, EQ / Correction, Crossfeed, DAC correction,
//          Loudness, each with its answer (`Skipped` where it doesn't apply). The page showing is lit (amber name +
//          left-hand bar). Tap any to jump: nothing forces the order.
//   Overview  the intro beside the signal chain with its part lit; what the profile holds,
//          one line per part (› jumps to its step) and DSP pipelines with its own access point (the one drawer); then
//          which profile (picker · Name, full width · Stations), its Description, and the ways on: Save (done, for a
//          profile tuned by ear already), Change something (the walk from here), Start from scratch (the walk from
//          defaults). Advanced settings: a quiet link at the foot only.
//   Steps  one part at a time in the drawers' row grammar (control column | the manual's own paragraph; choices as the
//          Volume drawer's choice lines), a guidance line on what the step decides, Back / Next; a step that doesn't apply
//          says why and Next passes it. The last step's Next (`Review`) returns to the overview.
// Edits stay staged per profile until Save or Discard, through switching and leaving. `[Default]` keeps its name and
// can't be deleted (v1). The builder opens on New profile from the running matrix (what's loaded: save it as it is).
// Save writes, restarts and runs the profile when the loaded station is ticked; the builder stays on it.
// Exit: ×, Escape with nothing open, the gear (Settings), or the Snapshot builder button.
// The shell (switching, staging, Save / Delete, the rail, the overview's frame, the swap) is lib/builder.js.

import { h, s } from '../lib/dom.js';
import { mountDrawer, closeOthers, familyOf } from './drawer.js';
import { createPipelines } from './pipelines.js';
import { mountAutoEq } from './autoeq.js';
import { seg, select } from './seg.js';
import { shelfScale, BAUER_PRESETS } from '../lib/xdsp.js';
import { mountBuilder, paras, drow as row, chainPic, holdRow } from '../lib/builder.js';
import { NEW, OVERVIEW, homeOf } from '../model/builder.js';
import { MATRIX_DRAWER, CORRECTION_DRAWER, CROSSFEED, LOUDNESS } from '../data/matrix.js';
import { PMAN } from '../data/pipelines.js';
import { PROFILE_COPY, PB_STEPS, PB_COPY, LISTEN, XF_LINES, KNOWN, MATRIX_STAGES, OUTSIDE_STAGES } from '../data/profiles.js';

const DEFAULT = '[Default]';
const FAM = 'pbuild';
const BYPASS_ENGAGE = [{ v: '0', label: 'Bypass' }, { v: '1', label: 'Engage' }];   // the gates' grammar, default leftmost
const OFF_ON = [{ v: '0', label: 'Off' }, { v: '1', label: 'On' }];

/**
 * @param {object} el  {btn: page button, chain: #body, body: #pbody, rail, page, plate, settings, snapshot, bus: lib/bus.js}
 * @param {{name: string, active?: boolean}[]} stations  in the tree's order
 * @param {object} data  PROFILES (station → name → {desc, listen?, vals?, pipes?})
 * @param {object} o  {running(), level(), levelBus, fixed(), onSaved(touched, rec, name, run),
 *                    pipelines: the page's pipeline set (data/pipelines.js pipelineSet), shared with the chain}
 */
export function mountProfileBuilder({ btn, chain, body, rail, page, plate, settings, snapshot, bus }, stations, data, o) {
  const { PIPELINES, PIPELINES_DRAWER, FULL_FITS } = o.pipelines;
  const home = homeOf(stations);
  const applied = familyOf('matrix').base;   // the chain's applied matrix (what's loaded)
  const row0 = (drawer, id) => drawer.tabs.flatMap((t) => t.body).find((it) => it.row?.control.id === id).row;
  const R = { engine: row0(MATRIX_DRAWER, 'mxengine'), expand: row0(MATRIX_DRAWER, 'mxexpand'), iir: row0(MATRIX_DRAWER, 'mxiir2fir'),
    dcen: row0(CORRECTION_DRAWER, 'dcen'), dcdac: row0(CORRECTION_DRAWER, 'dcdac') };
  const MODELS = R.dcdac.control.options;
  const M = CROSSFEED.man, LM = LOUDNESS.man;

  // ── Records (mock: this component's copy) ───────────────────────────────
  const asProfile = (x) => ({ eqname: '', ...x, mxen: '1' });   // a profile built here runs the matrix
  const listenOf = (vals) => (vals.xfmode !== 'off' ? 'headphones' : 'speakers');
  const records = Object.fromEntries(stations.map((st) => [st.name, Object.fromEntries(Object.entries(data[st.name] ?? {}).map(([name, r]) => {
    const vals = asProfile({ ...applied, ...(r.vals ?? {}) });
    if (r.pipes) vals.mxpipes = JSON.stringify(r.pipes(JSON.parse(applied.mxpipes)));
    return [name, { desc: r.desc ?? '', listen: r.listen ?? listenOf(vals), vals }];
  }))]));
  const LD = { ldlowtype: LOUDNESS.low.type, ldlowfreq: LOUDNESS.low.freq, ldlowsteep: LOUDNESS.low.steep, ldlowlevel: LOUDNESS.low.level,
    ldhightype: LOUDNESS.high.type, ldhighfreq: LOUDNESS.high.freq, ldhighsteep: LOUDNESS.high.steep, ldhighlevel: LOUDNESS.high.level,
    ldrlow: LOUDNESS.rangeLow, ldrhigh: LOUDNESS.rangeHigh };
  /** Start from scratch: the forms' defaults, the stereo pair with no processing. */
  const scratch = () => {
    const pipes = JSON.parse(applied.mxpipes).filter((p) => !p.gen).map((p) => ({ ...p, gain: p.src === p.mix ? 0 : p.gain, unit: 'dB', stages: [] }));
    return asProfile({ ...applied, mxpipes: JSON.stringify(pipes), eqname: '',
      xfgate: '0', xfmode: 'off', xfimpl: 'bauer', xfpreset: CROSSFEED.bauer.preset, xffreq: CROSSFEED.bauer.freq, xflevel: CROSSFEED.bauer.level, xfcomp: CROSSFEED.bauer.comp,
      xsangle: CROSSFEED.structural.angle, xscirc: CROSSFEED.structural.circ, xslambda: CROSSFEED.structural.lambda,
      dcen: '0', dcdac: '', ldon: '0', ...LD, mxengine: R.engine.control.value, mxexpand: R.expand.control.value, mxiir2fir: R.iir.control.value });
  };

  // ── Edit state ──────────────────────────────────────────────────────────
  // Opens on what's loaded: New profile from the running matrix (save it as it is, or change it).
  let meta;                   // {name, stations, desc, listen} of the one being edited (its values live in the store)
  let known = { crossfeed: 'preset', loudness: 'preset' };   // "do you know your settings?" per step
  let ready = false;
  const B = mountBuilder({ btn, chain, body, bus }, {
    title: 'Profile builder', closeLabel: 'Close Profile builder', noun: 'Profile',
    stations: stations.map((st) => st.name), book: records, cur: { st: home, name: NEW },
    copy: { remove: (n) => PROFILE_COPY.remove(n), overwrite: (n) => PROFILE_COPY.overwrite(n), noName: PROFILE_COPY.noName,
      state: { restarts: PB_COPY.state.dirtyRun, dirty: PB_COPY.state.dirty, live: PB_COPY.state.running, saved: PB_COPY.state.saved } },
    name: () => meta.name,
    to: () => meta.stations,
    record: () => ({ desc: meta.desc, listen: meta.listen, vals: { ...v } }),
    dirty: () => dirty(),
    load: (c, buf) => load(c, buf),
    buffer: () => ({ meta: structuredClone(meta), vals: { ...v } }),
    keeps: (c) => c.name === DEFAULT,   // the station's unnamed profile: unticking its station copies it out
    ticked: () => meta.stations.length > 0,
    restarts: () => meta.stations.includes(home),   // only the loaded station's profiles can run
    live: () => B.cur.st === home && B.cur.name === o.running(),
    view: (where) => { if (where) show(where === 'here' ? at : OVERVIEW); render(); },
    refuse: () => { if (at !== 'overview') show('overview'); B.paintState(); nameBox.focus(); },
    saved: ({ name, to, rec }) => {
      B.load(B.cur);
      show('overview'); render();
      // Saving restarts the engine; with the loaded station written, the profile runs (main.js).
      o.onSaved?.(to.map((st) => [st, Object.keys(B.book[st])]), rec, name, to.includes(home));
      B.paintState();
    },
    removed: () => { B.load(B.cur); show('overview'); render(); o.onSaved?.([[B.cur.st, Object.keys(B.book[B.cur.st])]]); },
    leave: () => { settings.setOn(false); snapshot()?.setOn(false, false); },
    opened: () => {
      // What's loaded may have moved since (a chain tweak): an untouched New profile follows it.
      if (B.cur.name === NEW && !B.staged.has(NEW) && !dirty()) B.load(B.cur);
      show('overview'); render();
    },
    painted: (d) => {
      const opt0 = B.pick.selectedOptions[0];
      if (opt0) opt0.textContent = (B.cur.name === NEW ? 'New profile' : B.cur.name) + (d ? ' •' : '');
    },
    walk: { rail, steps: PB_STEPS, copy: PB_COPY, skipOf: (id) => skipOf(id), answer: (id) => (skipOf(id) ? PB_COPY.skipped : answer[id]()),
      at: () => at, show: (id) => show(id), newLabel: 'New profile',
      scratch: () => { B.load(B.cur, { meta: structuredClone(meta), vals: scratch() }); show(PB_STEPS[0].id); render(); },
      nameBox: { type: 'text', 'aria-label': 'Profile name', maxlength: 60, spellcheck: 'false', placeholder: PROFILE_COPY.name },
      setName: (n) => { meta.name = n; } },
  });
  const { pick, nameBox } = B;

  // ── Values: one family store (the DSP pipelines drawer is its one drawer member) ─────
  const pl0 = holdRow('DSP pipelines', null, 'button.pbhold.pbpl');
  const plBtn = pl0.el, plCount = pl0.a;
  const plCore = createPipelines(PIPELINES, { bypassed: () => '', plate, openCrossfeed: () => { pl.setOpen(false); show('crossfeed'); }, goTab: (id) => pl.showTab(id) });
  const pl = mountDrawer(body, plBtn, PIPELINES_DRAWER, { prefix: 'pb-', family: FAM, head: h('div.apply.pbact', {}, B.discardButton()),
    onValues: () => { if (ready) { paint(); B.paintState(); } },
    blocks: Object.fromEntries([['pl-overview', plCore.overview], ...Array.from({ length: PIPELINES.outputs }, (_, k) => [`pl-out${k}`, plCore.output(k)])]) });
  pl.setOpen(false);
  if (!FULL_FITS) body.querySelector('#pb-drawer-pipelines').classList.add('pl-short');
  const fam = familyOf(FAM);
  const v = fam.vals;
  /** Set values from the page: stages them (the pipelines member re-reads, so crossfeed blocks follow), repaints. */
  const set = (patch) => { for (const [k, x] of Object.entries(patch)) v[k] = String(x); pl.regray(); };

  const saved = (c) => (c.name === NEW
    ? { meta: { name: '', stations: [home], desc: '', listen: listenOf(applied) }, vals: asProfile(applied) }
    : { meta: { name: c.name, stations: [c.st], desc: B.book[c.st][c.name].desc, listen: B.book[c.st][c.name].listen }, vals: B.book[c.st][c.name].vals });
  const sameVals = (a, b) => Object.keys(b).every((k) => !(k in a) || String(a[k]) === String(b[k]));
  const dirty = () => {
    const s0 = saved(B.cur);
    return !sameVals(v, s0.vals) || meta.desc !== s0.meta.desc || meta.name !== s0.meta.name || meta.listen !== s0.meta.listen
      || [...meta.stations].sort().join('\u0001') !== [...s0.meta.stations].sort().join('\u0001');
  };

  function load(c, buf) {
    const s0 = saved(c);
    const to = buf ? buf.vals : s0.vals;
    Object.assign(v, to); Object.assign(fam.base, to);
    pl.discarded(); pl.settle();   // the pipelines block repaints from the values (crossfeed blocks rebuilt)
    if (buf) { Object.assign(fam.base, s0.vals); pl.remark(); }
    meta = structuredClone(buf?.meta ?? s0.meta);
    known = { crossfeed: v.xfmode === 'off' || xfPreset() ? 'preset' : 'values', loudness: ldDefault() ? 'preset' : 'values' };
    if (ready) eq.reset();
  }

  // ── Rail: the walk's answers ────────────────────────────────────────────
  const ctx = () => ({ listen: meta.listen, fixed: o.fixed(), models: MODELS.filter((m) => m.v).length });
  const skipOf = (id) => PB_STEPS.find((x) => x.id === id)?.skip?.(ctx()) || '';
  const xfName = () => ({ off: 'Off', bauer: 'Bauer', structural: 'Structural' }[v.xfmode] ?? 'Off');
  const answer = {
    listen: () => LISTEN.find((x) => x.v === meta.listen)?.label,
    eq: () => eq.answer(),
    crossfeed: () => (v.xfmode === 'off' ? 'Off' : `${xfName()} · ${xfPreset()?.label ?? 'Custom'}`),
    correction: () => (v.dcen === '1' ? (v.dcdac || '[none]') : 'Bypassed'),
    loudness: () => (v.ldon === '1' ? `${Math.round((o.fixed() ? 0 : shelfScale(o.level(), Number(v.ldrlow), Number(v.ldrhigh))) * 100)}% applied` : 'Off'),
  };

  // ── Page parts ──────────────────────────────────────────────────────────
  const drow = (label, ctl, man, extra) => row(label, ctl, man, { extra });
  /** Choice lines (the Volume drawer's grammar): radio + name + its own paragraph. */
  function choice(label, options, get, pickOne) {
    const lines = options.map((op) => {
      const radio = h('button.radio', { type: 'button', role: 'radio', aria: { label: op.label }, on: { click: () => pickOne(op.v) } });
      const el = h('div.chline', { data: { v: op.v } },
        h('div.chl', {}, radio, h('span.chn', { on: { click: () => pickOne(op.v) } }, h('b', { text: op.label }))),
        h('div.man', {}, paras(op.man)));
      return { op, el, radio };
    });
    const el = h('div.drow.drow-full.pbchoice', {}, h('div.ctl', {}, h('div.fh', {}, h('b', { text: label }))),
      h('div.chlist', { role: 'radiogroup', 'aria-label': label }, lines.map((l) => l.el)));
    // fold(): once a pick leads somewhere (crossfeed engaged), the unpicked lines fold to their names (the Crossfeed
    // drawer's fold of the unpicked implementation), so the step's next rows keep their room.
    return { el, paint: (fold) => { for (const l of lines) { const on = l.op.v === get(); l.el.classList.toggle('cur', on); l.el.classList.toggle('fold', !!fold && !on); l.radio.setAttribute('aria-checked', String(on)); } } };
  }
  const num = (label, unit, k, attrs, man, mul = 1) => {
    const input = h('input.vfd', { type: 'number', 'aria-label': label, ...attrs });
    input.addEventListener('change', () => { const n = Number(input.value); if (Number.isFinite(n)) set({ [k]: +(n / mul).toFixed(4) }); });
    return { label, man, el: h('label.ci', {}, h('span.cl', { text: label }), h('div.num', {}, input, h('span.u', { text: unit }))),
      paint: () => { input.value = +(Number(v[k]) * mul).toFixed(2); } };
  };
  /** Several values in one row (the drawers' `group` grammar): boxes side by side, each with its label above; the
   *  manual's paragraphs keyed by those labels on the right. */
  const group = (label, nums) => drow(label, h('div.cgrp', {}, nums.map((n) => n.el)), nums.map((n) => ({ k: n.label, text: n.man })));

  // Overview
  const holdRows = ['eq', 'crossfeed', 'correction', 'loudness'].map((id) => ({ id, ...holdRow(PB_STEPS.find((x) => x.id === id).title, () => show(id)) }));
  pick.addEventListener('change', () => { const [st, name] = pick.value === NEW ? [home, NEW] : pick.value.split('\u0001'); B.go({ st, name }); });
  /** Stations menu (Snapshot builder's): ✓ = Save writes there; a station already holding this name shows it. */
  const stMenu = B.stationsMenu({ ticked: () => meta.stations, name: () => meta.name,
    pick: (list) => { meta.stations = list; stMenu.paint(); B.paintState(); } });
  const desc = h('textarea', { 'aria-label': 'Profile description', spellcheck: 'false', maxlength: 500, placeholder: PROFILE_COPY.desc });
  desc.addEventListener('input', () => { meta.desc = desc.value; B.paintState(); });
  const acts = B.buttons();
  const askHost = h('div.pbask');
  const overview = B.overview({
    intro: h('p.pbintro', { text: PB_COPY.intro }),
    holds: [holdRows.map((r) => r.el), plBtn],
    chain: chainPic('Signal chain: the matrix engine\'s part lit', (id) => MATRIX_STAGES.includes(id), (id) => OUTSIDE_STAGES.includes(id)),
    ids: [stMenu.el],
    mid: [h('label.desc.pbdesc', {}, desc, pencil())],
    ask: askHost,
    acts,
    after: h('button.pbadvlink', { type: 'button', on: { click: () => show('advanced') } }, PB_COPY.advanced, h('span', { 'aria-hidden': 'true', text: ' ›' })),
  });

  // Steps
  const listenSeg = seg({ aria: 'Listening', options: LISTEN, value: 'speakers', onChange: (x) => { meta.listen = x; paint(); B.paintState(); } });
  const eq = mountAutoEq({ core: plCore, name: () => v.eqname, land: (from) => { v.eqname = from; pl.regray(); } });
  const eqRows = { auto: drow('Headphone Auto EQ', eq.search, PMAN.peqFile), files: drow('Correction files', eq.files, PMAN.conv) };
  const eqOut = h('div.pbeqout', {}, eq.holds, eq.plot);
  const xfSel = choice('Crossfeed', [{ v: 'off', label: 'Off', man: XF_LINES.off }, { v: 'bauer', label: 'Bauer', man: M.bauer }, { v: 'structural', label: 'Structural', man: XF_LINES.structural }],
    () => v.xfmode, (x) => set(x === 'off' ? { xfgate: 0, xfmode: 'off' } : { xfgate: 1, xfimpl: x, xfmode: x }));
  const xfKnown = choice('Settings', KNOWN.crossfeed, () => known.crossfeed, (x) => { known.crossfeed = x; paint(); });
  const bPre = seg({ aria: 'Preset', options: CROSSFEED.presets.filter((p) => p.v !== 'custom'), value: 'default',
    onChange: (x) => set({ xfpreset: x, xffreq: BAUER_PRESETS[x][0], xflevel: BAUER_PRESETS[x][1] }) });
  const sPre = seg({ aria: 'Preset', options: CROSSFEED.sPresets.map((p) => ({ v: p.v, label: p.label })), value: 'standard',
    onChange: (x) => { const p = CROSSFEED.sPresets.find((q) => q.v === x); set({ xsangle: p.angle, xslambda: p.lambda }); } });
  const bPreRow = drow('Preset', bPre, M.preset), sPreRow = drow('Preset', sPre, '');
  const bNums = [num('Frequency', 'Hz', 'xffreq', { min: 300, max: 2000, step: 1 }, M.freq), num('Level', 'dB', 'xflevel', { min: 1, max: 15, step: 0.1 }, M.level),
    num('Crossfeed compensation', '%', 'xfcomp', { min: 0, max: 150, step: 1 }, M.comp)];
  const sNums = [num('Speaker angle', '°', 'xsangle', { min: 5, max: 60, step: 0.5 }, M.angle), num('Head circumference', 'cm', 'xscirc', { min: 41, max: 66, step: 0.25 }, M.circ),
    num('Center character', '%', 'xslambda', { min: 0, max: 150, step: 1 }, M.lambda, 100)];
  const xfPreset = () => (v.xfmode === 'bauer' ? CROSSFEED.presets.find((p) => p.v === v.xfpreset && p.v !== 'custom')
    : v.xfmode === 'structural' ? CROSSFEED.sPresets.find((p) => +p.angle === +v.xsangle && +p.lambda === +v.xslambda) : { label: '' });
  const dcSeg = seg({ aria: 'DAC correction', options: BYPASS_ENGAGE, value: '0', onChange: (x) => set({ dcen: x }) });
  const dcSel = h('select.vfd', { 'aria-label': 'DAC model' }, MODELS.map((m) => h('option', { value: m.v, text: m.label })));
  dcSel.addEventListener('change', () => set({ dcdac: dcSel.value }));
  const ldSeg = seg({ aria: 'Loudness', options: BYPASS_ENGAGE, value: '0', onChange: (x) => set({ ldon: x }) });
  const ldKnown = choice('Settings', KNOWN.loudness, () => known.loudness, (x) => { known.loudness = x; if (x === 'preset') set(LD); else paint(); });
  const ldNums = [num('Lower bound', 'dBFS', 'ldrlow', { min: -120, max: 0, step: 1 }, LM.rangeLow), num('Upper bound', 'dBFS', 'ldrhigh', { min: -120, max: 0, step: 1 }, LM.rangeHigh),
    num('Bass level', 'dB', 'ldlowlevel', { min: -20, max: 20, step: 0.1 }, LM.low.level), num('Treble level', 'dB', 'ldhighlevel', { min: -20, max: 20, step: 0.1 }, LM.high.level)];
  const ldDefault = () => Object.entries(LD).every(([k, x]) => String(v[k]) === String(x));
  const bGroup = group('Values', bNums), sGroup = group('Values', sNums), ldGroup = group('Values', ldNums);
  // Advanced settings (only from the overview's foot): the engine rows with every option's manual line.
  const optList = (r, k) => {
    const rows = r.optMan.map((x) => h('button.optrow', { type: 'button', data: { v: x.v }, on: { click: () => set({ [k]: x.v }) } }, h('code', { text: x.label ?? x.v }), h('span', { text: x.man })));
    return { el: h('div.optlist', { role: 'list' }, rows), paint: () => { for (const b of rows) b.classList.toggle('cur', b.dataset.v === v[k]); } };
  };
  const engSeg = seg({ aria: 'Engine', cls: 'enum', options: R.engine.optMan.map((x) => ({ v: x.v, label: x.label })), value: '1', onChange: (x) => set({ mxengine: x }) });
  const hfSeg = seg({ aria: 'Expand HF', options: OFF_ON, value: '0', onChange: (x) => set({ mxexpand: x }) });
  const iirSeg = seg({ aria: 'IIR to FIR', cls: 'enum', options: R.iir.optMan.map((x) => ({ v: x.v, label: x.label ?? x.v })), value: '0', onChange: (x) => set({ mxiir2fir: x }) });
  const engList = optList(R.engine, 'mxengine'), iirList = optList(R.iir, 'mxiir2fir');

  /** A step's page (the shell's frame): the guidance or skip line, then its rows. */
  const stepPage = (id) => B.stepPage(id, { guide: (skip, st) => h('p.pbguide', { class: skip && 'skip', text: skip || st.guide(ctx()) }), rows: stepRows });
  function stepRows(id) {
    if (id === 'listen') return [drow('Listening', listenSeg, '')];
    if (id === 'eq') return [meta.listen === 'headphones' && eqRows.auto, eqRows.files, eqOut].filter(Boolean);
    if (id === 'crossfeed') {
      if (v.xfmode === 'off') return [xfSel.el];
      const pre = v.xfmode === 'bauer' ? bPreRow : sPreRow;
      return [xfSel.el, xfKnown.el, known.crossfeed === 'preset' ? pre : (v.xfmode === 'bauer' ? bGroup : sGroup)];
    }
    if (id === 'correction') return [drow('DAC correction', dcSeg, R.dcen.man), drow('DAC model', dcSel, R.dcdac.man)];
    if (id === 'loudness') return [drow('Loudness', ldSeg, LM.enabled), ...(v.ldon === '1' ? [ldKnown.el, ...(known.loudness === 'values' ? [ldGroup] : [])] : [])];
    return [];
  }

  let at = 'overview';
  let shape = '';   // what the showing step lays out: a change re-lays it out (choice made, path changed)
  const shapeNow = () => [at, meta.listen, v.xfmode, known.crossfeed, v.ldon, known.loudness, skipOf(at)].join('|');
  function show(id) {
    if (!B.inWalk(id) && id !== 'advanced') id = 'overview';
    closeOthers(null);
    at = id;
    let content;
    if (id === 'overview') content = overview;
    else if (id === 'advanced') content = h('div.pbstepp', {},
      B.title(PB_COPY.advanced),
      h('div.pbsrows', {}, drow('Engine', engSeg, R.engine.man, engList.el), drow('Expand HF', hfSeg, R.expand.man), drow('IIR to FIR', iirSeg, R.iir.man, iirList.el)),
      h('div.pbnav', {}, h('span.grow'), h('button.btn.sm', { type: 'button', text: PB_COPY.overview, on: { click: () => show('overview') } })));
    else content = stepPage(id);
    page.replaceChildren(content);
    shape = shapeNow();
    if (ready) { paint(); B.paintState(); }
  }

  // ── Paint ───────────────────────────────────────────────────────────────
  function paint() {
    if (at !== 'overview' && at !== 'advanced' && shapeNow() !== shape) { show(at); return; }
    select(listenSeg, meta.listen);
    eq.paint();
    xfSel.paint(v.xfmode !== 'off'); xfKnown.paint();
    select(bPre, v.xfpreset);
    select(sPre, CROSSFEED.sPresets.find((p) => +p.angle === +v.xsangle && +p.lambda === +v.xslambda)?.v ?? '');
    for (const n of [...bNums, ...sNums, ...ldNums]) n.paint();
    select(dcSeg, v.dcen); dcSel.value = v.dcdac; dcSel.disabled = v.dcen !== '1'; dcSel.classList.toggle('grayed', v.dcen !== '1');
    select(ldSeg, v.ldon); ldKnown.paint();
    select(engSeg, v.mxengine); select(hfSeg, v.mxexpand); select(iirSeg, v.mxiir2fir); engList.paint(); iirList.paint();
    for (const r of holdRows) r.a.textContent = skipOf(r.id) && !(r.id === 'crossfeed' && v.xfmode !== 'off') ? PB_COPY.skipped : answer[r.id]();
    plCount.textContent = `${plCore.count()} active`;
    B.paintRail();
  }

  function render() {
    const { cur } = B;
    pick.replaceChildren(...stations.map((st) => h('optgroup', { label: st.name },
      Object.keys(B.book[st.name]).map((n) => h('option', { value: st.name + '\u0001' + n, text: B.isDirty({ st: st.name, name: n }) ? `${n} •` : n })))),
    h('option', { value: NEW, text: B.staged.has(NEW) || (cur.name === NEW && dirty()) ? 'New profile •' : 'New profile' }));
    pick.value = B.K(cur);
    const isDef = cur.name === DEFAULT;
    nameBox.value = meta.name;
    nameBox.readOnly = isDef;   // the station's unnamed profile: the daemon's name, not one to change (v1)
    desc.value = meta.desc;
    acts.del.hidden = cur.name === NEW || isDef;
    askHost.replaceChildren(...(B.ask ? [B.askLine()] : []));
    stMenu.paint();
    paint();
    B.paintState();
  }
  o.levelBus.addEventListener('level', () => { if (ready && !body.hidden) paint(); });

  B.load(B.cur);
  ready = true;
  show('overview');
  render();
  return B.start();
}

/** The description's pencil (it marks the text as the user's to edit). */
const pencil = () => s('svg', { viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4,
  'stroke-linejoin': 'round', 'aria-hidden': 'true' }, s('path', { d: 'M10.5 2.5l3 3-8 8H2.5v-3z' }), s('path', { d: 'M9 4l3 3' }));
