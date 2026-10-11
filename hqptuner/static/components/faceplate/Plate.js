// The plate: the faceplate's one surface, laid out at the format store/faceplate/plate.js picks and scaled down to
// fit a smaller window. It owns the listeners every part of the frame shares: the window's size, Escape, and the click
// that closes a popover from outside.

import { useEffect } from "preact/hooks";
import { html } from "../../lib/dom.js";
import { closeTop, closeOutside } from "../../store/faceplate/view.js";
import { plate, viewport } from "../../store/faceplate/plate.js";
import { plateBottom } from "../../store/faceplate/bottom/switcher.js";
import { engineRestarting } from "../../store/enginewrite.js";

/** Read the window's inner size into the store, where it differs from the size the store holds. */
function measure() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w !== viewport.value.w || h !== viewport.value.h) viewport.value = { w, h };
}

/** @param {KeyboardEvent} e */
function onKey(e) {
  if (e.key === "Escape") closeTop();
}

/** @param {MouseEvent} e */
function onClick(e) {
  if (e.target instanceof Element) closeOutside(e.target);
}

/**
 * The window events after which its size is read again. A standalone launch on iPad can settle its size after the
 * first read, and announces it by one of these rather than by `resize`.
 */
const REMEASURE = ["resize", "orientationchange", "pageshow"];

/** Follow the window and the document for as long as the plate is mounted. */
function listen() {
  measure();
  const vv = window.visualViewport;
  REMEASURE.forEach((type) => window.addEventListener(type, measure));
  vv?.addEventListener("resize", measure);
  document.addEventListener("keydown", onKey);
  document.addEventListener("click", onClick);
  return () => {
    REMEASURE.forEach((type) => window.removeEventListener(type, measure));
    vv?.removeEventListener("resize", measure);
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
  const restarting = engineRestarting.value ? "" : undefined;
  return html`
    <div id="stage">
      <div
        class="plate"
        data-size=${p.id}
        data-bottom=${b?.bottom}
        data-sw=${b?.sw}
        data-restarting=${restarting}
        style=${style}
      >
        ${children}
      </div>
    </div>
  `;
}
