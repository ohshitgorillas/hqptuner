// USB listings step (wizard §1.5 USB Disambiguation): the pair picked for the one device, Disambiguate, and its lines.

import { h } from '../../lib/dom.js';
import { STB_USB } from '../../data/station-builder.js';
import { classNames } from '../../model/format.js';
import { deviceParts as parts } from '../../model/output.js';
import { listingState } from '../../model/station.js';
import { lines } from './parts.js';
import { disambiguate } from './checks.js';

/** The USB listings step's rows. */
export function usbStep(sb) {
  const x = sb.e.rec;
  const run = sb.runs.usb;
  const pair = h('div.stbdevs.stbpair', {}, x.listings.map((str) => {
    const p = parts(x.backend, str);
    const st = listingState(x, str);
    return h('div.stbdev', { class: classNames(st.locked && 'on', st.dead && 'dead') },
      h('span.stbdn', {}, h('span.m', { text: p.main }), h('span.d', { text: p.group + (p.detail ? ' · ' + p.detail : '') })),
      st.locked && h('span.tag.stblock', { text: STB_USB.locked }));
  }));
  return [
    h('div.drow.drow-full.stbdrow', {}, pair),
    h('div.stbnotes', {}, h('p', { text: STB_USB.how })),
    h('div.stbact', {}, h('button.btn.sm', { type: 'button', text: STB_USB.go, on: { click: () => disambiguate(sb) } })),
    lines(run),
  ];
}
