// Segmented switch builder. Exactly one option is .on; clicking another moves it and calls onChange.

import { h } from '../lib/dom.js';

/**
 * @param {object} o
 * @param {{v:any,label:string,unit?:string,title?:string}[]} o.options   unit: printed after the label, case kept
 * @param {any} o.value           initially selected v (compared as strings)
 * @param {string} [o.aria]       radiogroup label
 * @param {string} [o.tag]        element: 'div' (default) or 'span'
 * @param {string} [o.cls]        extra classes (e.g. 'mini')
 * @param {object} [o.attrs]      extra attributes for the group element
 * @param {(v:string, btn:HTMLButtonElement)=>void} [o.onChange]
 */
export function seg({ options, value, aria, tag = 'div', cls, attrs = {}, onChange }) {
  const group = h(`${tag}.seg`, { class: cls, role: 'radiogroup', 'aria-label': aria, ...attrs },
    options.map((o) => h('button', {
      type: 'button', title: o.title, class: String(o.v) === String(value) ? 'on' : null, data: { v: o.v },
    }, o.label, o.unit && h('span.su', { text: ' ' + o.unit }))),
  );
  group.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.classList.contains('on')) return;
    select(group, b.dataset.v);
    onChange?.(b.dataset.v, b);
  });
  return group;
}

/** Move .on to the button whose data-v matches. */
export function select(group, v) {
  for (const b of group.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === String(v));
}
