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

import { h, s } from '../lib/dom.js';
import { anyOpen, popover } from '../lib/popover.js';
import { closeSheets, sheetOpen } from '../lib/sheet.js';
import { mountDrawer, closeOthers, familyOf } from './drawer.js';
import { createPipelines } from './pipelines.js';
import { mountAutoEq } from './autoeq.js';
import { seg, select } from './seg.js';
import { shelfScale, BAUER_PRESETS } from '../lib/xdsp.js';
import { MATRIX_DRAWER, CORRECTION_DRAWER, CROSSFEED, LOUDNESS } from '../data/matrix.js';
import { PIPELINES, PIPELINES_DRAWER, FULL_FITS, PMAN } from '../data/pipelines.js';
import { CHAIN } from '../data/chain.js';
import { PROFILE_COPY, PB_STEPS, PB_COPY, LISTEN, XF_LINES, KNOWN, MATRIX_STAGES, OUTSIDE_STAGES } from '../data/profiles.js';

const NEW = '\u0000new';
const DEFAULT = '[Default]';
const FAM = 'pbuild';
const BYPASS_ENGAGE = [{ v: '0', label: 'Bypass' }, { v: '1', label: 'Engage' }];   // the gates' grammar, default leftmost
const OFF_ON = [{ v: '0', label: 'Off' }, { v: '1', label: 'On' }];
const paras = (m) => (Array.isArray(m) ? m : [m]).filter(Boolean).map((t) => (typeof t === 'string' ? h('p', { text: t }) : h('p', {}, h('b', { text: t.k }), ' — ', t.text)));

/**
 * @param {object} el  {btn: page button, chain: #body, body: #pbody, rail, page, plate, settings, snapshot}
 * @param {{name: string, active?: boolean}[]} stations  in the tree's order
 * @param {object} data  PROFILES (station → name → {desc, listen?, vals?, pipes?})
 * @param {object} o  {running(), level(), levelBus, fixed(), onSaved(touched, rec, name, run)}
 */
