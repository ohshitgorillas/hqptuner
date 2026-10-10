// A popover sheet on the plate. One is open at a time (store/faceplate/view.js): its trigger toggles it, Escape and a
// click outside close it. The panel and its trigger both carry `data-pop`, which is how a click is known to be inside.
// A caller that parks its panel against the trigger passes `park`, which runs each time the panel opens.

import { useLayoutEffect, useRef } from "preact/hooks";
import { html } from "../../lib/dom.js";
import { ON_PLATE, clampToPlate } from "../../model/shell/place.js";
import { openPopover, togglePopover, plate } from "../../store/faceplate/view.js";

/** @typedef {import("../../model/shell/place.js").Side} Side */
/** @typedef {import("../../model/shell/place.js").Margin} Margin */
/** @typedef {import("../../model/shell/place.js").Place} Place */

/**
 * Where a panel parks under an engine-row readout: 8 px below it, its right edge kept off the plate's edge by the
 * plate's own side padding.
 *
 * @type {{ side: Side, foot: null, at: Place }}
 */
export const UNDER_ENGINE_READOUT = { side: [null, 22], foot: null, at: { x: "start", y: "below", gap: 8 } };

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
 * An element's top-left corner on the plate, in layout px from the plate's padding corner, inside its border: the
 * corner a box positioned against the plate counts its `left` and `top` from.
 *
 * @param {Element} el
 * @param {Element} face  the plate
 * @returns {import("../../model/shell/place.js").Origin}
 */
export function onFace(el, face) {
  const r = el.getBoundingClientRect(),
    p = face.getBoundingClientRect();
  const s = plate.value.scale;
  return { x: (r.left - p.left) / s - face.clientLeft, y: (r.top - p.top) / s - face.clientTop };
}

/**
 * The corner of the box a panel's `left` and `top` count from, on the plate in layout px: its offset parent's padding
 * corner, inside that box's border, or the plate's own where it has none to measure.
 *
 * @param {HTMLElement} panel
 * @param {Element} face  the plate
 * @returns {import("../../model/shell/place.js").Origin}
 */
export function originOf(panel, face) {
  const box = panel.offsetParent;
  if (!box) return ON_PLATE;
  const o = onFace(box, face);
  return { x: o.x + box.clientLeft, y: o.y + box.clientTop };
}

/**
 * Where a panel lands against the element that opens it, clamped inside the plate's padding box (the room inside its
 * border, where its side padding counts from), in layout px from the panel's own containing block.
 *
 * @param {HTMLElement} panel
 * @param {Element} home  the element the panel parks against
 * @param {{ side: Side, foot: Margin, at: Place }} how
 * @returns {{ left: number, top: number } | null}  null when the panel has no plate to measure against
 */
export function parkAgainst(panel, home, how) {
  const face = panel.closest(".plate");
  if (!face) return null;
  const s = plate.value.scale;
  const r = home.getBoundingClientRect();
  const o = onFace(home, face);
  return clampToPlate({
    anchor: { left: o.x * s, top: o.y * s, width: r.width, height: r.height },
    panel: { w: panel.offsetWidth, h: panel.offsetHeight },
    plate: { w: face.clientWidth, h: face.clientHeight },
    scale: s,
    origin: originOf(panel, face),
    ...how,
  });
}

/**
 * Where a panel lands against its trigger, clamped inside the plate, in layout px from its own containing block.
 *
 * @param {HTMLElement} panel
 * @param {{ side: Side, foot: Margin, at: Place }} how
 * @returns {{ left: number, top: number } | null}  null when the panel has no trigger or plate to measure against
 */
export function parkAt(panel, how) {
  const trigger = panel.closest(".plate")?.querySelector(`button[data-pop="${panel.dataset.pop}"]`);
  return trigger ? parkAgainst(panel, trigger, how) : null;
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
