// Page Output section: the rate picker. It exists only while Settings → Behavior → Allow pinned rates is On (the page holds
// engaged stages with a job on the page; with pins off the Output stage has none: the rail shows the format, the Output
// drawer sets it). The output rate is the whole subject: no source mark, no ratio, no mode control.
//   Glass    two rows. Head column (`Auto` | `44.1k · 48k`) | one column per tier of the running band: the tier name, then
//            its two exact rates side by side (44.1k family first, as the head says) with the tier's unit once after the
//            pair, each rate a live pin (SetRate): one tap, one exact rate. Hatched where the device can't carry the tier.
//            The other band never shows (output mode is the station's: Setting Switcher, Output drawer). Two rows, not
//            three: the 20px go to the Source spectrum at 10.2″ (the page's overflow order, after the option copy).
//   Marks    the rate playing is ringed (ink: a measurement); the pin (or `Auto`, no pin) reads in accent (a setting).
//            Pinned, the pin is what plays: accent and ringed. Nothing playing: no ring.

import { h } from '../lib/dom.js';

const FAMS = [['f44', '44.1k'], ['f48', '48k']];

/**
 * @param {HTMLElement} host   #oglass, inside the page's Output section
 * @param {object} rt          RATE_TIERS
 * @param {{onPin: (pin: {tier: number, fam: 'f44'|'f48'} | null) => void, bus: import('../lib/bus.js').Bus}} o
 */
export function mountOutputTuner(host, rt, { onPin, bus }) {
  const section = host.closest('section');
  let st = { run: 'sdm', tier: null, src: null, fam: 'f44' };
  let allowed = false, pin = null;

  const auto = h('button.otautop', { type: 'button', on: { click: () => { pin = null; onPin(null); paint(); } } }, 'Auto');
  const heads = h('div.otheads', {}, auto, h('span.otfh', { text: FAMS.map(([, l]) => l).join(' · ') }));
  const grid = h('div.otgrid');
  host.replaceChildren(h('div.vfd.otglass', { role: 'group', 'aria-label': 'Output rate' }, heads, grid));

  function paint() {
    section.hidden = !allowed;
    if (!allowed) return;
    const idx = rt.tiers.map((t, i) => (t.family === st.run ? i : -1)).filter((i) => i >= 0);
    const playing = st.src != null && st.tier != null;
    const playFam = pin ? pin.fam : st.fam;
    grid.style.gridTemplateColumns = `repeat(${idx.length}, 1fr)`;
    grid.replaceChildren(...idx.map((i) => {
      const t = rt.tiers[i];
      const pair = h('div.otpair', {});
      const col = h('div.otcol', { class: t.unavailable && 'otunav' }, h('span.ottn', { text: t.name }), pair);
      for (const [f] of FAMS) {
        if (t.unavailable) { pair.append(h('span.otp.otno', { text: t[f] })); continue; }
        const on = pin?.tier === i && pin.fam === f;
        const play = playing && st.tier === i && playFam === f;
        pair.append(h('button.otp', { type: 'button', class: [on && 'otpinned', play && 'otplay'].filter(Boolean).join(' '),
          aria: { pressed: on, label: `Pin ${t[f]} ${t.unit}${play ? ', playing' : ''}` },
          on: { click: () => { pin = { tier: i, fam: f }; onPin({ ...pin }); paint(); } } }, t[f]));
      }
      pair.append(h('span.otu', { class: t.unavailable && 'otno', text: t.unit }));   // the tier's unit, once for the pair
      return col;
    }));
    auto.classList.toggle('otpinned', !pin);
    auto.setAttribute('aria-pressed', String(!pin));
  }

  return {
    /** What runs (conversion.js, every render): the running band, the output tier, the source tier (null: nothing plays),
     *  the source's base family (f44 | f48: auto rate family follows it). */
    set(next) {
      if (next.run !== st.run && pin) { pin = null; onPin(null); }   // a pin is a rate of the running band
      st = next; paint();
    },
    /** Settings → Behavior → Allow pinned rates: On shows the section; Off hides it and clears the pin. */
    allow(on) {
      allowed = on;
      if (!on && pin) { pin = null; onPin(null); }
      paint();
      bus.emit('relayout');   // the page refits around the section
    },
  };
}
