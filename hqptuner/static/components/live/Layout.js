// The LIVE page's block order and the edit mode that changes it.
//
// The page is six stacked blocks. LIVE MODE is locked at the top; the other
// five are the user's to arrange, and the arrangement is a stored preference
// (store/prefs.js liveOrder) rather than page state, so it survives a reload
// the way every other LIVE preference does.
//
// Reordering happens in an explicit edit mode rather than behind always-visible
// grips. Two of the five blocks hold more than one card, so a grip in a card
// head would be ambiguous about what moves; and a collapsible card's head IS a
// button (components/common.js), so a grip inside one would be nested
// interactive content. In edit mode the whole block is the drag target instead,
// which needs no grip and no reserved gutter.
//
// The blocks are `inert` while editing, which is what makes that work: an inert
// subtree is not a hit-testing target, so a pointer landing anywhere on a block
// reaches this container instead of the control under it. Nothing is dragged by
// accident and nothing is switched by accident either. The block under the
// pointer is therefore resolved from geometry, not from the event target.
//
// Pointer events rather than HTML5 drag-and-drop: DnD's drag image cannot be
// styled and its event model fights preact's re-render.
import { signal, effect } from "@preact/signals";
import { html } from "../../lib/dom.js";
import { liveMode, liveOrder, setLiveOrder, commitLiveOrder } from "../../store/prefs.js";

/** Whether the LIVE page is in layout-edit mode. Ephemeral: a reload lands out of it. */
export const liveEditing = signal(false);

/** The block being dragged right now, null when none is. */
export const dragKey = signal(/** @type {string | null} */ (null));

/** Where the dragged block would land, null when no drag is in progress. */
export const dropAt = signal(/** @type {number | null} */ (null));

/**
 * Enter or leave layout-edit mode. Leaving writes the order, which is the one
 * moment it is persisted — a write per drop would put a half-finished
 * arrangement in storage on every pass of the pointer.
 *
 * @param {boolean} on
 * @returns {void}
 */
export function setLiveEditing(on) {
  const next = !!on;
  if (liveEditing.value && !next) commitLiveOrder();
  liveEditing.value = next;
}

// Leaving the LIVE page mid-edit commits too, else an arrangement made and then
// navigated away from dies with the page — the toggle is not the only way out.
effect(() => {
  if (!liveMode.value && liveEditing.peek()) setLiveEditing(false);
});

// Where a block dropped at `y` lands: how many of the OTHER blocks' midpoints
// sit above it. The midpoints are measured ONCE, when the drag starts, and the
// page does not move until the drop — measure them live instead and each answer
// is read off a layout the previous answer just rearranged, so two blocks of
// different heights swap back and forth under a hand that is holding still.
/**
 * Where a block dropped at `y` lands.
 *
 * @param {number[]} midpoints midpoint of every block except the dragged one, top to bottom
 * @param {number} y
 * @returns {number}
 */
export function dropIndex(midpoints, y) {
  return midpoints.filter((m) => m < y).length;
}

/**
 * `order` with `key` lifted out and put back at `index`, counted against the
 * list `key` has already been removed from — the same list `dropIndex` counts.
 *
 * @param {string[]} order
 * @param {string} key
 * @param {number} index
 * @returns {string[]}
 */
export function reorder(order, key, index) {
  if (!order.includes(key)) return [...order];
  const rest = order.filter((k) => k !== key);
  rest.splice(index, 0, key);
  return rest;
}

/**
 * Start a drag of `key` at `index`, or move a running one to a new target.
 *
 * @param {string} key
 * @param {number} index
 * @returns {void}
 */
export function setDrag(key, index) {
  dragKey.value = key;
  dropAt.value = index;
}

/**
 * End the drag, landing the block on its target. The order changes here and
 * nowhere else in the gesture, which is what makes a drop predictable: what the
 * indicator was pointing at when the pointer came up is what happens.
 *
 * @returns {void}
 */
export function endDrag() {
  const key = dragKey.value;
  const at = dropAt.value;
  if (key !== null && at !== null) setLiveOrder(reorder(/** @type {string[]} */ (liveOrder.value), key, at));
  dragKey.value = null;
  dropAt.value = null;
}

/**
 * @param {Element} container
 * @returns {Element[]}
 */
const movableBlocks = (container) => [...container.querySelectorAll(":scope > .live-block[data-block]")];

// Document coordinates, not viewport ones: a drag long enough to scroll the
// page would otherwise be comparing frozen viewport midpoints against a pointer
// the page has moved underneath.
/**
 * @param {Element} el
 * @returns {number}
 */
function midpointOf(el) {
  const box = el.getBoundingClientRect();
  return box.top + box.height / 2 + window.scrollY;
}

/** The other blocks' midpoints, frozen at the moment the drag started. */
let frozen = /** @type {number[]} */ ([]);

/**
 * @param {PointerEvent} e
 * @returns {void}
 */
function startDrag(e) {
  const container = /** @type {Element} */ (e.currentTarget);
  const blocks = movableBlocks(container);
  const hit = blocks.find((b) => {
    const box = b.getBoundingClientRect();
    return e.clientY >= box.top && e.clientY <= box.bottom;
  });
  // class-exempt: data-block is the block's identity attribute, not styling.
  const key = hit && hit.getAttribute("data-block");
  if (!hit || !key) return;
  frozen = blocks.filter((b) => b !== hit).map(midpointOf);
  setDrag(key, dropIndex(frozen, e.pageY));
  const move = (/** @type {PointerEvent} */ ev) => setDrag(key, dropIndex(frozen, ev.pageY));
  const up = () => {
    endDrag();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/**
 * The LIVE page's blocks: the locked one first, then the movable ones in the
 * user's order. During a drag the stack holds still and a line marks where the
 * block would land.
 *
 * @param {{ locked: unknown, blocks: Record<string, unknown> }} props
 */
export function LiveBlocks({ locked, blocks }) {
  const editing = liveEditing.value;
  const held = dragKey.value;
  const at = dropAt.value;
  const order = /** @type {string[]} */ (liveOrder.value);
  // The line sits before the block that currently holds the target slot, or
  // after the last one when the target is the end of the list.
  const rest = held === null ? order : order.filter((k) => k !== held);
  const before = at === null ? null : (rest[at] ?? null);
  const line = html`<div class="live-drop-line"></div>`;
  return html`
    <div class="live-blocks" onPointerDown=${editing ? startDrag : undefined}>
      <div class="live-block">${locked}</div>
      ${order.map(
        (key) => html`
          ${before === key ? line : null}
          <div
            class=${["live-block", editing ? "editing" : null, held === key ? "dragging" : null]
              .filter(Boolean)
              .join(" ")}
            data-block=${key}
            inert=${editing || undefined}
          >
            ${blocks[key]}
          </div>
        `,
      )}
      ${at !== null && before === null ? line : null}
    </div>
  `;
}
