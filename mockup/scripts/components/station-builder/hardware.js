// Hardware step (wizard §4): the machine's, not the station's. GPUs and E-cores, the GPU questions, and the settings Save
// writes to every station.

import { h } from '../../lib/dom.js';
import { seg } from '../seg.js';
import { STB_HW, hwSettings } from '../../data/station-builder.js';
import { hardwareView, optionLabel } from '../../model/station.js';
import { num, paras, rich, tip } from './parts.js';

/** The GPU power line: three radio lines, no paragraphs. */
function powerLine(w, setHw) {
  return h('div.stbpow', {}, h('div.fh', {}, h('b', { text: STB_HW.power })),
    h('div.chlist.stbch', { role: 'radiogroup', 'aria-label': STB_HW.power }, STB_HW.powers.map((op) => {
      const on = op.v === w.power;
      const go2 = () => setHw((y) => { y.power = op.v; });
      return h('div.chline', { class: on && 'cur' }, h('div.chl', {},
        h('button.radio', { type: 'button', role: 'radio', aria: { checked: on, label: op.label }, on: { click: go2 } }),
        h('span.chn', { on: { click: go2 } }, h('b', { text: op.label }))));
    })));
}

/** The GPU questions: the wizard's two in the control column, the manual's CUDA paragraph beside them. */
function gpuRow(sb, w, setHw, v) {
  const { HWMAN } = sb.T;
  const two = seg({ aria: 'Nvidia GPUs', options: STB_HW.twoOpts, value: w.gpus, onChange: (g) => setHw((y) => { y.gpus = g; }) });
  const idx = v.twoCards && h('div.cgrp.stbidx', {},
    h('label.ci', {}, h('span.cl', { text: STB_HW.idx.hi }), num(STB_HW.idx.hi, '', w.hi, { min: 0, max: 15, step: 1 }, (n) => setHw((y) => { y.hi = n; }))),
    h('label.ci', {}, h('span.cl', { text: STB_HW.idx.lo }), num(STB_HW.idx.lo, '', w.lo, { min: 0, max: 15, step: 1 }, (n) => setHw((y) => { y.lo = n; }))),
    h('label.stbcb', {}, h('button.binc', { type: 'button', role: 'checkbox', aria: { checked: w.same, label: STB_HW.idx.same }, on: { click: () => setHw((y) => { y.same = !y.same; }) } }),
      h('span', { text: STB_HW.idx.same })));
  const power = v.power && powerLine(w, setHw);
  return h('div.drow.stbq2', {}, h('div.ctl', {}, h('div.fh', {}, h('b', {}, rich(STB_HW.two))), two, idx, power),
    h('div.man', {}, paras(v.twoCards ? [HWMAN.cuda, HWMAN.devs] : HWMAN.cuda)));
}

/** The result row: what Save writes to every station. */
function resultRow(sb, w, v) {
  const res = hwSettings(w);
  const optLabel = (id, x) => optionLabel(sb.T.HW[id].control.options, x);
  const ro = (label, x) => h('div.stbrr', {}, h('span', { text: label }), h('b', { text: x }));
  return h('div.drow.stbres', {}, h('div.ctl', {}, h('div.fh', {}, h('b', { text: STB_HW.result })),
    h('div.stbrrs', {},
      ro('Multicore DSP', optLabel('multicore', res.multicore)),
      ro('E-core allocation', optLabel('ecores', res.ecores)),
      ro('CUDA offload', optLabel('cuda', res.cuda)),
      v.twoCards && ro('CUDA devices', `DSP ${res.cudadev} · Convolution ${res.cudacdev}`)),
    h('p.stbcap', { text: STB_HW.all })),
  h('div.man', {}, tip('HQPTuner Tips:', STB_HW.tip)));
}

/** The Hardware step's rows. */
export function hardwareStep(sb) {
  const w = sb.e.hw;
  const v = hardwareView(w);
  const setHw = (fn) => { fn(w); sb.show('hardware'); };
  const box = (k, label) => h('label.stbcb', {}, h('button.binc', { type: 'button', role: 'checkbox', aria: { checked: !!w[k], label },
    on: { click: () => setHw((y) => { y[k] = !y[k]; }) } }), h('span', { text: label }));
  const rows = [h('div.drow.stbq2', {}, h('div.ctl', {}, h('div.fh', {}, h('b', { text: STB_HW.has })),
    h('div.stbcbs', {}, STB_HW.hasOpts.map((op) => box(op.v, op.label)))), h('div.man', {}, paras(v.ecoresManual ? sb.T.HWMAN.ecores : '')))];
  if (v.gpu) rows.push(gpuRow(sb, w, setHw, v));
  rows.push(resultRow(sb, w, v));
  return rows;
}
