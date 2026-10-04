// DSP pipelines drawer: tabs. Overview = the routing alone; then one tab per output channel in use.
//
// Overview  the pin grid on the whole panel: inputs (source channels) down the side, outputs (mix channels) across the
//           top, one pin per crosspoint, so a column is one output bus. Pin: glass well = no pipeline; amber jewel =
//           routed, its gain engraved (or `×n` when it holds several); `ø` = a negative Lin gain; dashed edge + the block's
//           name = a crossfeed block; a fill along its foot = its share of all pipelines. Tap a lit pin → that output's
//           tab, on that input; tap an empty one → a new pipeline there (0 dB, empty chain), same tab. Beside the grid:
//           the totals, `Import EQ…` (onto the stereo pair) and `Upload convolution filters`, and the
//           manual's Pipelines and convolution paragraphs.
// Out x     everything feeding that speaker, one input at a time: an input switch (`L · 48 | R · 12`, `+` adds an input
//           not yet feeding it), `+ Pipeline`, then that input's pipelines as a fixed page of 6 lines (`#n`, chain as compact text,
//           gain) with numbered page buttons; a crossfeed block folds to one line. Under the list, the selected pipeline
//           only, as one chip strip (`+` stage, gain last, `Raw`, `×`); under that, its stage editor (the dock) beside
//           the plot (`#n` · `L → L` the crosspoint summed · `Out L` one trace per input). PEQ bands drag on the plot.
// Channels named while the daemon names them (slots 1–8, readme §1.9), numbers beyond. Up to 8 a side. Every edit stages profile-wide (matrix family, dirty dot on the tab it was made in); the
// crossfeed blocks follow the Crossfeed drawer's staged values; everything grays while the matrix engine is bypassed.

import { h, s, grayBut } from '../lib/dom.js';
import { withXref } from '../lib/xref.js';
import { popover } from '../lib/popover.js';
import { seg, select } from './seg.js';
import { mountRespPlot } from './resp-plot.js';
import { pipeH, cplx, toDb } from '../lib/xdsp.js';
import { processSpec, parseProcess } from '../lib/procspec.js';
import { structuralRows, compRows } from '../lib/xblocks.js';
import { chShort, chName, PMAN, IIR_TYPES, ARG_NAME, ARG_UNIT, DELAY_ARGS, DELAY_V, KINDS, AUTOEQ } from '../data/pipelines.js';

const PAGE = 6, MAXP = 128;
const PEQ_TYPES = new Set(['peak', 'lshelf', 'hshelf']);
const BLOCK_NAME = { structural: 'Structural Crossfeed', comp: 'Bauer Crossfeed compensation' };
const mi = (v) => (v < 0 ? '−' : '') + Math.abs(v);
const fmtG = (v, dp = 1) => (v < 0 ? '−' : v > 0 ? '+' : '') + Math.abs(v).toFixed(dp);
const fmtHz = (f) => (f >= 1000 ? `${+(f / 1000).toFixed(2)}k` : `${+f}`);
const range = (n) => Array.from({ length: n }, (_, k) => k);
const xref = (go, label) => h('a.xref', { href: '#', on: { click: (e) => { e.preventDefault(); go(); } } }, label, h('span', { 'aria-hidden': 'true', text: ' ›' }));

/** Chain → chip groups: a run of ≥2 peak/shelf iir stages = one PEQ group (a block's own stages never join); gain last. */
function groups(p) {
  const g = [];
  p.stages.forEach((st, i) => {
    const peq = st.kind === 'iir' && PEQ_TYPES.has(st.type) && !st.blk;
    const last = g[g.length - 1];
    if (peq && last?.kind === 'peqrun') last.idx.push(i);
    else g.push({ kind: peq ? 'peqrun' : st.kind, idx: [i] });
  });
  for (const x of g) if (x.kind === 'peqrun') x.kind = x.idx.length > 1 ? 'peq' : 'iir';
  g.push({ kind: 'gain', idx: [] });
  return g;
}
function chipText(p, gr) {
  const st = p.stages[gr.idx[0]];
  switch (gr.kind) {
    case 'peq': return `Parametric Equalizer · ${gr.idx.length} bands`;
    case 'iir': return st.type === 'biquad' ? 'biquad' : `${st.type} ${fmtHz(st.f)} Hz`;
    case 'delay': return st.t !== undefined ? `delay ${+(st.t * 1000).toFixed(2)} ms` : st.s !== undefined ? `delay ${st.s} samples` : `delay ${st.d} m`;
    case 'riaa': return 'riaa';
    case 'gain': return p.unit === 'Lin' ? `Lin ${mi(+(+p.gain).toFixed(3))}` : `${fmtG(+p.gain)} dB`;
  }
  return st.file ? st.file.split('/').pop() : gr.kind;
}
// A fresh stage of each kind (`+` and the dock's Stage picker).
const NEW_STAGE = { iir: () => ({ kind: 'iir', type: 'peak', f: 1000, q: 1, g: 0 }), delay: () => ({ kind: 'delay', t: 0.001 }),
  riaa: () => ({ kind: 'riaa', subsonic: 1 }), conv: () => ({ kind: 'conv', file: 'impulse.wav' }) };
const rowText = (p) => groups(p).slice(0, -1).map((gr) => chipText(p, gr)).join(' · ') || '—';

/**
 * @param {object} cfg  PIPELINES (data/pipelines.js)
 * @param {{bypassed:(v:object)=>string, plate:HTMLElement, openCrossfeed:()=>void, goTab:(id:string)=>void}} deps
 * @returns {{overview:Function, output:(o:number)=>Function, count:()=>number, list:()=>object[], sync:(v:object)=>void}}
 */
