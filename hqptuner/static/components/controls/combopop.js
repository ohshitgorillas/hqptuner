// Placement and dismissal machinery for the Combobox pop (Combobox.js, its
// only caller). Fixed-position placement, all coordinates from
// getBoundingClientRect — ancestor-independent (no transform/containing-block
// surprises) and identical across engines.
import { useEffect, useLayoutEffect } from "preact/hooks";

/**
 * @typedef {{ current: HTMLElement | null }} ElRef
 *   A preact ref pointed at one of the combobox's own elements.
 */

/**
 * Flip above the button only when below can't fit the natural height AND above
 * is roomier; cap to the chosen side minus an 8px viewport margin, 4px clear of
 * the trigger on either side.
 * @param {{ top: number, bottom: number }} trigger the trigger's rect
 * @param {number} natural the pop's uncapped height
 * @param {number} viewportHeight
 * @returns {{ top: number, maxHeight: number, scrolls: boolean }}
 */
export function verticalPlacement(trigger, natural, viewportHeight) {
  const below = viewportHeight - trigger.bottom - 4;
  const above = trigger.top - 4;
  const up = natural > below - 8 && above > below;
  const maxHeight = Math.min(natural, (up ? above : below) - 8);
  return {
    top: up ? trigger.top - 4 - maxHeight : trigger.bottom + 4,
    maxHeight,
    scrolls: natural > maxHeight,
  };
}

/**
 * @param {HTMLElement} b the trigger button
 * @param {HTMLElement} p the pop
 */
function placePop(b, p) {
  const br = b.getBoundingClientRect();
  p.style.minWidth = `${br.width}px`;
  p.style.maxHeight = ""; // natural height first, then cap for the chosen side
  const natural = p.offsetHeight;
  const { top, maxHeight, scrolls } = verticalPlacement(br, natural, window.innerHeight);
  // The pop sizes shrink-to-fit, so a classic scrollbar would take its width
  // out of the rows and clip the right-pinned marks. Reserve the gutter only
  // when the cap makes the list scroll — an unconditional reserve reads as
  // dead space beside the marks whenever the list fits.
  p.style.scrollbarGutter = scrolls ? "stable" : "auto";
  p.style.maxHeight = `${maxHeight}px`;
  p.style.top = `${top}px`;
  // Right edges flush with the trigger: a pop wider than its button (the
  // grouped Simplified lists) grows leftward into the card, never rightward
  // off it. minWidth above keeps the pop at least trigger-wide, so the
  // narrow case stays exactly the old left-aligned placement.
  p.style.left = `${Math.max(8, br.right - p.getBoundingClientRect().width)}px`;
}

// Keep the highlighted row inside the pop's own scrollport by writing
// scrollTop directly. Never scrollIntoView: Safari honours it by scrolling
// every scrollable ancestor — the document included — which shifts the page
// under a fixed-position pop and detaches it from its button.
/**
 * Measured between the two bounding rects, so the pop's padding counts and the
 * row lands whole inside it.
 * @param {{ top: number, bottom: number }} popRect the pop's rect
 * @param {{ top: number, bottom: number }} rowRect the highlighted row's rect
 * @returns {number} the scrollTop delta that brings the row inside the pop
 */
function revealDelta(popRect, rowRect) {
  if (rowRect.top < popRect.top) return rowRect.top - popRect.top;
  if (rowRect.bottom > popRect.bottom) return rowRect.bottom - popRect.bottom;
  return 0;
}

/**
 * @param {HTMLElement} p the pop
 * @param {Element} row the highlighted row
 */
function revealRow(p, row) {
  const delta = revealDelta(p.getBoundingClientRect(), row.getBoundingClientRect());
  if (delta) p.scrollTop += delta;
}

