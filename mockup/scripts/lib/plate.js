// The faceplate is laid out at an iPad's landscape size in points (CSS px): 10.2" by default (the smallest target), or
// 11" / 13" from the Display size switch on the mock strip (SIZES; `#size-11` / `#size-13` in the URL). The app reflows to
// the size it is given, as it would on that iPad; the switch is a viewing tool, not part of the app.
// The plate is scaled down to fit a smaller window (never up). Renders 1:1 when the window holds the plate.
// Anything that measures the DOM (rail wire, popover parking) must divide screen px by scale().
// PLATE_W / PLATE_H are live bindings: importers read the current size, never cache it.

/**
 * iPad landscape viewports in points (Apple: 10.2" iPad 7th–9th gen; 11" iPad / iPad Air 11"; 13" iPad Air 13").
 * both: tall enough to open both Resampling filters (1x and Nx) instead of stretching the Matrix section (conversion.js).
 * meter: how the page's Source meter takes the fill while the Matrix section is gone: 'full' (spectrum + levels with their
 * heads, Range / Floor, the readout table) or 'slim' (the spectrum strip and two bars, nothing else: the room 10.2″ / 11″ leave).
 */
export const SIZES = [
  { id: '10.2', label: '10.2″', w: 1080, h: 810, model: 'iPad 10.2″', meter: 'slim' },
  { id: '11', label: '11″', w: 1180, h: 820, model: 'iPad / iPad Air 11″', meter: 'slim' },
  { id: '13', label: '13″', w: 1366, h: 1024, model: 'iPad Air 13″', both: true, meter: 'full' },
];
export const SIZE0 = '10.2';
export const sizeOf = (id) => SIZES.find((z) => z.id === id) || SIZES[0];

export let PLATE_W = SIZES[0].w;
export let PLATE_H = SIZES[0].h;
export let SIZE = SIZE0;
export const SCENE_H = 40;   // mock scenario strip above the plate (base.css --scene-h); not part of the app

let plate = null;
let relay = null;   // the shared bus (lib/bus.js): measurers re-measure on `relayout`
let current = 1;

export const scale = () => current;

/**
 * @param {HTMLElement} el
 * @param {string} size   the display size to open on (`#size-<id>`, model/flags.js), else SIZE0
 * @param {import('./bus.js').Bus} bus
 */
export function mountPlate(el, size, bus) {
  plate = el;
  relay = bus;
  setSize(size, true);
  bus.on('relayout', fit);
}

/**
 * Lay the plate out at another iPad size: the CSS geometry (--plate-w / --plate-h, data-size) and the numbers here move
 * together, then everything that measures re-measures (one relayout: rail wire, plots, page fit, popovers).
 */
export function setSize(id, quiet = false) {
  const z = SIZES.find((x) => x.id === id) || SIZES[0];
  SIZE = z.id; PLATE_W = z.w; PLATE_H = z.h;
  plate.style.setProperty('--plate-w', `${z.w}px`);
  plate.style.setProperty('--plate-h', `${z.h}px`);
  plate.dataset.size = z.id;
  fit();
  if (!quiet) relay.emit('relayout');
}

function fit() {
  current = Math.min(window.innerWidth / PLATE_W, (window.innerHeight - SCENE_H) / PLATE_H, 1);
  plate.style.transform = `scale(${current})`;
}

/** Screen rect → plate-space offset of its top-left corner. */
export function toPlate(rect) {
  const p = plate.getBoundingClientRect();
  return { x: (rect.left - p.left) / current, y: (rect.top - p.top) / current };
}

/**
 * Park a plate-level popover to the LEFT of its trigger, tops aligned, clamped inside the plate
 * (22px side padding, 14px bottom margin). Used by Filter presets and Narrow filters.
 */
export function parkLeftOf(panel, trigger) {
  const b = toPlate(trigger.getBoundingClientRect());
  panel.style.left = Math.round(Math.max(22, b.x - panel.offsetWidth - 12)) + 'px';
  panel.style.top = Math.round(Math.min(b.y, PLATE_H - 14 - panel.offsetHeight)) + 'px';
}
