// Bottom sheets: drawers that rise from the plate's bottom edge over the bottom bar and the body (rail + page), leaving
// the header and engine row in view. Used by the option lists (filters, modulators, dithers). One sheet shows at a time; a sheet
// opened from another stacks on it, and closing it returns to the one beneath. Escape and × close the top sheet. Stage
// drawers stay put underneath.

import { h } from './dom.js';
import { anyOpen } from './popover.js';

const stack = [];

/**
 * @param {HTMLElement} plate
 * @param {{id: string, aria: string, cls?: string}} o
 * @returns {{el: HTMLElement, head: HTMLElement, body: HTMLElement, open(): void, close(): void, isOpen: boolean,
 *            onOpen?: () => void, onClose?: () => void}}
 */
export function sheet(plate, { id, aria, cls }) {
  const head = h('div.shead');
  const body = h('div.sbody2');
  const el = h(`aside.sheet#${id}`, { class: cls, role: 'dialog', 'aria-label': aria, 'data-closed': '' }, head, body);
  plate.append(el);
  const s = {
    el, head, body,
    get isOpen() { return !el.hasAttribute('data-closed'); },
    open() {
      const top = stack[stack.length - 1];
      if (top === s) return;
      const i = stack.indexOf(s);
      if (i >= 0) stack.splice(i, 1);
      if (top) top.el.setAttribute('data-under', '');
      stack.push(s);
      // From the plate's bottom edge up to the engine row's rule: over the body (rail + page) and the bottom bar, which
      // gives way; the header and engine row stay in view. No scroll anywhere: a whole list, with
      // every family and variant description, fits this height.
      // Whichever body is showing (the Snapshot builder's swaps in for the chain's).
      const b = plate.querySelector('.body:not([hidden])') ?? plate.querySelector('#body');
      el.style.top = `${b.offsetTop}px`;
      el.style.height = `${plate.clientHeight - b.offsetTop - 2}px`;
      s.onOpen?.();
      el.removeAttribute('data-under');
      el.removeAttribute('data-closed');
    },
    close() {
      const i = stack.indexOf(s);
      if (i < 0) return;
      stack.splice(i, 1);
      el.setAttribute('data-closed', '');
      s.onClose?.();
      stack[stack.length - 1]?.el.removeAttribute('data-under');
    },
  };
  return s;
}

/** Close every sheet (Settings swap). */
export function closeSheets() { while (stack.length) stack[stack.length - 1].close(); }

export const sheetOpen = () => stack.length > 0;

/**
 * Escape closes the top sheet before any stage drawer hears it (capture; popovers, also capture, installed first, win).
 * main.js installs it once, right after installPopovers.
 */
export function installSheets() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || anyOpen() || !stack.length) return;
    e.stopImmediatePropagation();
    stack[stack.length - 1].close();
  }, true);
}

export { closeBtn } from './controls.js';
