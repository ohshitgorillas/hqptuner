// Source meter view controls: the Range, Floor, Channel and Window switches and the page's Range column. Each takes
// its options and the handler that applies a pick; none marks the tab dirty.

import { h } from '../../lib/dom.js';
import { seg } from '../seg.js';
import { minusText } from '../../model/format.js';

/** Channel name on a level bar and the levels table. */
export const chName = (i) => ['L', 'R'][i] ?? String(i + 1);

/** Control: engraved label, optional unit, then the control. */
export function ctl(label, unit, control) {
  return h('div.mctl', {}, h('span.eng', { text: label }), unit && h('span.u', { text: unit }), control);
}

/**
 * A Range switch over `ranges`, dB.
 *
 * @param {number[]} ranges
 * @param {number} value
 * @param {string} cls
 * @param {(v: string) => void} onChange
 */
function rangeSeg(ranges, value, cls, onChange) {
  return seg({ aria: 'Range, dB', cls, value, options: ranges.map((v) => ({ v, label: String(v) })), onChange });
}

/** The spectrum head's Range control. */
export const spectrumRange = (ranges, value, onChange) => ctl('Range', 'dB', rangeSeg(ranges, value, 'view', onChange));

/** The levels head's Floor control, dBFS. */
export function floorCtl(floors, value, onChange) {
  return ctl('Floor', 'dBFS', seg({ aria: 'Floor, dBFS', cls: 'view', value, options: floors.map((v) => ({ v, label: minusText(v) })), onChange }));
}

/** Page: one Range for both halves, stacked in its own column left of the spectrum. */
export function pageRangeColumn(ranges, value, onChange) {
  return h('div.mrange', {},
    h('div.lbl', {}, h('span.eng', { text: 'Range' }), h('span.u', { text: 'dB' })),
    rangeSeg(ranges, value, 'view vert', onChange));
}

/**
 * The spectrogram head's Range, Channel and Window controls.
 *
 * @param {object} cfg  METER: ranges, channels, windows
 * @param {{ range: number, channel: string, window: number | 'all' }} st
 * @param {{ gramRange: Function, channel: Function, window: Function }} act
 */
export function spectrogramControls(cfg, st, act) {
  const nch = cfg.channels;
  // Default (Sum, v1 prefs) leftmost.
  const chOptions = [{ v: 'sum', label: 'Sum' }, ...Array.from({ length: nch }, (_, i) => ({ v: String(i), label: nch === 2 ? ['Left', 'Right'][i] : String(i + 1) }))];
  return [
    ctl('Range', 'dB', rangeSeg(cfg.ranges, st.range, 'view', act.gramRange)),
    ctl('Channel', null, seg({ aria: 'Channel', cls: 'view', value: st.channel, options: chOptions, onChange: act.channel })),
    ctl('Window', null, seg({ aria: 'Time window', cls: 'lc view', value: st.window, options: cfg.windows, onChange: act.window })),
  ];
}
