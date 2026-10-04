// Station builder: the header's Station builder button swaps the chain body for this one, as the gear does for Settings.
// Header, engine row and bottom bar stay. It is the setup wizard's station walk (repo docs/wizard/wizard.md §1–§1.6 and
// §4), one station at a time, in the Profile builder's grammar: it edits a copy (nothing reaches the engine until Save;
// saving the loaded station restarts the engine), × on its title, Back / Next, nothing forces the order.
//   Rail   Overview, then Name, Backend, Device, IPv6, USB listings, Connection, Rates, DAC bits · Gain, Volume, Hardware,
//          each with its answer (`Skipped` where it doesn't apply). The page showing is lit (amber name + left-hand bar).
//   Overview  the wizard's intro beside the signal chain with the station's part lit (Volume, Output); what the station
//          holds (one line per part, › jumps to its step) and its Matrix profiles (› the Profile builder); which station
//          (picker · Name) and the ways on: Save, Change something (the walk from here), Start from scratch.
//   Steps  the wizard's question as the guide line, its answers as choice lines beside the manual's paragraph; checks
//          the wizard runs against the engine (IPv6, USB listings, the 48k-family DSD check) run here as mock sequences
//          that print the wizard's lines as they go. The NAA bring-up opens inside the Device step: on demand, and on its
//          own whenever an NAA backend lists nothing.
// Hardware is the machine's, not the station's: its answers are written to every station on Save (wizard §4).
// Edits stay staged per station until Save or Discard, through switching and leaving.
// Exit: ×, Escape with nothing open, the gear (Settings), or another builder's button.
// Mock outcomes: `#naa-none` (no NAA until Refresh devices), `#ipv6-fail`, `#usb-fail-gone` / `#usb-fail-none`,
// `#dsd48-no` (the check finds no 48k-family DSD).
// The shell (switching, staging, Save / Delete, the rail, the overview's frame, the swap) is lib/builder.js: one record
// book holding every station under one key, with the station list's order kept beside it.

import { h } from '../lib/dom.js';
import { PLATFORM } from '../lib/clock.js';
import { checkSequence } from '../model/timing.js';
import { closeOthers } from './drawer.js';
import { seg, select } from './seg.js';
import { mountRateDial } from './rate-dial.js';
import { mountBuilder, paras as parasOf, drow as row, chainPic, holdRow } from '../lib/builder.js';
import { NEW, OVERVIEW, homeOf, namesAfterSave } from '../model/builder.js';
import { OUTPUT_DRAWER, DEVICES, RATE_TIERS } from '../data/output.js';
import { VOLUME_DRAWER } from '../data/volume.js';
import { HARDWARE_DRAWER } from '../data/settings.js';
import {
  STB_COPY, STB_STEPS, STB_TIPS, STB_BACKENDS, STB_DEVICE, STB_IPV6, STB_USB, STB_IFACES, STB_RATES, STB_DAC, STB_VOLUME,
  STB_HW, STB_SCRATCH, STB_RECORDS, STB_HW_REC, hwSettings,
} from '../data/station-builder.js';
import { classNames, minus } from '../model/format.js';
import { deviceParts as parts, groupDevices } from '../model/output.js';

const ONE = '';   // the book's one station key: a station builder's records are the stations themselves
const TIERS = RATE_TIERS.tiers;
const TICK = 700;   // mock: one line of a check

// Manual copy, read from the drawers that own it (one home per setting; the builder borrows the paragraph).
const rowsOf = (drawer) => drawer.tabs.flatMap((t) => t.body.flatMap((it) => (it.row ? [it.row] : it.rows ?? [])));
const outRow = (label, group) => {
  for (const t of OUTPUT_DRAWER.tabs) for (const it of t.body) {
    if (it.row?.label === label && !group) return it.row;
    if (group && it.group === group) { const r = it.rows.find((x) => x.label === label); if (r) return r; }
  }
  return null;
};
const MAN = {
  netDevice: outRow('Output device', 'network').man, alsaDevice: outRow('Output device', 'alsa').man,
  discovery: outRow('Discovery', 'network').man, rate: outRow('Rate').man[0].text,
  dsd: outRow('DSD support', 'network').man, dsd48: outRow('DSD rates', 'network').man, bits: outRow('DAC bits', 'network').man,
};
const FIXED = VOLUME_DRAWER.tabs[0].body[0].row.control.options;   // Off / Manual / Auto lines: their manual copy
const VMAN = { off: FIXED.find((x) => x.v === 'off').man, iso: FIXED.find((x) => x.v === 'auto').man,
  gain: rowsOf(VOLUME_DRAWER).find((r) => r.label === 'PCM gain compensation').man };
