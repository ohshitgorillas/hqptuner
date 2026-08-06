// Exclusive-popover state for the narrowing bar: the six per-facet open signals,
// the map that names them, and the pointerdown reducer that closes every popover
// but the one that was clicked. All of it lives in this ONE module on purpose —
// "only one popover open at a time" is a property of the set, so a signal
// declared or duplicated elsewhere would silently allow two popovers open at
// once.
import { signal } from "@preact/signals";

/**
 * @typedef {{ value: boolean }} OpenSignal
 */

export const focusOpen = signal(false);
export const genreOpen = signal(false);
export const qualityOpen = signal(false);
export const phaseOpen = signal(false);
export const lengthOpen = signal(false);
export const ratioOpen = signal(false);

// Every popover, keyed by the `data-multi` its wrapper carries. A pointerdown
// anywhere on the page closes each one whose own wrapper wasn't the target —
// clicking the page, or another facet's button, retracts what's open.
const POPOVERS = {
  genre: genreOpen,
  quality: qualityOpen,
  focus: focusOpen,
  phase: phaseOpen,
  length: lengthOpen,
  ratio: ratioOpen,
};

/**
 * @param {Element | null} target
 * @returns {void}
 */
export function closeExcept(target) {
  const box = /** @type {HTMLElement | null} */ (target && target.closest ? target.closest(".multi") : null);
  const keep = box ? box.dataset.multi : null;
  for (const [name, sig] of Object.entries(POPOVERS)) {
    if (name !== keep && sig.value) sig.value = false;
  }
}
