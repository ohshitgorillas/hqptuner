// A row's control: one builder per control kind, each (D, {c, r, paintOpt}) → its element, with el._setValue(v)
// repainting it (Discard). control() registers what was built: Discard's repaint, the start value, the row's gray list.

import { h } from '../../lib/dom.js';
import { choiceLines } from '../../lib/controls.js';
import { changed } from './state.js';
import { segCtl, selectCtl, numberCtl, textCtl } from './inputs.js';
import { sliderCtl } from './slider.js';
import { togglesCtl } from './toggles.js';
import { accentCtl } from './accent.js';
import { deviceCtl, dialCtl } from './pickers.js';

/** control type 'group' {items:[control]} lays several controls in one row; an item's `label` sits above it. */
function groupCtl(D, { c, r, paintOpt }) {
  return h('div.cgrp', {}, c.items.map((it) => {
    const el = control(D, it, r, paintOpt);
    return it.label ? h('label.ci', {}, h('span.cl', { text: it.label }), el) : el;
  }));
}

/** Vertical radio lines; each line's detail control is live only while that line is picked. */
function choiceCtl(D, { c, r }) {
  const el = choiceLines(c, (ctl) => control(D, ctl, r), (v) => changed(D, { el, c, r, paintOpt: () => {} }, v));
  return el;
}

const BUILD = {
  choice: choiceCtl, group: groupCtl, seg: segCtl, select: selectCtl, number: numberCtl, text: textCtl,
  slider: sliderCtl, toggles: togglesCtl, accent: accentCtl, device: deviceCtl, dial: dialCtl,
};

/** Build control c of row r and register it with the drawer. */
export function control(D, c, r = {}, paintOpt = () => {}) {
  const el = BUILD[c.type]?.(D, { c, r, paintOpt });
  const set = el._setValue;
  if (c.id && set) D.ui.set(c.id, { set, c, r, paintOpt, el });
  if ('value' in c) D.vals[c.id] = String(c.value);
  if (c.gray && D.rowGray) D.rowGray.push({ c, el });
  return el;
}
