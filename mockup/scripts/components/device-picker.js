// Output device picker. Engine device strings split on ": ":
//   network  "host: card: interface"  → button shows card big, "host · interface" small; list grouped by host
//   alsa     "card: interface"        → button shows interface big, card small; list grouped by card

import { h } from '../lib/dom.js';
import { popover } from '../lib/popover.js';

function parts(kind, str) {
  const a = str.split(': ');
  return kind === 'network'
    ? { group: a[0], main: a[1] || a[0], detail: a.slice(2).join(': ') }
    : { group: a[0], main: a.slice(1).join(': ') || a[0], detail: '' };
}

/**
 * @param {HTMLElement} host   empty .devpick container
 * @param {{kind:string, aria:string}} cfg
 * @param {{list:string[], selected:number}} devices
 * @param {() => void} onChange
 */
export function mountDevicePicker(host, { kind, aria }, devices, onChange) {
  let sel = devices.selected;
  const main = h('span.v'), sub = h('span.l'), arrow = h('span.ar', { text: '▼' });
  const trigger = h('button.vfd.devbtn', { type: 'button', aria: { haspopup: 'listbox', label: aria } },
    h('span.tx', {}, main, sub), arrow);
  const list = h('div.devlist', { role: 'listbox' });
  host.append(trigger, list);

  const pop = popover({ trigger, panel: list, onToggle: (open) => { arrow.textContent = open ? '▲' : '▼'; } });

  function paint() {
    const p = parts(kind, devices.list[sel]);
    main.textContent = p.main;
    sub.textContent = kind === 'network' ? p.group + (p.detail ? ' · ' + p.detail : '') : p.group;

    let lastGroup = null;
    list.replaceChildren(...devices.list.flatMap((str, i) => {
      const q = parts(kind, str);
      const out = [];
      if (q.group !== lastGroup) {
        lastGroup = q.group;
        out.push(h('div.gh', {}, h('span', { text: q.group }), h('span.ln')));
      }
      const cur = i === sel;
      out.push(h('button.devrow', {
        type: 'button', class: cur && 'cur', role: 'option', aria: { selected: cur },
        on: { click: () => { if (i !== sel) { sel = i; onChange(); } paint(); pop.close(); } },
      },
        h('span.lamp', { class: cur && 'on' }),
        h('span.m', { text: q.main }),
        q.detail && h('span.d', { text: q.detail }),
      ));
      return out;
    }));
  }
  paint();
  // Discard (mock): the drawer reads the picked device and puts it back.
  return { value: () => String(sel), setValue: (v) => { sel = Number(v); paint(); } };
}