export function createPipelines(cfg, { bypassed, plate, openCrossfeed, goTab }) {
  const pipes = cfg.pipes.map((p) => ({ ...p, stages: p.stages.map((x) => ({ ...x })) }));
  const nIn = cfg.inputs, nOut = cfg.outputs, fs = cfg.rate;
  // The stereo pair (In L→Out L, In R→Out R): what a crossfeed block rebuilds; its EQ + gain ride every block row.
  const ear = { 0: pipes.find((p) => p.src === 0 && p.mix === 0), 1: pipes.find((p) => p.src === 1 && p.mix === 1) };
  let block = { kind: 'none', key: 'none' }, mxWhy = '', watching = false;
  const raw = new Map();          // pipe → {text, error} while its strip is in Raw
  const openBlocks = new Set();   // block kinds unfolded in the lists
  const views = [];
  const at = (src, mix) => pipes.map((p, i) => [p, i]).filter(([p]) => p.src === src && p.mix === mix);
  const paint = () => { for (const v of views) v.paint(); };
  const stage = (ctx) => ctx.set('mxpipes', JSON.stringify(pipes));

  // ── Crossfeed blocks (follow the Crossfeed drawer's staged values) ──────
  function want(v) {
    const n = (k) => Number(v[k]);
    if (v.xfgate === '1' && v.xfimpl === 'structural') {
      const prm = { angle: n('xsangle'), circ: n('xscirc'), lambda: n('xslambda') };
      return { kind: 'structural', prm, key: `s${prm.angle}|${prm.circ}|${prm.lambda}`,
        sum: `${prm.angle.toFixed(1)}° · ${prm.circ.toFixed(2)} cm · ${Math.round(prm.lambda * 100)}%` };
    }
    if (v.xfgate === '1' && v.xfimpl === 'bauer' && n('xfcomp') > 0) {
      const prm = { preset: v.xfpreset, freq: n('xffreq'), level: n('xflevel'), comp: n('xfcomp') };
      return { kind: 'comp', prm, key: `c${prm.preset}|${prm.freq}|${prm.level}|${prm.comp}`, sum: `${Math.round(prm.comp)}%` };
    }
    return { kind: 'none', key: 'none' };
  }
  function rebuild(b, force) {
    if (!force && b.key === block.key) return;
    for (let k = pipes.length - 1; k >= 0; k--) if (pipes[k].gen || pipes[k] === ear[0] || pipes[k] === ear[1]) { raw.delete(pipes[k]); pipes.splice(k, 1); }
    pipes.unshift(...(b.kind === 'structural' ? structuralRows(ear, b.prm) : b.kind === 'comp' ? compRows(ear, b.prm) : [ear[0], ear[1]].filter(Boolean)));
    block = b;
    for (const v of views) v.reset?.();
  }
  let ctx0 = null;   // the first block's ctx: stages an EQ landed from outside (Profile builder's EQ / Correction)
  function watch(ctx) {
    if (watching) return;
    watching = true;
    ctx0 = ctx;
    ctx.init('mxpipes', JSON.stringify(pipes));
    // Discard (mock): the pipeline set goes back to the last applied one; the stereo pair is found again and any crossfeed
    // block rebuilt from it (its rows share the pair's EQ objects again).
    ctx.onDiscard((b) => {
      const back = JSON.parse(b.mxpipes);
      pipes.splice(0, pipes.length, ...back);
      ear[0] = back.find((p) => !p.gen && p.src === 0 && p.mix === 0);
      ear[1] = back.find((p) => !p.gen && p.src === 1 && p.mix === 1);
      raw.clear();
      mxWhy = bypassed(b);
      rebuild(want(b), true);
      paint();
    });
    ctx.watch((v) => {
      const w = bypassed(v), b = want(v);
      if (w !== mxWhy || b.key !== block.key) { mxWhy = w; rebuild(b); paint(); }
    });
  }

  // ── Shared popovers: add-stage / add-input menu, Import EQ ─────────────
  const place = (panel, btn, alignRight) => {
    const r = btn.getBoundingClientRect(), pr = plate.getBoundingClientRect(), k = pr.width / plate.offsetWidth;
    panel.style.top = `${(r.bottom - pr.top) / k + 6}px`;
    if (alignRight) { panel.style.left = 'auto'; panel.style.right = `${(pr.right - r.right) / k}px`; }
    else { panel.style.right = 'auto'; panel.style.left = `${(r.left - pr.left) / k}px`; }
  };
  const menu = h('div.pop.pmenu', { role: 'menu' });
  plate.append(menu);
  const menuPop = popover({ trigger: h('button', { hidden: true }), panel: menu, inside: [] });
  function openMenu(btn, rows) {
    menuPop.inside.length = 0; menuPop.inside.push(btn);
    place(menu, btn, false);
    menu.replaceChildren(...rows.map(([label, fn]) => h('button.pmrow', { type: 'button', role: 'menuitem', text: label, on: { click: () => { menuPop.close(); fn(); } } })));
    menuPop.open();
  }

  const q = h('input.vfd.pq', { type: 'search', placeholder: AUTOEQ.placeholder, 'aria-label': 'Search AutoEq' });
  const hitsHost = h('div.phits');
  const mirror = h('input', { type: 'checkbox', checked: true });
  const impPanel = h('div.pop.pimp', { role: 'dialog', 'aria-label': 'Import EQ' }, q, hitsHost,
    h('div.pimpf', {}, h('label.chk', {}, mirror, AUTOEQ.mirror), h('span.grow'), h('button.btn.xs', { type: 'button', text: '.txt file…' })));
  plate.append(impPanel);
  const impPop = popover({ trigger: h('button', { hidden: true }), panel: impPanel, inside: [] });
  let impFor = null;   // {btn, target: () => pipe, ctx}
  q.addEventListener('input', paintHits);
  function openImport(btn, target, ctx) {
    if (impPop.isOpen && impFor?.btn === btn) { impPop.close(); return; }
    impFor = { btn, target, ctx };
    impPop.inside.length = 0; impPop.inside.push(btn);
    place(impPanel, btn, true);
    paintHits(); impPop.open(); q.focus();
  }
  function paintHits() {
    const t = q.value.trim().toLowerCase();
    hitsHost.replaceChildren(...AUTOEQ.hits.filter((x) => !t || x.name.toLowerCase().includes(t)).map((x) =>
      h('button.pmrow', { type: 'button', on: { click: () => applyEq(x) } }, h('b', { text: x.name }), h('span', { text: x.src }))));
  }
  function applyEq(x) {
    const eq = x.bands.map(([f, g, qq, type = 'peak']) => ({ kind: 'iir', type, f, g, q: qq }));
    const cur = impFor.target();
    if (!cur) return;
    const p = cur.gen ? ear[cur.ear] : cur;   // a block row's EQ is its ear's
    const target = [p];
    if (mirror.checked) {   // the same profile onto the stereo pair's other side, when it exists
      const twin = cur.gen ? ear[1 - cur.ear] : pipes.find((o) => o !== p && o.src === (p.src ^ 1) && o.mix === (p.mix ^ 1));
      if (twin && p.src < 2 && p.mix < 2) target.push(twin);
    }
    for (const t of target) { t.stages = [...t.stages.filter((st) => !(st.kind === 'iir' && PEQ_TYPES.has(st.type))), ...eq]; t.gain = x.pre; t.unit = 'dB'; }
    if (block.kind !== 'none') rebuild(block, true);
    impPop.close(); stage(impFor.ctx); paint();
  }

  // ── Overview ──────────────────────────────────────────────────────────
  function overview(host, ctx) {
    watch(ctx);
    const gridHost = h('div.ogrid');
    const totals = h('div.ptot');
    const impBtn = h('button.btn.xs', { type: 'button', text: 'Import EQ…' });
    impBtn.addEventListener('click', () => openImport(impBtn, () => ear[0] || ear[1], ctx));
    const files = h('input', { type: 'file', accept: '.wav', multiple: true, hidden: true });
    const upBtn = h('button.btn.xs', { type: 'button', text: 'Upload convolution filters', on: { click: () => files.click() } });
    const fileList = h('div.ofiles');
    files.addEventListener('change', () => fileList.replaceChildren(...[...files.files].map((f) => h('span.vfd.pfile', { text: f.name }))));
    const reason = h('span.gr', { hidden: true });
    const body = h('div.obody', {},
      h('div.oleft', {}, h('div.fh', {}, h('b', { text: 'Routing' })), gridHost),
      h('div.oright', {}, totals, reason,
        h('div.oacts', {}, impBtn, upBtn, files), fileList,
        h('div.man', {}, h('p', { text: PMAN.pipelines }), h('p', { text: PMAN.conv }))));
    host.append(body);

    function pin(src, mix, size) {
      const here = at(src, mix);
      const on = here.length > 0, first = here[0]?.[0];
      const gen = here.find(([p]) => p.gen)?.[0]?.gen;
      const neg = here.some(([p]) => p.unit === 'Lin' && p.gain < 0);
      const label = !on ? '' : here.length > 1 ? `×${here.length}` : first.unit === 'Lin' ? mi(+(+first.gain).toFixed(3)) : `${fmtG(+first.gain)} dB`;
      return h('button.pin.opin', {
        type: 'button', class: [on && 'on', gen && 'gen'].filter(Boolean).join(' '), style: `width:${size}px;height:${size}px`,
        'aria-label': `${chName(src)} to ${chName(mix)}${on ? `, ${here.length} pipeline${here.length > 1 ? 's' : ''}` : ', empty'}`,
        on: { click: () => {
          if (!on) { pipes.push({ src, mix, gain: 0, unit: 'dB', stages: [] }); stage(ctx); }
          views.find((v) => v.out === mix)?.focus(src, on ? null : pipes.length - 1);
          paint(); goTab(`out${mix}`);
        } },
      }, h('span.dot'), on && h('span.pg', { text: label }), gen && h('span.pgn', { text: 'Crossfeed' }),
        neg && h('span.pol', { text: 'ø' }),
        here.length > 1 && h('span.pfill', { style: `width:${Math.max(6, Math.round(100 * here.length / pipes.length))}%` }));
    }
    function paintOv() {
      const cell = Math.max(44, Math.min(112, Math.floor(440 / Math.max(nIn, nOut))));
      gridHost.style.gridTemplateColumns = `48px repeat(${nOut}, ${cell}px)`;
      gridHost.replaceChildren(...[
        h('span.pcorner', {}, h('span', { text: 'Out' }), h('span', { text: 'In' })),
        range(nOut).map((o) => h('button.pch.out.otab', { type: 'button', title: chName(o), text: chShort(o), on: { click: () => goTab(`out${o}`) } })),
        range(nIn).map((i) => [h('span.pch.in', { title: chName(i), text: chShort(i) }), range(nOut).map((o) => pin(i, o, cell))]),
      ].flat(3));
      const over = pipes.length > MAXP;
      totals.replaceChildren(`${nIn} in · `, h('span', { class: over && 'over', text: over ? `${pipes.length} / ${MAXP} pipelines` : `${pipes.length} pipelines` }), ` · ${nOut} out`);
      grayBut(body, reason, !!mxWhy);   // the reason stays legible: it links to the Matrix engine
      for (const x of body.querySelectorAll('button,input')) x.disabled = !!mxWhy;
      reason.replaceChildren(...withXref(mxWhy)); reason.hidden = !mxWhy;
    }
    views.push({ paint: paintOv });
    paintOv();
  }

  // ── One output ────────────────────────────────────────────────────────
  const output = (o) => (host, ctx) => {
    watch(ctx);
    let src = null, selPipe = -1, page = 0, selChip = 0, selBand = 0, scope = 'auto';
    const inputs = () => [...new Set(pipes.filter((p) => p.mix === o).map((p) => p.src))].sort((a, b) => a - b);

    const inHost = h('div.oin');
    const pager = h('div.opg');
    const addPipe = h('button.btn.xs', { type: 'button', text: '+ Pipeline', on: { click: () => {
      if (src === null) return;
      pipes.push({ src, mix: o, gain: 0, unit: 'dB', stages: [] }); selPipe = pipes.length - 1; selChip = 0;
      page = Math.floor((items(at(src, o)).length - 1) / PAGE); stage(ctx); paint();
    } } });
    const reason = h('span.gr', { hidden: true });
    const rows = h('div.plrows.orows', { role: 'listbox', 'aria-label': `Pipelines into ${chName(o)}` });
    const editor = h('div.pstrips');
    const dock = h('div.pdock');
    const scopeHost = h('div.pscope');
    const plotHost = h('div.eq.pplot');
    const body = h('div.oout', {},
      h('div.ohead', {}, h('span.cl', { text: 'In' }), inHost, h('span.grow'), reason, addPipe),
      h('div.olist', {}, rows, pager),
      h('div.pedit', {}, editor, dock),
      h('div.pplotwrap', {}, scopeHost, plotHost));
    host.append(body);
    const rp = mountRespPlot(plotHost, { lo: -21, hi: 9, step: 6, minor: 3, aria: `Response into ${chName(o)}` });

    // Items for one input's list: rows, a folded block standing in for its rows (a header line when unfolded).
    function items(here) {
      const out = [], seen = new Set();
      for (const [p, i] of here) {
        if (p.gen && !openBlocks.has(p.gen)) {
          if (!seen.has(p.gen)) { seen.add(p.gen); out.push({ fold: p.gen, n: here.filter(([q2]) => q2.gen === p.gen).length, first: i }); }
        } else {
          if (p.gen && !seen.has(p.gen)) { seen.add(p.gen); out.push({ head: p.gen, n: here.filter(([q2]) => q2.gen === p.gen).length, first: i }); }
          out.push({ p, i, inBlock: !!p.gen });
        }
      }
      return out;
    }
    views.push({
      out: o,
      focus(s2, pipe) {
        src = s2; const here = at(s2, o); selPipe = pipe ?? here[0]?.[1] ?? -1; selChip = 0; selBand = 0;
        const idx = items(here).findIndex((x) => x.p && x.i === selPipe); page = idx < 0 ? 0 : Math.floor(idx / PAGE);
      },
      reset() { selPipe = -1; page = 0; selChip = 0; },
      paint: () => paintOut(),
    });

    function paintOut() {
      const ins = inputs();
      if (src === null || !ins.includes(src)) src = ins[0] ?? null;
      const here = src === null ? [] : at(src, o);
      if (!here.some(([, i]) => i === selPipe)) { selPipe = here[0]?.[1] ?? -1; selChip = 0; }
      // Input switch: each input feeding this output, with its count; `+` adds one that doesn't yet.
      const others = range(nIn).filter((i) => !ins.includes(i));
      inHost.replaceChildren(...[
        ins.length ? seg({ aria: 'Input', cls: 'enum oinseg view', value: String(src), options: ins.map((i) => ({ v: String(i), label: `${chShort(i)} · ${at(i, o).length}` })),
          onChange: (v) => { src = +v; selPipe = -1; page = 0; paintOut(); } }) : h('span.cap', { text: '—' }),
        others.length > 0 && h('button.chip.add', { type: 'button', text: '+', 'aria-label': 'Add an input',
          on: { click: (e) => openMenu(e.currentTarget, others.map((i) => [`In ${chShort(i)} — ${chName(i)}`, () => {
            pipes.push({ src: i, mix: o, gain: 0, unit: 'dB', stages: [] }); src = i; selPipe = pipes.length - 1; page = 0; stage(ctx); paint();
          }])) } }),
      ].filter(Boolean));
      // A fixed page of rows, numbered page buttons.
      const its = items(here);
      const pages = Math.max(1, Math.ceil(its.length / PAGE));
      page = Math.min(page, pages - 1);
      rows.replaceChildren(...its.slice(page * PAGE, (page + 1) * PAGE).map(listRow));
      const go = (k) => { page = (k + pages) % pages; paintOut(); };
      pager.replaceChildren(...(pages > 1 ? [
        h('span.cl', { text: 'Page' }),
        h('button.round.pbn', { type: 'button', text: '‹', 'aria-label': 'Previous page', on: { click: () => go(page - 1) } }),
        range(pages).map((k) => h('button.opb', { type: 'button', class: k === page && 'on', text: String(k + 1),
          'aria-label': `Page ${k + 1}`, 'aria-current': String(k === page), on: { click: () => go(k) } })),
        h('button.round.pbn', { type: 'button', text: '›', 'aria-label': 'Next page', on: { click: () => go(page + 1) } }),
        h('span.opr', { text: `${page * PAGE + 1}–${Math.min(its.length, (page + 1) * PAGE)} of ${its.length}` }),
      ].flat() : []));
      // Editor, dock, plot.
      const p = pipes[selPipe];
      editor.replaceChildren(...(p ? [strip(p, selPipe)] : []));
      paintDock(); plot();
      grayBut(body, reason, !!mxWhy);
      for (const x of body.querySelectorAll('button,input')) x.disabled = !!mxWhy;
      reason.replaceChildren(...withXref(mxWhy)); reason.hidden = !mxWhy;
    }
    function listRow(x) {
      if (x.fold || x.head) {
        const kind = x.fold || x.head, open = !x.fold;
        const el = h('div.plrow.plfold', { class: !open && pipes[selPipe]?.gen === kind && 'sel', role: 'option' },
          h('button.pltw', { type: 'button', text: open ? '▾' : '▸', 'aria-expanded': String(open), 'aria-label': `${open ? 'Fold' : 'Unfold'} ${BLOCK_NAME[kind]}`,
            on: { click: () => { if (open) openBlocks.delete(kind); else openBlocks.add(kind); paint(); } } }),
          xref(openCrossfeed, BLOCK_NAME[kind]), h('span.pls', { text: `${x.n} rows · ${block.sum || ''}` }));
        el.addEventListener('click', (e) => { if (!e.target.closest('button,a')) pick(x.first); });
        return el;
      }
      const p = x.p;
      return h('div.plrow', { class: [x.i === selPipe && 'sel', x.inBlock && 'inblk'].filter(Boolean).join(' '), role: 'option',
        'aria-selected': String(x.i === selPipe), on: { click: () => pick(x.i) } },
        h('span.ppn', { text: `#${x.i + 1}` }),
        h('span.plc', { text: raw.has(p) ? processSpec(p.stages) : rowText(p) }),
        h('span.plg', { text: chipText(p, { kind: 'gain', idx: [] }) + (p.unit === 'Lin' && p.gain < 0 ? ' ø' : '') }));
    }
    function pick(i) { selPipe = i; selChip = 0; selBand = 0; paintOut(); }

    // The selected pipeline's strip.
    function strip(p, i) {
      const r = raw.get(p);
      let parts;
      if (r) {
        const input = h('input.vfd.praw', { type: 'text', value: r.text, spellcheck: 'false', readonly: !!p.gen, 'aria-label': `Pipeline ${i + 1} process string` });
        input.addEventListener('change', () => {
          const res = parseProcess(input.value);
          r.text = input.value; r.error = res.error;
          if (res.stages) { p.stages = res.stages; selChip = 0; selBand = 0; stage(ctx); }
          paint();
        });
        parts = [input, r.error && h('span.gr.prerr', { text: r.error })];
      } else {
        const gs = groups(p);
        parts = [h('div.pchips', {},
          gs.slice(0, -1).map((gr, gi) => chip(p, gr, gi)),
          !p.gen && h('button.chip.add', { type: 'button', text: '+', 'aria-label': 'Add a stage', on: { click: (e) => openMenu(e.currentTarget, KINDS.map((k) => [k.label, () => {
            p.stages.push(NEW_STAGE[k.k]()); focusStage(p, p.stages.length - 1); stage(ctx); paint();
          }])) } }),
          h('span.pwire')),
        chip(p, gs[gs.length - 1], gs.length - 1)];
      }
      return h('div.pstrip.ped', {},
        h('span.ppn', { text: `#${i + 1}` }), parts,
        h('button.btn.xs.praw-t', { type: 'button', text: 'Raw', 'aria-pressed': String(!!r),
          on: { click: () => { if (r) raw.delete(p); else raw.set(p, { text: processSpec(p.stages), error: '' }); paint(); } } }),
        !p.gen && h('button.round.px', { type: 'button', text: '×', 'aria-label': `Remove pipeline ${i + 1}`,
          on: { click: () => { pipes.splice(i, 1); raw.delete(p); for (const k of [0, 1]) if (ear[k] === p) ear[k] = null; selPipe = -1; stage(ctx); paint(); } } }));
    }
    function chip(p, gr, gi) {
      const locked = p.gen && (gr.kind === 'gain' || !!p.stages[gr.idx[0]]?.blk);
      const cls = [`k-${gr.kind}`, gi === selChip && 'sel', locked && 'lock'].filter(Boolean).join(' ');
      const pick = () => { selChip = gi; selBand = 0; paintOut(); };
      if (p.gen || gr.kind === 'gain') return h('button.chip', { type: 'button', class: cls, on: { click: pick } }, chipText(p, gr));
      // Every removable pill carries its own ×: the one place a stage is removed.
      return h('span.chip.chipw', { class: cls },
        h('button.chipl', { type: 'button', text: chipText(p, gr), on: { click: pick } }),
        h('button.chipx', { type: 'button', text: '×', 'aria-label': `Remove ${chipText(p, gr)}`, on: { click: () => {
          p.stages = p.stages.filter((_, k) => !gr.idx.includes(k));
          if (gi < selChip) selChip--;
          selBand = 0; raw.delete(p); stage(ctx); paint();
        } } }));
    }

    // ── Dock ──
    // One shape for every stage, read top to bottom under its chip (the chip names the stage, so no title):
    //   row 1  what it is   (stage kind, band stepper, filter type, unit) ··· a locked stage's owner link at the right end
    //   row 2  its values   (labelled boxes with their units, in wire order)
    //   copy   what they mean, full width under the controls it explains
    const tline = (code, text) => h('p.ptl', {}, h('code', { text: code }), ' ', text);
    const paras = (...xs) => xs.filter(Boolean).map((x) => h('p.pmp', { text: x }));
    const lab = (t) => h('span.cl.pdl', { text: t });
    const numBox = (val, aria, onCommit, width) => {
      const el = h('input.vfd', { type: 'number', value: val ?? '', step: 'any', 'aria-label': aria, style: width && `width:${width}px` });
      el.addEventListener('change', () => onCommit(Number(el.value)));
      return el;
    };
    function paintDock() {
      const p = pipes[selPipe];
      dock.hidden = !p || raw.has(p);
      if (dock.hidden) return;
      const gs = groups(p);
      selChip = Math.min(selChip, gs.length - 1);
      const gr = gs[selChip];
      const after = () => { stage(ctx); paint(); };
      let d;   // {what, right, values, copy}
      if (p.gen && (gr.kind === 'gain' || p.stages[gr.idx[0]]?.blk)) d = lockedDock(p, gr);
      else {
        const right = null;   // removal lives on the pill's ×
        switch (gr.kind) {
          case 'gain': {
            const unit = seg({ aria: 'Gain unit', cls: 'enum mini2', value: p.unit, options: [{ v: 'dB', label: 'dB' }, { v: 'Lin', label: 'Lin' }],
              onChange: (v) => { p.unit = v; p.gain = v === 'Lin' ? +(10 ** (p.gain / 20)).toFixed(4) : +(20 * Math.log10(Math.abs(p.gain) || 1e-6)).toFixed(2); after(); } });
            d = { values: [h('div.pfield', {}, lab('Gain'), numBox(p.gain, 'Gain', (v) => { p.gain = v; after(); }, 92), unit)], copy: paras(PMAN.gain) };
            break;
          }
          case 'peq': case 'iir': {
            selBand = Math.min(selBand, gr.idx.length - 1);
            const si = gr.idx[gr.kind === 'peq' ? selBand : 0];
            // Bands step here or by their dots on the plot; one band's editor at a time.
            const nb = gr.idx.length;
            const step = (k) => { selBand = (selBand + k + nb) % nb; paintDock(); plot(); };
            const nav = gr.kind === 'peq' && [lab('Band'), h('div.pbnav', {},
              h('button.round.pbn', { type: 'button', text: '‹', 'aria-label': 'Previous band', on: { click: () => step(-1) } }),
              h('span.pbl', { text: `${selBand + 1} / ${nb}` }),
              h('button.round.pbn', { type: 'button', text: '›', 'aria-label': 'Next band', on: { click: () => step(1) } }),
              !p.gen && h('button.round.pbn', { type: 'button', text: '+', 'aria-label': 'Add a band', on: { click: () => {
                p.stages.splice(gr.idx[nb - 1] + 1, 0, { kind: 'iir', type: 'peak', f: 1000, q: 1, g: 0 }); selBand = nb; after();
              } } }),
              !p.gen && h('button.round.pbn', { type: 'button', text: '−', 'aria-label': `Remove band ${selBand + 1}`, on: { click: () => {
                p.stages.splice(si, 1); selBand = Math.max(0, selBand - 1); after();
              } } }))];
            const e = iirEditor(p.stages[si], after);
            d = { what: [nav, lab('Type'), e.type], right, values: e.values, copy: e.copy };
            break;
          }
          case 'delay': { const e = delayEditor(p.stages[gr.idx[0]], after); d = { what: [lab('Given in'), e.unit], right, values: e.values, copy: [...e.copy, ...paras(PMAN.delay)] }; break; }
          case 'riaa': {
            const st = p.stages[gr.idx[0]];
            d = { right, values: [h('div.pfield', {}, lab('Subsonic filter'),
              seg({ aria: 'subsonic', cls: 'mini2', value: String(st.subsonic ?? 1), options: [{ v: '0', label: 'Off' }, { v: '1', label: 'On' }],
                onChange: (v) => { st.subsonic = +v; after(); } }))], copy: paras(PMAN.riaa) };
            break;
          }
          default: {
            const st = p.stages[gr.idx[0]];
            const isTxt = /\.txt$/i.test(st.file || '');
            d = { right, values: [h('div.pfield', {}, lab('File'), h('span.vfd.pfile', { text: st.file || '—' }), h('button.btn.xs', { type: 'button', text: 'Upload…' }))],
              copy: paras(isTxt ? PMAN.peqFile : PMAN.conv) };
          }
        }
      }
      // Every single stage leads with its kind, so a wrong pick from `+` is one change away.
      if (!p.gen && gr.kind !== 'gain' && gr.kind !== 'peq') d.what = [lab('Stage'), kindPicker(p, gr.idx[0], after), d.what];
      const what = [d.what].flat(3).filter(Boolean);
      dock.replaceChildren(...[
        (what.length || d.right) && h('div.pdr', {}, what, h('span.grow'), d.right),
        d.values?.length && h('div.pfields', {}, d.values),
        h('div.pdcopy', {}, d.copy.flat().filter(Boolean)),
      ].filter(Boolean));
    }
    function focusStage(p, si) {
      const gs = groups(p), gi = gs.findIndex((g) => g.idx.includes(si));
      selChip = Math.max(0, gi); selBand = gi < 0 ? 0 : gs[gi].idx.indexOf(si);
    }
    function kindPicker(p, si, after) {
      const cur = p.stages[si].kind;
      const opts = [...KINDS, ...(KINDS.some((k) => k.k === cur) ? [] : [{ k: cur, label: 'PEQ file' }])];
      const el = h('select.vfd.pkind', { 'aria-label': 'Stage kind' }, opts.map((k) => h('option', { value: k.k, selected: k.k === cur, text: k.label })));
      el.addEventListener('change', () => { p.stages[si] = NEW_STAGE[el.value](); focusStage(p, si); after(); });
      return el;
    }
    function lockedDock(p, gr) {
      const st = p.stages[gr.idx[0]];
      const right = xref(openCrossfeed, BLOCK_NAME[p.gen]);
      const ro = (txt) => h('span.vfd.pfile.pro', { text: txt });
      if (gr.kind === 'gain') return { right, values: [h('div.pfield', {}, lab('Gain'), ro(mi(+p.gain)), h('span.u.pu', { text: p.unit }))], copy: paras(PMAN.gain) };
      if (gr.kind === 'delay') {
        const a = DELAY_ARGS.find((x) => st[x.a] !== undefined);
        return { right, values: [h('div.pfield', {}, lab('Delay'), ro(`${a.a}=${st[a.a]}`), h('span.u.pu', { text: a.unit }))], copy: [tline(a.a, a.d), ...paras(PMAN.delay)] };
      }
      const def = IIR_TYPES.find((x) => x.t === st.type);
      const args = Object.keys(st).filter((k) => !['kind', 'type', 'blk'].includes(k)).map((k) => `${k}=${st[k]}`).join(' ');
      return { what: [lab('Type'), ro(`${def.d}: ${def.t}`)], right, values: [h('div.pfield', {}, lab('Arguments'), ro(args))],
        copy: [tline(def.t, PMAN.iirUnits)] };
    }
    function iirEditor(st, after) {
      const def = IIR_TYPES.find((x) => x.t === st.type) || IIR_TYPES[7];
      const typeSel = h('select.vfd.ptype', { 'aria-label': 'Filter type' },
        IIR_TYPES.map((x) => h('option', { value: x.t, selected: x.t === st.type, text: `${x.d}: ${x.t}` })));
      typeSel.addEventListener('change', () => {
        const v = typeSel.value, nd = IIR_TYPES.find((x) => x.t === v), keep = { kind: 'iir', type: v };
        for (const a of [...nd.args, ...nd.alt]) if (st[a] !== undefined) keep[a] = st[a];
        if (nd.alt.length && !nd.alt.some((a) => keep[a] !== undefined)) keep[nd.alt[0]] = nd.alt[0] === 's' ? 1 : 0.707;
        if (nd.args.includes('f') && keep.f === undefined) keep.f = 1000;
        if (nd.args.includes('g') && keep.g === undefined) keep.g = 0;
        if (v === 'biquad') Object.assign(keep, { b0: 1, b1: 0, b2: 0, a0: 1, a1: 0, a2: 0 });
        for (const k of Object.keys(st)) delete st[k];   // in place: block rows share their ear's EQ objects
        Object.assign(st, keep); after();
      });
      // The width argument: the manual's either/or (q=Q OR bw=bandwidth, q=Q OR s=slope) as "Width [n] as [Q | Bandwidth]".
      const altCur = def.alt.find((a) => st[a] !== undefined) || def.alt[0];
      const WNAME = { q: 'Q', bw: 'Bandwidth', s: 'Slope' };
      const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
      const box = (a) => numBox(st[a], ARG_NAME[a] || a, (v) => { st[a] = v; after(); }, def.t === 'biquad' ? 60 : 72);
      const field = (a) => (a === altCur && def.alt.length > 1
        ? h('div.pfield', {}, lab(def.alt.includes('bw') ? 'Width' : 'Steepness'), box(a), lab('as'),
          seg({ aria: 'Set as', cls: 'enum mini2', value: altCur, options: def.alt.map((x) => ({ v: x, label: WNAME[x] })),
            onChange: (v) => { const val = st[altCur]; delete st[altCur]; st[v] = val ?? (v === 's' ? 1 : 0.707); after(); } }))
        : h('label.pfield', {}, lab(def.t === 'biquad' ? a : a === altCur ? WNAME[a] : cap(ARG_NAME[a] || a)), box(a), ARG_UNIT[a] && h('span.u', { text: ARG_UNIT[a] })));
      const argList = def.t === 'biquad' ? def.args : [def.args[0], altCur, ...def.args.slice(1)].filter(Boolean);
      const argText = def.t === 'biquad' ? 'b0=b0 b1=b1 b2=b2 a0=a0 a1=a1 a2=a2'
        : [`${def.args[0]}=${ARG_NAME[def.args[0]]}`, def.alt.length ? def.alt.map((a) => `${a}=${ARG_NAME[a]}`).join(' OR ') : null, ...def.args.slice(1).map((a) => `${a}=${ARG_NAME[a]}`)].filter(Boolean).join(' ');
      const hint = def.alt.includes('bw') ? 'Width can be given as a Q or as a Bandwidth: a higher Q is narrower, a higher Bandwidth is wider.'
        : def.alt.includes('s') ? 'Steepness can be given as a Q or as a Slope: Slope 1 is the steepest it gets without overshoot.' : null;
      return { type: typeSel, values: argList.map(field), copy: [hint && h('p.phint', { text: hint }), tline(def.t, `${argText}. ${PMAN.iirUnits}`)] };
    }
    function delayEditor(st, after) {
      const cur = DELAY_ARGS.find((x) => st[x.a] !== undefined) || DELAY_ARGS[1];
      const NAME = { s: 'Samples', t: 'Seconds', d: 'Meters' };
      const unit = seg({ aria: 'Delay given in', cls: 'enum mini2', value: cur.a, options: DELAY_ARGS.map((x) => ({ v: x.a, label: NAME[x.a] })),
        onChange: (v) => { const val = st[cur.a]; delete st[cur.a]; if (cur.a !== 'd') delete st.v; st[v] = val ?? 0; after(); } });
      return { unit, values: [
        h('label.pfield', {}, lab('Delay'), numBox(st[cur.a], cur.d, (v) => { st[cur.a] = v; after(); }, 92), h('span.u', { text: cur.unit })),
        cur.a === 'd' && h('label.pfield', {}, lab('Speed of sound'), numBox(st.v ?? 343.956, DELAY_V.d, (v) => { st.v = v; after(); }, 92), h('span.u', { text: 'm/s' })),
      ].filter(Boolean), copy: [cur, cur.a === 'd' && DELAY_V].filter(Boolean).map((x) => tline(x.a, x.d)) };
    }

    // ── Plot ──
    function plot() {
      const p = pipes[selPipe];
      plotHost.parentElement.hidden = !p;
      if (!p) return;
      const partial = (q2) => q2.stages.some((st) => st.kind === 'conv' || st.kind === 'riaa' || st.kind === 'peqfile');
      const xps = inputs().map((s2) => ({ src: s2, members: at(s2, o).map(([q2]) => q2) }));
      const xH = (m, f) => m.reduce((acc, q2) => cplx.add(acc, pipeH(q2, f, fs)), [0, 0]);
      const xp = xps.find((x) => x.src === p.src);
      const genScope = !!p.gen, multi = xp.members.length > 1;
      const sc = scope === 'auto' ? (multi ? 'xp' : 'pipe') : scope === 'pipe' && genScope ? 'xp' : scope === 'xp' && !multi ? 'pipe' : scope;
      const opts = [!genScope && { v: 'pipe', label: `#${selPipe + 1}` }, multi && { v: 'xp', label: `${chShort(p.src)} → ${chShort(o)}` }, { v: 'bus', label: `${chName(o)} Out` }].filter(Boolean);
      scopeHost.replaceChildren(h('span.cl', { text: 'Plot' }), seg({ aria: 'Plot scope', cls: 'mini2 view', value: sc, options: opts, onChange: (v) => { scope = v; plot(); } }));
      const xlabel = (x) => `${chShort(x.src)} → ${chShort(o)}` + (x.members.some(partial) ? ' (partial)' : '');
      const eqOf = genScope ? ear[p.ear] : p;
      const traces = sc === 'bus'
        ? xps.map((x) => ({ cls: x.src === p.src ? '' : 'side', label: xlabel(x), fn: (f) => toDb(cplx.mag(xH(x.members, f))) }))
        : sc === 'xp'
          ? [{ cls: 'ghost', label: genScope ? 'EQ' : `#${selPipe + 1}`, fn: (f) => toDb(cplx.mag(pipeH(eqOf, f, fs))) }, { label: xlabel(xp), fn: (f) => toDb(cplx.mag(xH(xp.members, f))) }]
          : [{ label: `#${selPipe + 1}` + (partial(p) ? ' (partial)' : ''), fn: (f) => toDb(cplx.mag(pipeH(p, f, fs))) }];
      // Bands as dots on the EQ (v1 REW-style), offset by its gain so they ride the curve they shape.
      const gs = groups(p);
      const off = eqOf.unit === 'Lin' ? 20 * Math.log10(Math.abs(+eqOf.gain) || 1e-6) : +eqOf.gain;
      const g1 = (d) => Math.round(Math.max(-20, Math.min(20, d - off)) * 10) / 10;
      const focus = (k) => {
        const gi = gs.findIndex((g) => g.idx.includes(k));
        if (gi >= 0 && (gi !== selChip || gs[gi].idx.indexOf(k) !== selBand)) { selChip = gi; selBand = gs[gi].idx.indexOf(k); paintDock(); editor.replaceChildren(strip(p, selPipe)); }
      };
      const handles = sc !== 'bus' ? eqOf.stages.map((st, k) => ({ st, k })).filter(({ st }) => st.kind === 'iir' && PEQ_TYPES.has(st.type) && !st.blk)
        .map(({ st, k }) => ({ f: +st.f, db: +st.g + off, off: !!mxWhy,
          onDrag: (f, d) => { st.f = f; st.g = g1(d); focus(k); plot(); },
          onEnd: (f, d) => { st.f = f; st.g = g1(d); focus(k); stage(ctx); paint(); } })) : [];
      rp.draw(traces, handles);
    }

    paintOut();
  };

  return {
    overview, output,
    count: () => pipes.length,
    /** The stereo pair's pipelines (In L→Out L, In R→Out R): where a headphone / room correction lands. */
    ears: () => [ear[0], ear[1]],
    /**
     * Land an EQ on the stereo pair from outside (Profile builder): its peak / shelf stages replace the pair's, its preamp
     * becomes the pipeline gain (Import EQ's path); `mirror` false = the first ear only. conv = a convolution file instead.
     */
    importEq: ({ bands, pre, conv }, mirror) => {
      const p = ear[0] || ear[1];
      if (!p) return;
      const target = [p];
      const twin = p === ear[0] ? ear[1] : ear[0];
      if (mirror && twin) target.push(twin);
      for (const t of target) {
        if (conv) t.stages = [...t.stages.filter((st) => st.kind !== 'conv'), { kind: 'conv', file: conv }];
        else {
          const eq = bands.map(([f, g, qq, type = 'peak']) => ({ kind: 'iir', type, f, g, q: qq }));
          t.stages = [...t.stages.filter((st) => !(st.kind === 'iir' && PEQ_TYPES.has(st.type))), ...eq];
          t.gain = pre; t.unit = 'dB';
        }
      }
      if (block.kind !== 'none') rebuild(block, true);
      if (ctx0) stage(ctx0);
      paint();
    },
    /** The pipeline set as it stands (crossfeed block rows included): the Profile builder's response plot. */
    list: () => pipes, rate: fs, outputs: nOut,
    /** Apply (mock): catch up with Crossfeed's values even if this drawer wasn't opened since they changed. */
    sync: (v) => { rebuild(want(v)); paint(); },
  };
}
