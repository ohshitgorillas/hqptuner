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
const dragging = signal(/** @type {string | null} */ (null));

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

// Which movable block the pointer is over, by midpoint: the insertion index is
// the first block whose middle is below the pointer, and past the last midpoint
// it is the end of the list.
/**
 * @param {Element[]} blocks
 * @param {number} y
 * @returns {number}
 */
function indexAt(blocks, y) {
  const found = blocks.findIndex((b) => {
    const box = b.getBoundingClientRect();
    return y < box.top + box.height / 2;
  });
  return found < 0 ? blocks.length - 1 : found;
}

/**
 * @param {Element} container
 * @returns {Element[]}
 */
const movableBlocks = (container) => [...container.querySelectorAll(":scope > .live-block[data-block]")];

/**
 * @param {Element} container
 * @param {string} key
 * @param {number} y
 * @returns {void}
 */
function moveTo(container, key, y) {
  const order = /** @type {string[]} */ (liveOrder.value);
  const from = order.indexOf(key);
  const to = indexAt(movableBlocks(container), y);
  if (from < 0 || to === from) return;
  const next = order.filter((k) => k !== key);
  next.splice(to, 0, key);
  setLiveOrder(next);
}

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
  if (!key) return;
  dragging.value = key;
  const move = (/** @type {PointerEvent} */ ev) => moveTo(container, key, ev.clientY);
  const up = () => {
    dragging.value = null;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/**
 * The LIVE page's blocks: the locked one first, then the movable ones in the
 * user's order.
 *
 * @param {{ locked: unknown, blocks: Record<string, unknown> }} props
 */
export function LiveBlocks({ locked, blocks }) {
  const editing = liveEditing.value;
  const held = dragging.value;
  return html`
    <div class="live-blocks" onPointerDown=${editing ? startDrag : undefined}>
      <div class="live-block">${locked}</div>
      ${
        /** @type {string[]} */ (liveOrder.value).map(
          (key) => html`
          <div
            class=${["live-block", editing ? "editing" : null, held === key ? "dragging" : null].filter(Boolean).join(" ")}
            data-block=${key}
            inert=${editing || undefined}
          >
            ${blocks[key]}
          </div>
        `,
        )
      }
    </div>
  `;
}
