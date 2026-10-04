// The plate: the faceplate's one surface, laid out at the size the window holds and scaled down to fit a smaller one.
// It owns the listeners every part of the frame shares: the window's resize, Escape, and the click that closes a
// popover from outside.

import { useEffect } from "preact/hooks";
import { html } from "../../lib/dom.js";
import { plate, viewport, closeTop, closeOutside } from "../../store/faceplate/view.js";
import { plateBottom } from "../../store/faceplate/bottom/switcher.js";

/** Read the window's inner size into the store. */
function measure() {
  viewport.value = { w: window.innerWidth, h: window.innerHeight };
}

/** @param {KeyboardEvent} e */
function onKey(e) {
  if (e.key === "Escape") closeTop();
}

/** @param {MouseEvent} e */
function onClick(e) {
  if (e.target instanceof Element) closeOutside(e.target);
}

/** Follow the window and the document for as long as the plate is mounted. */
function listen() {
  measure();
  window.addEventListener("resize", measure);
  document.addEventListener("keydown", onKey);
  document.addEventListener("click", onClick);
  return () => {
    window.removeEventListener("resize", measure);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("click", onClick);
  };
}

/**
 * The plate at the window's size and scale, around the frame's rows.
 *
 * @param {{ children?: unknown }} props
 */
export function Plate({ children }) {
  useEffect(listen, []);
  const p = plate.value;
  const b = plateBottom();
  const style = `--plate-w:${p.w}px;--plate-h:${p.h}px;transform:scale(${p.scale})`;
  return html`
    <div id="stage">
      <div class="plate" data-size=${p.id} data-bottom=${b?.bottom} data-sw=${b?.sw} style=${style}>${children}</div>
    </div>
  `;
}
