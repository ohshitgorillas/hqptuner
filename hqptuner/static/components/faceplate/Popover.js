// A popover sheet on the plate. One is open at a time (store/faceplate/view.js): its trigger toggles it, Escape and a
// click outside close it. The panel and its trigger both carry `data-pop`, which is how a click is known to be inside.
// A caller that parks its panel against the trigger passes `park`, which runs each time the panel opens.

import { useLayoutEffect, useRef } from "preact/hooks";
import { html } from "../../lib/dom.js";
import { clampToPlate } from "../../model/shell/place.js";
import { openPopover, togglePopover, plate } from "../../store/faceplate/view.js";

/** @typedef {import("../../model/shell/place.js").Side} Side */
/** @typedef {import("../../model/shell/place.js").Margin} Margin */
/** @typedef {import("../../model/shell/place.js").Place} Place */

/**
 * The attributes a popover's trigger button carries.
 *
 * @param {string} id  the popover's id
 * @param {string} haspopup  what the popover is: dialog, listbox or menu
 */
export const triggerProps = (id, haspopup) => ({
  "data-pop": id,
  "aria-haspopup": haspopup,
  "aria-expanded": String(openPopover.value === id),
  onClick: () => togglePopover(id),
});

/**
 * Where a plate-level panel lands against its trigger, clamped inside the plate, in the plate's layout px.
 *
 * @param {HTMLElement} panel
 * @param {{ side: Side, foot: Margin, at: Place }} how
 * @returns {{ left: number, top: number } | null}  null when the panel has no trigger or plate to measure against
 */
export function parkAt(panel, how) {
  const face = panel.closest(".plate");
  const trigger = face?.querySelector(`button[data-pop="${panel.dataset.pop}"]`);
  if (!face || !trigger) return null;
  const r = trigger.getBoundingClientRect(),
    p = face.getBoundingClientRect();
  const fit = plate.value;
  return clampToPlate({
    anchor: { left: r.left - p.left, top: r.top - p.top, width: r.width, height: r.height },
    panel: { w: panel.offsetWidth, h: panel.offsetHeight },
    plate: { w: fit.w, h: fit.h },
    scale: fit.scale,
    ...how,
  });
}

/**
 * A popover panel, shown while its id is the open one.
 *
 * @param {object} props
 * @param {string} props.id  the popover's id, as its trigger names it
 * @param {string} [props.cls]  classes beside `pop`
 * @param {string} props.role
 * @param {string} props.label  the panel's accessible name
 * @param {(panel: HTMLElement) => void} [props.park]  positions the panel; runs each time it opens
 * @param {unknown} [props.children]
 */
export function Popover({ id, cls = "", role, label, park, children }) {
  const open = openPopover.value === id;
  const ref = useRef(/** @type {HTMLElement | null} */ (null));
  useLayoutEffect(() => {
    if (open && park && ref.current) park(ref.current);
  }, [open, park]);
  return html`
    <div ref=${ref} class=${`pop ${cls}`.trim()} data-pop=${id} role=${role} aria-label=${label} hidden=${!open}>
      ${children}
    </div>
  `;
}
