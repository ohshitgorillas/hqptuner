// Placement and dismissal machinery for the Combobox pop (Combobox.js, its
// only caller). Fixed-position placement, all coordinates from
// getBoundingClientRect — ancestor-independent (no transform/containing-block
// surprises) and identical across engines.
import { useEffect, useLayoutEffect } from "preact/hooks";

/**
 * @typedef {{ current: HTMLElement | null }} ElRef
 *   A preact ref pointed at one of the combobox's own elements.
 */

// Flip above the button only when below can't fit the natural height AND above
// is roomier; cap to the chosen side minus an 8px viewport margin.
/**
 * @param {HTMLElement} b the trigger button
 * @param {HTMLElement} p the pop
 */
function placePop(b, p) {
  const br = b.getBoundingClientRect();
  p.style.minWidth = `${br.width}px`;
  p.style.maxHeight = ""; // natural height first, then cap for the chosen side
  const natural = p.offsetHeight;
  const below = window.innerHeight - br.bottom - 4;
  const above = br.top - 4;
  const up = natural > below - 8 && above > below;
  const maxH = Math.min(natural, (up ? above : below) - 8);
  p.style.maxHeight = `${maxH}px`;
  p.style.top = `${up ? br.top - 4 - maxH : br.bottom + 4}px`;
  const left = Math.min(br.left, window.innerWidth - 8 - p.getBoundingClientRect().width);
  p.style.left = `${Math.max(8, left)}px`;
}

// Keep the highlighted row inside the pop's own scrollport by writing
// scrollTop directly. Never scrollIntoView: Safari honours it by scrolling
// every scrollable ancestor — the document included — which shifts the page
// under a fixed-position pop and detaches it from its button.
/**
 * @param {HTMLElement} p the pop
 * @param {Element} row the highlighted row
 */
function revealRow(p, row) {
  // Rect deltas, not offsetTop arithmetic — offset coordinates and
  // clientHeight disagree by the pop's padding and the row ends up clipped.
  const pr = p.getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  if (rr.top < pr.top) p.scrollTop += rr.top - pr.top;
  else if (rr.bottom > pr.bottom) p.scrollTop += rr.bottom - pr.bottom;
}

// Tip sits beside the highlighted row: left of the pop, or right when the
// left edge would leave the viewport; bottom clamped inside the viewport.
/**
 * @param {HTMLElement} t the tip
 * @param {HTMLElement} p the pop
 * @param {Element} row the highlighted row
 */
function placeTip(t, p, row) {
  const pr = p.getBoundingClientRect();
  const tr = t.getBoundingClientRect();
  const tl = pr.left - 8 - tr.width < 8 ? pr.right + 8 : pr.left - tr.width - 8;
  t.style.left = `${tl}px`;
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
