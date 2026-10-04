// Page picker for a chain field (Resampling 1x / Nx filter, Shaping modulator or dither): the list lives in its sheet or
// panel now, so the page's field reads what runs.
//   Nameplate  the field's glass: family › variant (ink, reading size: names repeat across families), the option's name (the value: accent; the engine name
//              under Option style Standard, as the lists). No marks. Tap = the whole list (sheet / panel), as before.
// Idle (not in this track's path): the glass dims.

import { h } from '../lib/dom.js';
import { LISTS } from '../data/option-lists.js';
import { openPicker, optionStyle } from './vselect.js';

/**
 * @param {object} o
 * @param {string} o.id        page id (`pg-sdm1x`): which chain, stage and field
 * @param {string} o.list      LISTS key: pcmFilters | sdmFilters | modulators | dithers
 * @param {'1x'|'nx'} o.stage  narrowing stage
 * @param {string} o.value     engine name running in this field
 * @param {string} o.aria
 * @param {boolean} [o.idle]
 * @param {(v: string) => void} o.onChange
 */
export function chainPick({ id, list, stage, value, aria, idle, onChange }) {
  const all = LISTS[list];
  const opt = all.find((x) => String(x.v) === String(value)) ?? { v: value, leaf: value, fam: '' };
  const m = String(id).match(/(pcm|sdm)(1x|nx|sh)$/);

  const plate = h('button.vfd.cplate', { type: 'button', id, class: idle && 'dim', 'aria-label': `${aria}: ${opt.leaf}`, aria: { haspopup: 'dialog' } });
  plate.value = String(value);   // the Snapshot builder and switcher read pickers by value
  plate.addEventListener('click', () => openPicker({
    trigger: plate, list, stage, chain: m?.[1], field: m ? m[1] + m[2] : '', value: String(value), onPick: (v) => onChange(v),
  }));

  function paint() {
    const std = optionStyle() === 'standard';
    plate.replaceChildren(
      // Family › variant at reading size: the name alone (`Extended compensation`) repeats across families.
      h('span.cpf', {}, h('b.cpfam', { text: opt.fam }), opt.var && h('span.cpsep', { text: '›' }), opt.var && h('span.cpvar', { text: opt.var })),
      h('span.cpl', { text: std ? String(opt.v) : opt.leaf }),
    );
  }
  paint();
  return h('div.cpk', {}, plate);
}