const HW = Object.fromEntries(rowsOf(HARDWARE_DRAWER).map((r) => [r.control.id ?? r.label, r]));
const HWMAN = { cuda: HW.cuda.man, devs: HW['CUDA devices'].man, ecores: HW.ecores.man, multicore: HW.multicore.man };
const optLabel = (id, v) => HW[id].control.options.find((x) => x.v === v)?.label ?? v;
const DSD_OPTS = outRow('DSD support', 'network').control.options;
const DSD48_OPTS = outRow('DSD rates', 'network').control.options;
const DISCOVERY = outRow('Discovery', 'network').control.options;

/** Rich inline copy: strings, {a, href}, {code}, *emphasis* (the wizard's markdown). */
const rich = (bits) => (Array.isArray(bits) ? bits : [bits]).flatMap((b) => (typeof b === 'string'
  ? b.split(/(\*[^*]+\*|`[^`]+`)/).filter(Boolean).map((t) => (t.startsWith('*') ? h('em', { text: t.slice(1, -1) }) : t.startsWith('`') ? h('code', { text: t.slice(1, -1) }) : t))
  : b.a ? h('a', { href: b.href, target: '_blank', rel: 'noreferrer', text: b.a }) : h('code', { text: b.code })));
const paras = (m) => parasOf(m, rich);
const tip = (label, text) => h('p.stbtip', {}, h('b', { text: label }), ' ', rich(text));

/**
 * @param {object} el  {btn: header button, chain: #body, body: #stbody, rail, page, others: {settings, snapshot(), profiles()},
 *                     bus: lib/bus.js}
 * @param {{name: string, active?: boolean}[]} stations  in the tree's order
 * @param {object} o  {profilesOf(station) → names, onRescan(), onSaved({names, loaded, renamed, restart}), openProfiles(station),
 *                    flags: model/flags.js (the mock checks' outcomes)}
 * @param {import('../lib/clock.js').Clock} [clock]
 */
export function mountStationBuilder({ btn, chain, body, rail, page, others, bus }, stations, o, clock = PLATFORM) {
  const { flags } = o;
  let order = stations.map((st) => st.name);
  let loaded = homeOf(stations);
  const records = Object.fromEntries(order.map((n) => [n, structuredClone(STB_RECORDS[n] ?? STB_SCRATCH)]));
  let hw = structuredClone(STB_HW_REC);   // the machine's: one record, written to every station
  let naaSeen = !flags.naaNone;   // mock: an NAA shows only after Refresh devices
  const hidden = new Set();   // listings a resolved pair left dead: hidden from every list (wizard §1.5)
  for (const r of Object.values(records)) for (const l of r.listings) if (r.resolved && l !== r.resolved) hidden.add(l);

  // ── Edit state ──────────────────────────────────────────────────────────
  let e;                      // the one being edited: {name, rec, hw}
  let runs = {};              // mock checks in flight or done, this edit: {ipv6, usb, rates}
  let bringUp = false, pitch = false;
  const B = mountBuilder({ btn, chain, body, bus }, {
    title: 'Station builder', closeLabel: 'Close Station builder', noun: 'Station',
    stations: [ONE], book: { [ONE]: records }, cur: { st: ONE, name: loaded },
    copy: { remove: (n) => STB_COPY.remove(n), overwrite: (n) => STB_COPY.overwrite(n), noName: STB_COPY.noName,
      state: { restarts: STB_COPY.state.dirtyLoaded, dirty: STB_COPY.state.dirty, live: STB_COPY.state.loaded, saved: STB_COPY.state.saved } },
    name: () => e.name,
    to: () => [ONE],
    record: () => structuredClone(e.rec),
    dirty: () => dirty(),
    load: (c, buf) => { e = structuredClone(buf ?? saved(c)); runs = {}; bringUp = false; pitch = false; },
    buffer: () => structuredClone(e),
    restarts: () => B.cur.name === loaded || hwDirty(),
    live: () => B.cur.name === loaded,
    view: (where) => show(where === 'here' ? at : OVERVIEW),
    refuse: () => { show('overview'); nameBox.focus(); },
    saved: ({ from, name }) => {
      const restart = from.name === loaded || hwDirty();
      let renamed = null;
      if (from.name !== NEW && name !== from.name) {   // renamed in place: keeps its place in the list
        renamed = { from: from.name, to: name };
        if (loaded === from.name) loaded = name;
      }
      order = namesAfterSave(order, from.name, name);
      if (e.rec.resolved) for (const l of e.rec.listings) if (l !== e.rec.resolved) hidden.add(l);
      hw = structuredClone(e.hw);                  // the machine's: written to every station
      B.load(B.cur);
      show('overview');
      o.onSaved?.({ names: [...order], loaded, renamed, restart });
    },
    land: () => ({ st: ONE, name: loaded }),   // the loaded station stays (it can't be deleted)
    removed: (from) => {
      order = order.filter((n) => n !== from.name);
      o.onSaved?.({ names: [...order], loaded, renamed: null, restart: false });
      B.load(B.cur); show('overview');
    },
    leave: () => { others.settings.setOn(false); others.snapshot()?.setOn(false, false); others.profiles()?.setOn(false, false); },
    opened: () => show(at),
    toggles: true,
    walk: { rail, steps: STB_STEPS, copy: STB_COPY, skipOf: (id) => skipOf(id), answer: (id) => ans(id), at: () => at, show: (id) => show(id),
      newLabel: STB_COPY.newStation,
      scratch: () => { e.rec = structuredClone(STB_SCRATCH); runs = {}; show(STB_STEPS[0].id); },
      nameBox: { type: 'text', 'aria-label': 'Station name', maxlength: 40, spellcheck: 'false', placeholder: STB_COPY.name },
      setName: (n) => { e.name = n; } },
  });
  const { pick, nameBox } = B;
  const saved = (c) => (c.name === NEW ? { name: '', rec: structuredClone(STB_SCRATCH), hw: structuredClone(hw) }
    : { name: c.name, rec: structuredClone(B.book[ONE][c.name]), hw: structuredClone(hw) });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const hwDirty = () => !same(e.hw, hw);
  const dirty = () => { const s0 = saved(B.cur); return e.name !== s0.name || !same(e.rec, s0.rec) || hwDirty(); };
  const isDirty = (n) => B.isDirty({ st: ONE, name: n });
  /** Change the edited record and repaint what follows from it. */
  const set = (fn) => { fn(e.rec, e); show(at); };

  // ── Answers (rail, overview) ────────────────────────────────────────────
  const r = () => e.rec;
  const kind = () => r().backend;
  const ctx = () => ({ backend: kind(), listings: r().listings.length, iface: r().iface, gpu: e.hw.gpu });
  const skipOf = (id) => STB_STEPS.find((x) => x.id === id)?.skip?.(ctx()) || '';
  const dev = () => r().resolved ?? (r().listings.length === 1 ? r().listings[0] : null);
  const IFACE_SHORT = { usb: 'USB / I2S', coax: 'AES/EBU · coax', toslink: 'Toslink' };   // DRAFT rail readouts
  const answer = {
    name: () => e.name || '—',
    backend: () => ({ network: 'NAA', alsa: 'ALSA' }[kind()]),
    device: () => (dev() ? parts(kind(), dev()).main : r().listings.length ? `${r().listings.length} listings` : '—'),
    ipv6: () => (r().ipv6 ? DISCOVERY.find((x) => x.v === r().v6).label : '—'),
    usb: () => (r().resolved ? 'Resolved' : 'Unresolved'),
    iface: () => IFACE_SHORT[r().iface] ?? '—',
    rates: () => (r().iface ? `${TIERS[r().limits.pcm].name} · ${r().limits.sdm == null ? 'no DSD' : 'DSD' + TIERS[r().limits.sdm].name.slice(0, -1)}` : '—'),
    dac: () => `${Number(r().bits) ? r().bits + ' bit' : 'Auto'} · ${minus(Number(r().gaincomp))} dB`,
    volume: () => (r().volume === 'hqp' ? 'HQPlayer' : r().volume === 'other' ? `Fixed · ${r().iso === '2' ? '−6' : '−3'} dB` : '—'),
    hardware: () => { const x = hwSettings(e.hw); return [{ 0: 'No CUDA', convolution: 'CUDA conv.', 1: 'CUDA full' }[x.cuda], x.ecores === 'pool' && 'E-cores'].filter(Boolean).join(' · '); },
  };
  const ans = (id) => (skipOf(id) ? STB_COPY.skipped : answer[id]());

  // ── Shared parts ────────────────────────────────────────────────────────
  const drow = (label, ctl, man, cls) => row(label, ctl, man, { cls, inline: rich });
  /** Choice lines (the drawers' grammar): radio + the answer's words + its own paragraph. */
  function choice(label, options, value, pick, { fold = false } = {}) {
    return h('div.drow.drow-full.pbchoice.stbch', {}, label && h('div.ctl', {}, h('div.fh', {}, h('b', { text: label }))),
      h('div.chlist', { role: 'radiogroup', 'aria-label': label || 'Answer' }, options.map((op) => {
        const on = op.v === value;
        const go2 = () => pick(op.v);
        return h('div.chline', { class: classNames(on && 'cur', fold && value && !on && 'fold'), data: { v: op.v } },
          h('div.chl', {}, h('button.radio', { type: 'button', role: 'radio', aria: { checked: on, label: op.label }, on: { click: go2 } }),
            h('span.chn', { on: { click: go2 } }, h('b', { text: op.label }))),
          h('div.man', {}, paras(op.man)));
      })));
  }
  const numBox = (label, unit, value, attrs, onSet, hint) => {
    const input = h('input.vfd', { type: 'number', 'aria-label': label, value, ...attrs });
    input.value = value;
    input.addEventListener('change', () => { const n = Number(input.value); if (Number.isFinite(n)) onSet(n); });
    return h('div.num', {}, input, unit && h('span.u', { text: unit }), hint && h('span.h', { text: hint }));
  };
  /** A check's printed lines (the wizard's `...` lines, then its verdict). */
  const lines = (run) => run && h('div.stbrun', { role: 'status' }, run.lines.map((t, i) => h('p', { class: i === run.lines.length - 1 && run.done ? (run.ok ? 'ok' : 'no') : 'go', text: t })));
  /** Run a mock check: print each line a tick apart, then the verdict; repaint while its step shows. */
  function check(key, steps, verdict, restarts = true) {
    const run = { lines: [], done: false, ok: false };
    runs[key] = run;
    const mine = e;
    if (restarts) o.onRescan?.();   // the IPv6 test restarts the daemon, a rescan stops it (wizard): the knob reads Applying…
    checkSequence(steps, TICK, (t) => { if (e !== mine) return; run.lines.push(t); if (at === key) show(at); }, () => {
      if (e !== mine) return;
      const [ok, line, apply] = verdict();
      run.lines.push(line); run.done = true; run.ok = ok;
      apply?.();
      show(at);
    }, clock);
    show(at);
  }

  // ── Overview ────────────────────────────────────────────────────────────
  const chainEl = chainPic('Signal chain: the station\'s part lit', (id) => ['volume', 'output'].includes(id));
  pick.addEventListener('change', () => B.go({ st: ONE, name: pick.value }));
  const acts = B.buttons();
  const HOLDS = ['backend', 'device', 'ipv6', 'iface', 'rates', 'dac', 'volume', 'hardware'];
  function overview() {
    const cur = B.cur.name;
    const holds = HOLDS.map((id) => {
      const x = holdRow(STB_STEPS.find((y) => y.id === id).title, () => show(id));
      x.a.textContent = ans(id);
      return x.el;
    });
    const nProf = cur === NEW ? 0 : o.profilesOf(cur).length;
    const prof = holdRow(STB_COPY.profiles, () => { B.stash(); B.setOn(false, false); o.openProfiles(B.cur.name); }, 'button.pbhold.pbpl');
    prof.a.textContent = cur === NEW ? '—' : String(nProf);
    prof.el.disabled = cur === NEW;
    return B.overview({ tags: { ov: 'div.pbov.stbov', save: 'div.pbsavebox.stbsave', id: 'div.pbid.stbid' },
      intro: h('div.pbintro', {}, paras(STB_COPY.intro)), holds: [holds, prof.el], chain: chainEl,
      ask: B.ask && h('div.pbask', {}, B.askLine()), acts });
  }
  function paintPick() {
    pick.replaceChildren(...order.map((n) => h('option', { value: n, text: `${n}${n === loaded ? ' (loaded)' : ''}${isDirty(n) ? ' •' : ''}` })),
      h('option', { value: NEW, text: STB_COPY.newStation + (isDirty(NEW) ? ' •' : '') }));
    const cur = B.cur.name;
    pick.value = cur;
    nameBox.value = e.name;
    acts.del.hidden = cur === NEW || cur === loaded;   // the loaded station stays (load another first)
  }

  // ── Steps ───────────────────────────────────────────────────────────────
  /** A step's page (the shell's frame): the wizard's guide line, then its rows. */
  const stepPage = (id) => B.stepPage(id, { tag: 'div.pbstepp.stbstep', attrs: { data: { step: id } },
    guide: (skip, st) => guideOf(id, skip, st), rows: (x) => STEP[x]() });

  /** The guide line; a step whose guide is null (Rates over USB) prints its check there instead: the wizard's order. */
  function guideOf(id, skip, st) {
    const g = skip || st.guide(ctx());
    if (g == null) return runs[id] ? h('div.stbguiderun', {}, lines(runs[id])) : h('p.pbguide', { text: '\u00a0' });
    return h('p.pbguide', { class: skip && 'skip' }, rich(g));
  }

  const STEP = {
    name() {
      const box = h('input.vfd.stbnm', { type: 'text', 'aria-label': 'Station name', value: e.name, maxlength: 40, spellcheck: 'false', placeholder: STB_COPY.name });
      box.value = e.name;
      box.addEventListener('input', () => { e.name = box.value.trim(); B.refused = false; B.paintRail(); });
      const [a, link, b] = STB_TIPS.power;
      return [drow('Name', box, ''),
        h('div.stbnotes', {}, tip('HQPTuner Tips:', STB_TIPS.name),
          h('p', {}, a, h('button.xref.stblink', { type: 'button', text: link, on: { click: () => { set((x) => { x.backend = 'network'; }); bringUp = true; show('device'); } } }), b))];
    },

    backend: () => [
      choice('', STB_BACKENDS, kind(), (v) => set((x) => { if (x.backend !== v) Object.assign(x, { backend: v, listings: [], resolved: null }); })),
      h('div.stbnotes', {}, h('p', {}, rich(STB_COPY.combo))),
    ],

    device() {
      const net = kind() === 'network';
      const all = (net ? DEVICES.network.list : DEVICES.alsa.list).filter((l) => !hidden.has(l) || r().listings.includes(l));
      const list = net && !naaSeen ? [] : all;
      const refresh = h('div.stbact', {},
        h('button.btn.sm', { type: 'button', text: STB_DEVICE.refresh, on: { click: () => { naaSeen = true; o.onRescan?.(); show('device'); } } }),
        h('span.stbcost', { text: STB_DEVICE.refreshCost }));
      if (net && (bringUp || !list.length)) return bringUpView(list.length, refresh);
      const well = h('div.stbdevs', { role: 'group', 'aria-label': 'Output devices' }, groupDevices(kind(), list).flatMap(({ group, rows }) => [
        h('div.gh', {}, h('span', { text: group }), h('span.ln')),
        ...rows.map((p) => {
          const { str } = p;
          const on = r().listings.includes(str);
          const dead = r().resolved && on && r().resolved !== str;
          return h('div.stbdev', { class: classNames(on && 'on', dead && 'dead') },
            h('button.binc', { type: 'button', role: 'checkbox', aria: { checked: on, label: p.main }, on: { click: () => toggle(str) } }),
            h('button.stbdn', { type: 'button', on: { click: () => toggle(str) } }, h('span.m', { text: p.main }), p.detail && h('span.d', { text: p.detail })),
            r().resolved === str && h('span.tag.stblock', { text: STB_USB.locked }));
        }),
      ]));
      return [
        h('div.drow.drow-full.stbdrow', {}, well, refresh),
        h('div.stbnotes', {}, h('p', { text: STB_DEVICE.same }), h('p', { text: STB_DEVICE.both }),
          h('p.stbman', { text: net ? MAN.netDevice : MAN.alsaDevice }),
          net && h('p', {}, h('button.xref.stblink', { type: 'button', on: { click: () => { bringUp = true; show('device'); } } }, STB_DEVICE.bringUpLink, ' ›'))),
      ];
    },

    ipv6() {
      const x = r();
      const run = runs.ipv6;
      const answerRows = [choice('', STB_IPV6.answers, x.ipv6, (v) => {
        delete runs.ipv6;
        set((y) => { y.ipv6 = v; if (v === 'no') y.v6 = 'v4'; });
        if (v === 'yes') testV6(false);
      }, { fold: true })];
      if (x.ipv6 === 'yes') answerRows.push(lines(run));
      if (x.ipv6 === 'unknown') {
        answerRows.push(h('div.stbnotes', {}, h('p', { text: STB_IPV6.unknown.lead }), !run && h('p', { text: STB_IPV6.unknown.ask })));
        if (!run) answerRows.push(h('div.stbact', {},
          h('button.btn.sm', { type: 'button', text: STB_IPV6.unknown.start, on: { click: () => testV6(true) } }),
          h('button.btn.sm', { type: 'button', text: STB_IPV6.unknown.skip, on: { click: () => { set((y) => { y.v6 = 'v4'; }); show(B.nextOf(STB_STEPS.findIndex((s2) => s2.id === 'ipv6'))); } } })));
        else answerRows.push(lines(run));
      }
      const disc = seg({ aria: 'Discovery', options: DISCOVERY, value: x.v6, onChange: (v) => set((y) => { y.v6 = v; }) });
      return [...answerRows, drow('Discovery', disc, MAN.discovery, 'stbset')];
    },

    usb() {
      const x = r();
      const run = runs.usb;
      const pair = h('div.stbdevs.stbpair', {}, x.listings.map((str) => {
        const p = parts(kind(), str);
        const dead = x.resolved && x.resolved !== str;
        return h('div.stbdev', { class: classNames(x.resolved === str && 'on', dead && 'dead') },
          h('span.stbdn', {}, h('span.m', { text: p.main }), h('span.d', { text: p.group + (p.detail ? ' · ' + p.detail : '') })),
          x.resolved === str && h('span.tag.stblock', { text: STB_USB.locked }));
      }));
      return [
        h('div.drow.drow-full.stbdrow', {}, pair),
        h('div.stbnotes', {}, h('p', { text: STB_USB.how })),
        h('div.stbact', {}, h('button.btn.sm', { type: 'button', text: STB_USB.go, on: { click: disambiguate } })),
        lines(run),
      ];
    },

    iface: () => [choice('', STB_IFACES, r().iface, (v) => set((x) => {
      x.iface = v;
      const f = STB_IFACES.find((q) => q.v === v).fixed;
      if (f) Object.assign(x, { limits: { pcm: f.pcm, sdm: f.sdm }, dsd: f.dsd, dsd48: f.dsd48, detected: false });
      else x.detected = false;
      delete runs.rates;
    }))],

    rates() {
      const x = r();
      if (!x.iface) return [h('div.stbnotes', {}, h('p', { text: 'Answer Connection first.' }))];   // DRAFT
      const usb = x.iface === 'usb';
      if (usb && !x.detected && !runs.rates) { clock.queueMicrotask(detect48); return []; }
      if (usb && runs.rates && !runs.rates.done) return [];
      const noDsd = x.limits.sdm == null;
      const cap = STB_IFACES.find((q) => q.v === x.iface).fixed;
      const tiers = TIERS.map((t, i) => ({ ...t, unavailable: t.unavailable || (cap && (t.family === 'pcm' ? i > cap.pcm : noDsd || i > cap.sdm)) }));
      const dialEl = h('div.dial', { role: 'group', 'aria-label': 'Rate limits' });
      const sdmLo = TIERS.findIndex((t) => t.family === 'sdm');
      const rd = mountRateDial(dialEl, { tiers, limits: { pcm: x.limits.pcm, sdm: noDsd ? sdmLo : x.limits.sdm }, playing: 0 }, () => {
        const [p, q] = rd.value().split('|').map(Number);
        set((y) => { y.limits = { pcm: p, sdm: noDsd ? null : q }; });
      });
      dialEl._setPlaying(null);   // nothing plays in a builder
      const t = (i) => TIERS[i];
      const sum = h('div.stbsum', {},
        h('p.stbhere', { text: STB_RATES.here }),
        h('div.stbread', {},
          h('div.vfd.stbro', {}, h('span.l', { text: 'PCM' }), h('span.v', { text: `${t(x.limits.pcm).name} · ${t(x.limits.pcm).f44} / ${t(x.limits.pcm).f48} ${t(x.limits.pcm).unit}` })),
          h('div.vfd.stbro', {}, h('span.l', { text: 'SDM' }), h('span.v', { text: noDsd ? STB_RATES.sdmNone : `DSD${t(x.limits.sdm).name.slice(0, -1)} · ${x.dsd === 'dop' ? 'via DoP' : 'Native'}` })),
          h('div.vfd.stbro', {}, h('span.l', { text: '48kHz DSD' }), h('span.v', { text: !noDsd && x.dsd48 === '48k' ? 'Yes' : 'No' }))),
        usb && h('p.stbconf', { text: STB_RATES.confirm }));
      const dsdSeg = seg({ aria: 'DSD support', options: DSD_OPTS, value: x.dsd, onChange: (v) => set((y) => { y.dsd = v; }) });
      const d48Seg = seg({ aria: 'DSD rates', options: DSD48_OPTS, value: x.dsd48, onChange: (v) => set((y) => { y.dsd48 = v; }) });
      const gray = noDsd ? STB_RATES.sdmNoneWhy : '';
      const g = (ctl) => h('div.stbg', { class: gray && 'grayed' }, ctl);
      return [sum,
        h('div.drow.drow-full', {}, h('div.ctl', {}, h('div.fh', {}, h('b', { text: 'Rate limits' }))), dialEl, h('div.man', {}, paras(MAN.rate))),
        drow('DSD support', [g(dsdSeg), gray && h('p.gr', { text: gray })], MAN.dsd, 'stbset'),
        drow('DSD rates', g(d48Seg), MAN.dsd48, 'stbset')];
    },

    dac() {
      const x = r();
      const native = x.limits.sdm != null && x.dsd === 'native';
      const known = h('div.stbknown', {}, h('p', { text: STB_DAC.known }), STB_DAC.values.map((k) => h('button.stbkv', { type: 'button', class: Number(x.bits) === k.v && 'on',
        on: { click: () => set((y) => { y.bits = k.v; }) } }, h('span', { text: k.k }), h('b', { text: String(k.v) }))));
      const bits = numBox('DAC bits', '', x.bits, { min: 0, max: 32, step: 1 }, (n) => set((y) => { y.bits = n; }), '0 = default');
      const gain = numBox('PCM gain compensation', 'dB', x.gaincomp, { min: -6, max: 0, step: 0.5 }, (n) => set((y) => { y.gaincomp = n; }));
      return [
        drow('DAC bits', [bits, known], MAN.bits, 'stbset'),
        h('div.stbnotes', {}, h('p', { text: STB_DAC.gain })),
        drow('PCM gain compensation', [h('div.stbg', { class: !native && 'grayed' }, gain), !native && h('p.gr', { text: STB_DAC.gainSkip })], VMAN.gain, 'stbset'),
      ];
    },

    volume() {
      const x = r();
      const use = STB_VOLUME.use.map((u) => ({ ...u, man: u.v === 'hqp' ? [VMAN.off, u.sets] : VMAN.iso }));
      // The pitch open: the question's warning and the picked answer's paragraph give it their room.
      const ch = choice('', use, x.volume, (v) => set((y) => { y.volume = v; }), { fold: x.volume === 'other' });
      if (pitch) ch.classList.add('brief');
      const out = [!pitch && h('div.stbnotes', {}, h('p', { text: STB_VOLUME.warn })), ch].filter(Boolean);
      if (x.volume === 'other') {
        out.push(h('p.stbq', { text: STB_VOLUME.clip }),
          choice('', STB_VOLUME.clips, x.iso, (v) => set((y) => { y.iso = v; })));
        out.push(h('div.stbnotes.stbhints', {},
          tip('HQPTuner Hint 1:', STB_VOLUME.hint1),
          h('p', {}, h('b', { text: 'HQPTuner Hint 2:' }), ' ', STB_VOLUME.hint2, ' ',
            h('button.xref.stblink', { type: 'button', text: pitch ? STB_VOLUME.less : STB_VOLUME.more, on: { click: () => { pitch = !pitch; show('volume'); } } })),
          pitch && h('div.stbpitch', {}, h('p', {}, rich(STB_VOLUME.pitch[0])),
            h('ol', {}, STB_VOLUME.pitch.slice(1).map((pp) => h('li', {}, h('b', { text: pp.k }), ': ', rich(pp.text)))))));
      }
      return out;
    },

    hardware() {
      const w = e.hw;
      const setHw = (fn) => { fn(w); show('hardware'); };
      const box = (k, label) => h('label.stbcb', {}, h('button.binc', { type: 'button', role: 'checkbox', aria: { checked: !!w[k], label },
        on: { click: () => setHw((y) => { y[k] = !y[k]; }) } }), h('span', { text: label }));
      const res = hwSettings(w);
      const rows = [h('div.drow.stbq2', {}, h('div.ctl', {}, h('div.fh', {}, h('b', { text: STB_HW.has })),
        h('div.stbcbs', {}, STB_HW.hasOpts.map((op) => box(op.v, op.label)))), h('div.man', {}, paras(w.ecores ? HWMAN.ecores : '')))];
      if (w.gpu) {
        // The GPU questions: the wizard's two in the control column, the manual's CUDA paragraph beside them.
        const two = seg({ aria: 'Nvidia GPUs', options: STB_HW.twoOpts, value: w.gpus, onChange: (v) => setHw((y) => { y.gpus = v; }) });
        const idx = w.gpus === '2' && h('div.cgrp.stbidx', {},
          h('label.ci', {}, h('span.cl', { text: STB_HW.idx.hi }), numBox(STB_HW.idx.hi, '', w.hi, { min: 0, max: 15, step: 1 }, (n) => setHw((y) => { y.hi = n; }))),
          h('label.ci', {}, h('span.cl', { text: STB_HW.idx.lo }), numBox(STB_HW.idx.lo, '', w.lo, { min: 0, max: 15, step: 1 }, (n) => setHw((y) => { y.lo = n; }))),
          h('label.stbcb', {}, h('button.binc', { type: 'button', role: 'checkbox', aria: { checked: w.same, label: STB_HW.idx.same }, on: { click: () => setHw((y) => { y.same = !y.same; }) } }),
            h('span', { text: STB_HW.idx.same })));
        const power = w.gpus !== '2' && h('div.stbpow', {}, h('div.fh', {}, h('b', { text: STB_HW.power })),
          h('div.chlist.stbch', { role: 'radiogroup', 'aria-label': STB_HW.power }, STB_HW.powers.map((op) => {
            const on = op.v === w.power;
            const go2 = () => setHw((y) => { y.power = op.v; });
            return h('div.chline', { class: on && 'cur' }, h('div.chl', {},
              h('button.radio', { type: 'button', role: 'radio', aria: { checked: on, label: op.label }, on: { click: go2 } }),
              h('span.chn', { on: { click: go2 } }, h('b', { text: op.label }))));
          })));
        rows.push(h('div.drow.stbq2', {}, h('div.ctl', {}, h('div.fh', {}, h('b', {}, rich(STB_HW.two))), two, idx, power),
          h('div.man', {}, paras(w.gpus === '2' ? [HWMAN.cuda, HWMAN.devs] : HWMAN.cuda))));
      }
      const ro = (label, v) => h('div.stbrr', {}, h('span', { text: label }), h('b', { text: v }));
      rows.push(h('div.drow.stbres', {}, h('div.ctl', {}, h('div.fh', {}, h('b', { text: STB_HW.result })),
        h('div.stbrrs', {},
          ro('Multicore DSP', optLabel('multicore', res.multicore)),
          ro('E-core allocation', optLabel('ecores', res.ecores)),
          ro('CUDA offload', optLabel('cuda', res.cuda)),
          w.gpu && w.gpus === '2' && ro('CUDA devices', `DSP ${res.cudadev} · Convolution ${res.cudacdev}`)),
        h('p.stbcap', { text: STB_HW.all })),
        h('div.man', {}, tip('HQPTuner Tips:', STB_HW.tip))));
      return rows;
    },
  };

  function toggle(str) {
    set((x) => {
      x.listings = x.listings.includes(str) ? x.listings.filter((l) => l !== str) : [...x.listings, str];
      x.resolved = null;
    });
    delete runs.usb;
  }
  function bringUpView(found, refresh) {
    const B = STB_DEVICE.bringUp;
    return [h('div.stbbring', {},
      !found && h('p.stbnone', { text: STB_DEVICE.none }),
      h('p', { text: B.intro }),
      h('ol', {}, B.flavors.map((f) => h('li', {}, h('b', { text: f.k }), ': ', rich(f.text)))),
      tip('HQPTuner Tips:', B.tip),
      h('p', { text: B.ready }),
      h('div.stbcrit', { role: 'note' }, h('b', { text: B.critical }), h('p', {}, rich(B.firewall)),
        B.cmds.map((c) => h('p.stbcmd', {}, h('span', { text: c.k }), h('code', { text: c.cmd }))), h('p', {}, rich(B.fallback)))),
    h('div.stbact', {}, refresh.children[0], refresh.children[1], h('span.grow'),
      found > 0 && h('button.btn.sm', { type: 'button', text: B.back, on: { click: () => { bringUp = false; show('device'); } } }))];
  }
  function testV6(ask2) {
    const fail = flags.ipv6Fail;
    const steps = ask2 ? STB_IPV6.unknown.steps : [STB_IPV6.yes.run];
    check('ipv6', steps, () => [!fail,
      ask2 ? (fail ? STB_IPV6.unknown.fail : STB_IPV6.unknown.ok) : (fail ? STB_IPV6.yes.fail : STB_IPV6.yes.ok),
      () => { e.rec.v6 = fail ? 'v4' : 'v6'; }]);
  }
  function disambiguate() {
    const why = flags.usbFail;
    const x = e.rec;
    check('usb', [STB_USB.run], () => {
      if (why) return [false, STB_USB.fail(STB_USB.why[why]), () => { x.resolved = null; }];
      const all = DEVICES[x.backend].list;
      const survivor = [...x.listings].sort((a, b) => all.indexOf(a) - all.indexOf(b)).at(-1);   // mock: the later listing answers
      return [true, `${STB_USB.ok}`, () => { x.resolved = survivor; }];
    });
  }
  function detect48() {
    const no = flags.dsd48No;
    // Mock: the device announces the Output drawer's limits (data/output.js RATE_TIERS) and native DSD.
    check('rates', [STB_RATES.check], () => [true, STB_RATES.ok, () => {
      Object.assign(e.rec, { detected: true, dsd48: no ? '44k' : '48k', dsd: 'native', limits: { ...RATE_TIERS.limits } });
    }], false);
  }

  // ── Show ────────────────────────────────────────────────────────────────
  let at = 'overview';
  function show(id) {
    if (!B.inWalk(id)) id = 'overview';
    closeOthers(null);
    if (id !== 'device' && at === 'device') bringUp = false;
    if (id !== 'volume') pitch = false;
    at = id;
    if (id === 'overview') { page.replaceChildren(overview()); paintPick(); } else page.replaceChildren(stepPage(id));
    B.paintRail();
    B.paintState();
  }

  B.load(B.cur);
  show('overview');
  return B.start();
}

