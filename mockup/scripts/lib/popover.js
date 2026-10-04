// Popover manager. One popover open at a time across the whole plate.
//  - Opening one closes whichever was open.
//  - A click outside the open popover (and outside its trigger / extra "inside" zones) closes it.
//  - Escape closes the open popover; if none is open, Escape falls through to other handlers
//    (the stage drawer listens for that).

let current = null;

/**
 * @param {object} o
 * @param {HTMLElement} o.trigger   button that toggles it; gets aria-expanded
 * @param {HTMLElement} o.panel     the popover element; toggled with .hidden
 * @param {HTMLElement[]} [o.inside] extra elements whose clicks don't count as "outside"
 * @param {(open:boolean)=>void} [o.onToggle] runs after open/close (position, swap arrow glyphs…)
 */
export function popover({ trigger, panel, inside = [], onToggle }) {
  const p = {
    trigger, panel, inside,
    get isOpen() { return !panel.hidden; },
    open() {
      if (current && current !== p) current.close();
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      current = p;
      onToggle?.(true);
    },
    close() {
      if (panel.hidden) return;
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (current === p) current = null;
      onToggle?.(false);
    },
    toggle() { p.isOpen ? p.close() : p.open(); },
    contains(node) { return [trigger, panel, ...inside].some((el) => el.contains(node)); },
  };
  panel.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', () => p.toggle());
  return p;
}

export const anyOpen = () => current !== null;

document.addEventListener('click', (e) => {
  // A target that re-rendered away mid-click (e.g. a removed tag) was inside something we own.
  if (current && e.target.isConnected && !current.contains(e.target)) current.close();
});

// Capture phase so it runs before bubble-phase Escape handlers (drawer) and can swallow the key.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && current) {
    e.stopImmediatePropagation();
    current.close();
  }
}, true);