export function mountProfileBuilder({ btn, chain, body, rail, page, plate, settings, snapshot }, stations, data, o) {
  const home = stations.find((st) => st.active)?.name ?? stations[0].name;
  const applied = familyOf('matrix').base;   // the chain's applied matrix (what's loaded)
  const row0 = (drawer, id) => drawer.tabs.flatMap((t) => t.body).find((it) => it.row?.control.id === id).row;
  const R = { engine: row0(MATRIX_DRAWER, 'mxengine'), expand: row0(MATRIX_DRAWER, 'mxexpand'), iir: row0(MATRIX_DRAWER, 'mxiir2fir'),
    dcen: row0(CORRECTION_DRAWER, 'dcen'), dcdac: row0(CORRECTION_DRAWER, 'dcdac') };
  const MODELS = R.dcdac.control.options;
  const M = CROSSFEED.man, LM = LOUDNESS.man;

  // ── Values: one family store (the DSP pipelines drawer is its one drawer member) ─────
  const acts = [];
  let ready = false;
  const plBtn = h('button.pbhold.pbpl', { type: 'button' });
  const plCore = createPipelines(PIPELINES, { bypassed: () => '', plate, openCrossfeed: () => { pl.setOpen(false); show('crossfeed'); }, goTab: (id) => pl.showTab(id) });
  const plDiscard = h('button.btn.sm', { type: 'button', text: 'Discard', on: { click: () => discard() } });
  acts.push({ discard: plDiscard });
  const pl = mountDrawer(body, plBtn, PIPELINES_DRAWER, { prefix: 'pb-', family: FAM, head: h('div.apply.pbact', {}, plDiscard),
    onValues: () => { if (ready) { paint(); paintState(); } },
    blocks: Object.fromEntries([['pl-overview', plCore.overview], ...Array.from({ length: PIPELINES.outputs }, (_, k) => [`pl-out${k}`, plCore.output(k)])]) });
  pl.setOpen(false);
  if (!FULL_FITS) body.querySelector('#pb-drawer-pipelines').classList.add('pl-short');
  const fam = familyOf(FAM);
  const v = fam.vals;
  /** Set values from the page: stages them (the pipelines member re-reads, so crossfeed blocks follow), repaints. */
  const set = (patch) => { for (const [k, x] of Object.entries(patch)) v[k] = String(x); pl.regray(); };

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
  let cur = { st: home, name: NEW };
  const K = (c) => (c.name === NEW ? NEW : c.st + '\u0001' + c.name);
  const staged = new Map();   // K → {meta, vals}: a profile left with unsaved edits
  let meta;                   // {name, stations, desc, listen} of the one being edited (its values live in the store)
  let ask = null, refused = false;
  const saved = (c) => (c.name === NEW
    ? { meta: { name: '', stations: [home], desc: '', listen: listenOf(applied) }, vals: asProfile(applied) }
    : { meta: { name: c.name, stations: [c.st], desc: records[c.st][c.name].desc, listen: records[c.st][c.name].listen }, vals: records[c.st][c.name].vals });
  const sameVals = (a, b) => Object.keys(b).every((k) => !(k in a) || String(a[k]) === String(b[k]));
  const dirty = () => {
    const s0 = saved(cur);
    return !sameVals(v, s0.vals) || meta.desc !== s0.meta.desc || meta.name !== s0.meta.name || meta.listen !== s0.meta.listen
      || [...meta.stations].sort().join('\u0001') !== [...s0.meta.stations].sort().join('\u0001');
  };
  const isDirty = (c) => (K(c) === K(cur) ? dirty() : staged.has(K(c)));
  let known = { crossfeed: 'preset', loudness: 'preset' };   // "do you know your settings?" per step

  function load(c, over) {
    const s0 = saved(c), buf = over ?? staged.get(K(c));
    const to = buf ? buf.vals : s0.vals;
    Object.assign(v, to); Object.assign(fam.base, to);
    pl.discarded(); pl.settle();   // the pipelines block repaints from the values (crossfeed blocks rebuilt)
    if (buf) { Object.assign(fam.base, s0.vals); pl.remark(); }
    meta = structuredClone(buf?.meta ?? s0.meta);
    staged.delete(K(c));
    known = { crossfeed: v.xfmode === 'off' || xfPreset() ? 'preset' : 'values', loudness: ldDefault() ? 'preset' : 'values' };
    if (ready) eq.reset();
  }
  function stash() { if (dirty()) staged.set(K(cur), { meta: structuredClone(meta), vals: { ...v } }); else staged.delete(K(cur)); }
  function go(c) {
    if (K(c) === K(cur)) return;
    stash(); closeOthers(null);
    cur = c; ask = null; refused = false;
    load(c); show('overview'); render();
  }
  function discard() { staged.delete(K(cur)); ask = null; refused = false; load(cur); show(at); render(); }

  // ── Rail: the walk ──────────────────────────────────────────────────────
  const entry = (id, name) => h('button.st', { type: 'button', data: { stage: id }, on: { click: () => show(id) } }, h('span.n', { text: name }), h('span.v'));
  const railEls = new Map([['overview', entry('overview', PB_COPY.overview)], ...PB_STEPS.map((x) => [x.id, entry(x.id, x.title)])]);
  rail.replaceChildren(...railEls.values());
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
  function paintRail() {
    for (const [id, el] of railEls) {
      el.classList.toggle('open', id === at || (id === 'overview' && at === 'advanced'));
      el.setAttribute('aria-current', String(id === at));
      el.querySelector('.v').textContent = id === 'overview' ? (meta.name || (cur.name === NEW ? 'New profile' : cur.name)) : (skipOf(id) ? PB_COPY.skipped : answer[id]());
      el.classList.toggle('skip', id !== 'overview' && !!skipOf(id));
    }
  }

  // ── Page parts ──────────────────────────────────────────────────────────
  const close = () => h('button.round.dx.pbx', { type: 'button', 'aria-label': 'Close Profile builder', text: '×', on: { click: () => setOn(false) } });
  const drow = (label, ctl, man, extra) => h('div.drow', {}, h('div.ctl', {}, h('div.fh', {}, h('b', { text: label })), ctl), h('div.man', {}, paras(man)), extra);
  /** Choice lines (the Volume drawer's grammar): radio + name + its own paragraph. */
  function choice(label, options, get, pick) {
    const lines = options.map((op) => {
      const radio = h('button.radio', { type: 'button', role: 'radio', aria: { label: op.label }, on: { click: () => pick(op.v) } });
      const el = h('div.chline', { data: { v: op.v } },
        h('div.chl', {}, radio, h('span.chn', { on: { click: () => pick(op.v) } }, h('b', { text: op.label }))),
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
  const chainPic = h('ol.pbchain', { 'aria-label': 'Signal chain: the matrix engine\'s part lit' },
    CHAIN.map((st) => h('li', { class: [MATRIX_STAGES.includes(st.id) && 'mx', OUTSIDE_STAGES.includes(st.id) && 'out', st.level && 'sub'].filter(Boolean).join(' ') },
      h('span.d'), h('span', { text: st.name }))));
  const holdRows = ['eq', 'crossfeed', 'correction', 'loudness'].map((id) => {
    const a = h('span.pa');
    const el = h('button.pbhold', { type: 'button', on: { click: () => show(id) } }, h('b', { text: PB_STEPS.find((x) => x.id === id).title }), a, h('span.pgo', { 'aria-hidden': 'true', text: '›' }));
    return { id, el, a };
  });
  const plCount = h('span.pa');
  plBtn.append(h('b', { text: 'DSP pipelines' }), plCount, h('span.pgo', { 'aria-hidden': 'true', text: '›' }));
  const pick = h('select', { 'aria-label': 'Profile' });
  pick.addEventListener('change', () => { const [st, name] = pick.value === NEW ? [home, NEW] : pick.value.split('\u0001'); go({ st, name }); });
  const nameBox = h('input.bnin', { type: 'text', 'aria-label': 'Profile name', maxlength: 60, spellcheck: 'false', placeholder: PROFILE_COPY.name });
  nameBox.addEventListener('input', () => { meta.name = nameBox.value.trim(); refused = false; paintState(); paintRail(); });
  nameBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameBox.blur(); });
  const stTxt = h('span.v');
  const stBtn = h('button.vfd.bstn', { type: 'button', aria: { haspopup: 'menu' } }, h('span.l', { text: 'Stations' }), stTxt);
  const stMenu = h('div.pop.pmenu.amenu.bstmenu', { role: 'menu', 'aria-label': 'Stations' });
  popover({ trigger: stBtn, panel: stMenu });
  const desc = h('textarea', { 'aria-label': 'Profile description', spellcheck: 'false', maxlength: 500, placeholder: PROFILE_COPY.desc });
  desc.addEventListener('input', () => { meta.desc = desc.value; paintState(); });
  const stateLine = h('div.pbstate', { role: 'status' });
  const cap = h('span.pbcap');
  const del = h('button.btn.sm', { type: 'button', text: 'Delete', on: { click: () => confirm(PROFILE_COPY.remove(cur.name), remove) } });
  const discardBtn = h('button.btn.sm', { type: 'button', text: 'Discard', on: { click: () => discard() } });
  const saveBtn = h('button.btn.sm.pbsave', { type: 'button', text: 'Save', on: { click: () => save() } });
  acts.push({ discard: discardBtn, save: saveBtn });
  const askHost = h('div.pbask');
  const overview = h('div.pbov', {},
    h('div.sh.btitle', {}, h('span.t', { text: 'Profile builder' }), h('span.ln'), close()),
    h('div.pbovtop', {},
      h('div.pbovl', {}, h('p.pbintro', { text: PB_COPY.intro }),
        h('div.pbholds', {}, h('div.pbhh', { text: PB_COPY.holds }), holdRows.map((r) => r.el), plBtn)),
      chainPic),
    h('div.pbsavebox', {},
      h('div.pbid', {},
        h('label.vfd.pbpick', {}, h('span.l', { text: 'Profile' }), pick),
        h('label.vfd.bname.pbname', {}, h('span.l', { text: 'Name' }), nameBox),
        h('div.bstw', {}, stBtn, stMenu)),
      h('label.desc.pbdesc', {}, desc, pencil()),
      askHost,
      h('div.pbfoot', {}, h('div.pbstw', {}, stateLine, cap), h('span.grow'),
        h('button.btn.sm', { type: 'button', text: PB_COPY.scratch, on: { click: () => { load(cur, { meta: structuredClone(meta), vals: scratch() }); show(PB_STEPS[0].id); render(); } } }),
        h('button.btn.sm', { type: 'button', text: PB_COPY.change, on: { click: () => show(PB_STEPS[0].id) } }),
        del, discardBtn, saveBtn)),
    h('button.pbadvlink', { type: 'button', on: { click: () => show('advanced') } }, PB_COPY.advanced, h('span', { 'aria-hidden': 'true', text: ' ›' })),
  );

  // Steps
  const listenSeg = seg({ aria: 'Listening', options: LISTEN, value: 'speakers', onChange: (x) => { meta.listen = x; paint(); paintState(); } });
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

  const nextOf = (i) => { for (let k = i + 1; k < PB_STEPS.length; k++) if (!skipOf(PB_STEPS[k].id)) return PB_STEPS[k].id; return 'overview'; };
  const prevOf = (i) => { for (let k = i - 1; k >= 0; k--) if (!skipOf(PB_STEPS[k].id)) return PB_STEPS[k].id; return 'overview'; };
  /** A step's page: header (title, step n of t, ×), guidance or skip line, rows, Back / Next. */
  function stepPage(id) {
    const i = PB_STEPS.findIndex((x) => x.id === id);
    const st = PB_STEPS[i];
    const skip = skipOf(id);
    const last = nextOf(i) === 'overview';
    return h('div.pbstepp', {},
      h('div.sh.btitle', {}, h('span.t', { text: st.title }), h('span.pbn', { text: PB_COPY.stepOf(i + 1, PB_STEPS.length) }), h('span.ln'), close()),
      h('p.pbguide', { class: skip && 'skip', text: skip || st.guide(ctx()) }),
      h('div.pbsrows', {}, skip ? [] : stepRows(id)),
      h('div.pbnav', {}, h('span.grow'),
        h('button.btn.sm', { type: 'button', text: PB_COPY.back, on: { click: () => show(prevOf(i)) } }),
        h('button.btn.sm.pbnext', { type: 'button', text: last ? PB_COPY.review : PB_COPY.next, on: { click: () => show(nextOf(i)) } })));
  }
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
    if (!railEls.has(id) && id !== 'advanced') id = 'overview';
    closeOthers(null);
    at = id;
    let content;
    if (id === 'overview') content = overview;
    else if (id === 'advanced') content = h('div.pbstepp', {},
      h('div.sh.btitle', {}, h('span.t', { text: PB_COPY.advanced }), h('span.ln'), close()),
      h('div.pbsrows', {}, drow('Engine', engSeg, R.engine.man, engList.el), drow('Expand HF', hfSeg, R.expand.man), drow('IIR to FIR', iirSeg, R.iir.man, iirList.el)),
      h('div.pbnav', {}, h('span.grow'), h('button.btn.sm', { type: 'button', text: PB_COPY.overview, on: { click: () => show('overview') } })));
    else content = stepPage(id);
    page.replaceChildren(content);
    shape = shapeNow();
    if (ready) { paint(); paintState(); }
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
    paintRail();
  }

  function render() {
    pick.replaceChildren(...stations.map((st) => h('optgroup', { label: st.name },
      Object.keys(records[st.name]).map((n) => h('option', { value: st.name + '\u0001' + n, text: isDirty({ st: st.name, name: n }) ? `${n} •` : n })))),
    h('option', { value: NEW, text: staged.has(NEW) || (cur.name === NEW && dirty()) ? 'New profile •' : 'New profile' }));
    pick.value = K(cur) === NEW ? NEW : K(cur);
    const isDef = cur.name === DEFAULT;
    nameBox.value = meta.name;
    nameBox.readOnly = isDef;   // the station's unnamed profile: the daemon's name, not one to change (v1)
    desc.value = meta.desc;
    del.hidden = cur.name === NEW || isDef;
    askHost.replaceChildren(...(ask ? [h('div.bask', { role: 'alert' },
      h('span', { text: ask.text }),
      h('button.btn.sm', { type: 'button', text: 'Confirm', on: { click: () => { const f = ask.onConfirm; ask = null; f(); } } }),
      h('button.btn.sm', { type: 'button', text: 'Cancel', on: { click: () => { ask = null; render(); } } }))] : []));
    paintStations();
    paint();
    paintState();
  }

  /** Stations menu (Snapshot builder's): ✓ = Save writes there; a station already holding this name shows it. */
  function paintStations() {
    stTxt.textContent = meta.stations.join(' · ') || '—';
    stBtn.title = meta.stations.join(' · ');
    const name = meta.name || (cur.name === NEW ? '' : cur.name);
    stMenu.replaceChildren(...stations.map((st) => h('button.pmrow', { type: 'button', role: 'menuitemcheckbox',
      aria: { checked: meta.stations.includes(st.name) },
      on: { click: () => {
        meta.stations = meta.stations.includes(st.name) ? meta.stations.filter((n) => n !== st.name)
          : stations.map((s2) => s2.name).filter((n) => n === st.name || meta.stations.includes(n));
        paintStations(); paintState();
      } } },
      h('b', { text: st.name }), name && records[st.name][name] && !(st.name === cur.st && name === cur.name) && h('span', { text: name }))));
  }

  function paintState() {
    const d = dirty();
    for (const a of acts) {
      a.discard.disabled = !d;
      if (a.save) a.save.disabled = (!d && cur.name !== NEW) || !meta.stations.length;
    }
    const runs = meta.stations.includes(home);   // only the loaded station's profiles can run
    const isRunning = cur.st === home && cur.name === o.running();
    stateLine.textContent = d || cur.name === NEW ? (runs ? PB_COPY.state.dirtyRun : PB_COPY.state.dirty) : isRunning ? PB_COPY.state.running : PB_COPY.state.saved;
    stateLine.classList.toggle('dirty', d || cur.name === NEW);
    cap.replaceChildren(refused ? h('span.bref', { text: PROFILE_COPY.noName }) : '');
    const opt0 = pick.selectedOptions[0];
    if (opt0) opt0.textContent = (cur.name === NEW ? 'New profile' : cur.name) + (d ? ' •' : '');
  }
  o.levelBus.addEventListener('level', () => { if (ready && !body.hidden) paint(); });

  // ── Save / delete (mock: this component's records) ──────────────────────
  function confirm(text, onConfirm) { closeOthers(null); ask = { text, onConfirm }; show('overview'); render(); }
  function save() {
    const name = meta.name.trim();
    if (!name) { closeOthers(null); refused = true; if (at !== 'overview') show('overview'); paintState(); nameBox.focus(); return; }
    const to = meta.stations;
    if (!to.length) return;
    const own = cur.name !== NEW && to.includes(cur.st);
    const clash = to.some((st) => records[st][name] && !(own && st === cur.st && name === cur.name));
    const write = () => {
      const rec = { desc: meta.desc, listen: meta.listen, vals: { ...v } };
      if (cur.name !== NEW && !own && cur.name !== DEFAULT) delete records[cur.st][cur.name];   // unticked its own station: moved
      for (const st of to) {
        if (own && st === cur.st && name !== cur.name) {   // renamed in place: keeps its place in the list
          const next = {};
          for (const [k, x] of Object.entries(records[st])) if (k !== name) next[k === cur.name ? name : k] = k === cur.name ? rec : x;
          records[st] = next;
        } else records[st][name] = structuredClone(rec);
      }
      staged.delete(K(cur));
      cur = { st: own ? cur.st : to[0], name };
      load(cur);
      show('overview'); render();
      // Saving restarts the engine; with the loaded station written, the profile runs (main.js).
      o.onSaved?.(to.map((st) => [st, Object.keys(records[st])]), rec, name, to.includes(home));
      paintState();
    };
    if (clash) confirm(PROFILE_COPY.overwrite(name), write);
    else write();
  }
  function remove() {
    delete records[cur.st][cur.name];
    staged.delete(K(cur));
    cur = { st: cur.st, name: Object.keys(records[cur.st])[0] ?? NEW };
    load(cur); show('overview'); render();
    o.onSaved?.([[cur.st, Object.keys(records[cur.st])]]);
  }

  // ── Swap ────────────────────────────────────────────────────────────────
  function setOn(on, toChain = true) {
    closeOthers(null);
    closeSheets();
    if (on) { settings.setOn(false); snapshot()?.setOn(false, false); }
    body.hidden = !on;
    if (on) chain.hidden = true; else if (toChain) chain.hidden = false;
    btn.setAttribute('aria-pressed', String(on));
    if (on) {
      ask = null;
      // What's loaded may have moved since (a chain tweak): an untouched New profile follows it.
      if (cur.name === NEW && !staged.has(NEW) && !dirty()) load(cur);
      show('overview'); render();
    }
    window.dispatchEvent(new Event('resize'));
  }
  btn.addEventListener('click', () => setOn(true));
  // Capture: an open drawer, popover or sheet hears Escape first; with nothing open it leaves the builder.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || body.hidden || anyOpen() || sheetOpen() || body.querySelector('.drawer:not([data-closed])')) return;
    if (ask) { ask = null; render(); return; }
    setOn(false);
  }, true);

  load(cur);
  ready = true;
  show('overview');
  render();
  return { setOn, isOn: () => !body.hidden };
}

/** The description's pencil (it marks the text as the user's to edit). */
const pencil = () => s('svg', { viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4,
  'stroke-linejoin': 'round', 'aria-hidden': 'true' }, s('path', { d: 'M10.5 2.5l3 3-8 8H2.5v-3z' }), s('path', { d: 'M9 4l3 3' }));
