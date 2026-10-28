// The plate: the faceplate's one surface, laid out at the format store/faceplate/plate.js picks and at the size it
// gives, never scaled. It owns the listeners every part of the frame shares: the window's size, Escape, and the click
// that closes a popover from outside.

import { useEffect, useRef } from "preact/hooks";
import { html, observeSize, pageOf } from "../../lib/dom.js";
import { closeTop, closeOutside } from "../../store/faceplate/view.js";
import { plate, viewport } from "../../store/faceplate/plate.js";
import { plateBottom } from "../../store/faceplate/bottom/switcher.js";
import { engineRestarting } from "../../store/enginewrite.js";

/**
 * Read the window's size into the store, where it differs from the size the store holds. The size is the stage's own
 * box, the space the page lays out in, since a standalone launch on iPad can report a shorter `innerHeight` to scripts.
 * The stage spans the window, never the plate, so a page scrolled to a plate larger than the window reads the window.
 *
 * @param {HTMLElement} stage
 */
function measure(stage) {
  const { win } = pageOf(stage);
  const w = stage.clientWidth || win.innerWidth;
  const h = stage.clientHeight || win.innerHeight;
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

/**
 * Follow the stage's window and document for as long as the plate is mounted.
 *
 * @param {HTMLElement} stage
 */
function listen(stage) {
  const { doc, win } = pageOf(stage);
  const again = () => measure(stage);
  again();
  const vv = win.visualViewport;
  REMEASURE.forEach((type) => win.addEventListener(type, again));
  vv?.addEventListener("resize", again);
  const unobserve = observeSize(stage, again);
  doc.addEventListener("keydown", onKey);
  doc.addEventListener("click", onClick);
  return () => {
    unobserve();
    REMEASURE.forEach((type) => win.removeEventListener(type, again));
    vv?.removeEventListener("resize", again);
    doc.removeEventListener("keydown", onKey);
    doc.removeEventListener("click", onClick);
  };
}

/**
 * The plate at its layout and size for the window, around the frame's rows.
 *
 * @param {{ children?: unknown }} props
 */
export function Plate({ children }) {
  const stage = useRef(/** @type {HTMLElement | null} */ (null));
  useEffect(() => (stage.current ? listen(stage.current) : undefined), []);
  const p = plate.value;
  const b = plateBottom();
  const style = `--plate-w:${p.w}px;--plate-h:${p.h}px`;
  const restarting = engineRestarting.value ? "" : undefined;
  return html`
    <div id="stage" ref=${stage}>
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