// Tip sits beside the highlighted row: left of the pop, narrowing itself into
// the gap when the full width would not fit, and right only when even the
// narrowed tip cannot; bottom clamped inside the viewport. The 340px cap is
// the one the markup opens with (Combobox.js TipPop), re-applied here because
// a narrowed tip must widen back when the same widget reopens with more room.
/**
 * The tip takes whichever side of the pop has more room to the viewport edge,
 * and its width is capped to that room.
 * @param {number} popLeft the pop's left edge
 * @param {number} popRight the pop's right edge
 * @param {number} vw the viewport width
 * @returns {{ left: boolean, maxWidth: number }} whether the tip sits left of the pop, and its width cap
 */
export function tipSide(popLeft, popRight, vw) {
  const leftRoom = popLeft - 16; // 8px to the pop, 8px viewport margin
  const rightRoom = vw - popRight - 16;
  const left = leftRoom >= 240 || leftRoom >= rightRoom;
  return { left, maxWidth: Math.min(340, Math.max(200, left ? leftRoom : rightRoom)) };
}

/**
 * @param {HTMLElement} t the tip
 * @param {HTMLElement} p the pop
 * @param {Element} row the highlighted row
 */
function placeTip(t, p, row) {
  const pr = p.getBoundingClientRect();
  const { left, maxWidth } = tipSide(pr.left, pr.right, window.innerWidth);
  t.style.maxWidth = `${maxWidth}px`;
  const tr = t.getBoundingClientRect();
  const tl = left ? pr.left - tr.width - 8 : pr.right + 8;
  t.style.left = `${Math.max(8, Math.min(tl, window.innerWidth - 8 - tr.width))}px`;
  t.style.top = `${Math.min(row.getBoundingClientRect().top, window.innerHeight - 8 - tr.height)}px`;
  t.style.visibility = "visible";
}

/**
 * Close on outside pointerdown (not blur — a click in the pop must survive),
 * on any scroll outside the pop, and on resize. Listeners exist only while
 * open; scroll is capture-phase since scroll events don't bubble.
 * @param {{ open: boolean, setOpen: (v: boolean) => void, btnRef: ElRef, popRef: ElRef }} ctx
 */
export function useDismissOnOutside({ open, setOpen, btnRef, popRef }) {
  useEffect(() => {
    if (!open) return undefined;
    /** @param {Node} t */
    const inside = (t) =>
      (btnRef.current && btnRef.current.contains(t)) || (popRef.current && popRef.current.contains(t));
    // `target` is the element the gesture landed on — a Node, though the DOM
    // lib types it as the wider EventTarget.
    /** @param {Event} e */
    const down = (e) => !inside(/** @type {Node} */ (e.target)) && setOpen(false);
    /** @param {Event} e */
    const scroll = (e) =>
      !(popRef.current && popRef.current.contains(/** @type {Node} */ (e.target))) && setOpen(false);
    const resize = () => setOpen(false);
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [open]);
}

/**
 * Placement work, split by what it depends on. The pop is measured and placed
 * on OPEN only: re-running placement on highlight changes destroys the user's
 * scroll position, since the maxHeight reset for re-measurement clamps
 * scrollTop and warps the list back to the selection on every hover.
 * Per-highlight work reveals the row only for keyboard moves — a hovered row
 * is already visible — and places the tip. Layout effects, so both land
 * before the frame paints; they do not run under SSR.
 * @param {{ open: boolean, hl: number, id: string, tipKey: string, byKey: { current: boolean },
 *   btnRef: ElRef, popRef: ElRef, tipRef: ElRef }} ctx
 */
export function usePopPlacement({ open, hl, id, tipKey, byKey, btnRef, popRef, tipRef }) {
  useLayoutEffect(() => {
    if (!open) return;
    if (btnRef.current && popRef.current) placePop(btnRef.current, popRef.current);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const p = popRef.current;
    // By id, not children[hl]: group containers nest the rows, so the flat row
    // index no longer maps onto the pop's direct children.
    const row = p && p.querySelector(`[id="${id}-${hl}"]`);
    if (!row) return;
    if (byKey.current) revealRow(p, row);
    if (tipRef.current) placeTip(tipRef.current, p, row);
  }, [open, hl, tipKey]);
}
