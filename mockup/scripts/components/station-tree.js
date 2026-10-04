// Station · Snapshot tree-select (header). Station rows fold their snapshots via the chevron;
// non-active stations show "↻ restart" (recall restarts the engine). Footer: save / delete.
// Selection itself isn't wired yet (mockup). refresh(stations) repaints it after the Station builder saves or deletes.

import { h } from '../lib/dom.js';
import { popover } from '../lib/popover.js';

const MIN_WIDTH = 330;

export function mountStationTree(host, stations) {
  const arrow = h('span.ar', { text: '▼' });
  const label = h('span.v');
  const trigger = h('button.vfd.tree#station', { type: 'button', aria: { haspopup: 'listbox' } }, label, arrow);
  const rows = h('div.prows');
  const panel = h('div.pop#pop', { role: 'listbox', 'aria-label': 'Stations and snapshots' },
    rows,
    h('div.pfoot', {},
      h('button.btn.sm', { type: 'button' }, 'Save snapshot…'),
      h('button.btn.sm', { type: 'button' }, 'Save station…'),
      h('span.grow'),
      h('button.btn.sm', { type: 'button' }, 'Delete'),
    ),
  );

  host.append(trigger, panel);

  function refresh(list) {
    const station = list.find((s) => s.active);
    const snapshot = station?.snapshots.find((s) => s.active);
    label.replaceChildren(station.name + ' ', h('span.sep', { text: '›' }), ' ' + (snapshot?.name ?? ''));
    rows.replaceChildren(...list.flatMap(stationRows).filter(Boolean));
  }
  refresh(stations);

  popover({
    trigger, panel,
    onToggle(open) {
      arrow.textContent = open ? '▲' : '▼';
      if (open) {
        panel.style.left = trigger.offsetLeft + 'px';
        panel.style.width = Math.max(MIN_WIDTH, trigger.offsetWidth) + 'px';
      }
    },
  });
  return { refresh };
}

function stationRows(st) {
  const hasSnaps = st.snapshots.length > 0;
  const group = hasSnaps && h('div.grp', { hidden: !st.open },
    st.snapshots.map((sn) => h('div.srow', { class: sn.active && 'cur' },
      h('span.pn', { text: sn.name }),
      sn.active && h('span.lamp.on'),
    )),
  );
  const chev = h('button.chev', {
    type: 'button',
    class: !hasSnaps && 'none',
    'aria-label': hasSnaps ? `Show ${st.name} snapshots` : null,
    aria: hasSnaps ? { expanded: !!st.open } : {},
    tabindex: hasSnaps ? null : -1,
    text: st.open ? '▾' : '▸',
  });
  if (hasSnaps) {
    chev.addEventListener('click', () => {
      group.hidden = !group.hidden;
      chev.textContent = group.hidden ? '▸' : '▾';
      chev.setAttribute('aria-expanded', String(!group.hidden));
    });
  }
  const row = h('div.prow', { class: st.active && 'cur' },
    chev,
    h('span.pn', { text: st.name }),
    st.active ? h('span.lamp.on') : h('span.rs', { text: '↻ restart' }),
  );
  return [row, group];
}
