// Custom dropdown for description-carrying enums: a native <select> cannot
// show a per-option tip. Presentational like the rest of controls/ — no store
// knowledge, value/options in, onChange(value) out on commit only. Optional
// fav(o)/onFav(o) pair adds a per-row favorite star (filter dropdowns); star
// clicks toggle only, never commit.
import { useRef, useState, useEffect, useLayoutEffect } from "preact/hooks";
import { html } from "../../lib/dom.js";

/**
 * @typedef {SchemaOption & { disabled?: boolean, reason?: string }} RenderOption
 *   One row as it reaches this widget. Wider than either shared type: Field.js
 *   forwards a schema literal's SchemaOption list unchanged when the entry
 *   carries `options`, and an OptionItem from the option stores when it carries
 *   `optionsFrom` — so disabled/reason are present on one path only.
 * @typedef {{ current: HTMLElement | null }} ElRef
 *   A preact ref pointed at one of this widget's own elements.
 * @typedef {{ open: boolean, hl: number, selIdx: number, id: string,
 *   fav?: (o: RenderOption) => boolean, onFav?: (o: RenderOption) => void,
 *   byKey: { current: boolean }, setHl: (i: number) => void,
 *   commit: (o: RenderOption) => void }} RowCtx
 *   The shared context every option row draws from — see OptionRow.
 */

/**
 * @param {string | number | undefined} v
 * @returns {string}
 */
const s = (v) => (v == null ? "" : String(v));
let uid = 0;

// Fixed-position placement, all coordinates from getBoundingClientRect. Flip
// above the button only when below can't fit the natural height AND above is
// roomier; cap to the chosen side minus an 8px viewport margin.
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

// Tip sits beside the highlighted row: right of the pop, or left when the
// right edge would leave the viewport; bottom clamped inside the viewport.
/**
 * @param {HTMLElement} t the tip
 * @param {HTMLElement} p the pop
 * @param {Element} row the highlighted row
 */
function placeTip(t, p, row) {
  const pr = p.getBoundingClientRect();
  const tr = t.getBoundingClientRect();
  const tl = pr.right + 8 + tr.width > window.innerWidth - 8 ? pr.left - tr.width - 8 : pr.right + 8;
  t.style.left = `${tl}px`;
  t.style.top = `${Math.min(row.getBoundingClientRect().top, window.innerHeight - 8 - tr.height)}px`;
  t.style.visibility = "visible";
}

// The pop is hidden-not-unmounted: SSR and tests render the closed state, and
// effects never run there, so nothing in render may touch window/document.
// Its empty title shadows the field wrapper's hover tooltip, which would
// otherwise pop over the open list.
// Positioning is fixed + getBoundingClientRect in effects — ancestor-independent
// (no transform/containing-block surprises) and identical across engines.
// Keyboard contract for the button: closed arrows open the list rather than
// stepping the value — stepping would write to the engine for a keystroke the
// user meant as browsing. Open, the arrows move the highlight, Enter commits it,
// Escape closes, Tab closes and lets focus move on.
/**
 * @param {{ open: boolean, setOpen: (v: boolean) => void, opts: RenderOption[], hl: number,
 *   setHl: (i: number) => void, byKey: { current: boolean }, show: () => void,
 *   commit: (o: RenderOption) => void }} ctx
 * @returns {(e: KeyboardEvent) => void}
 */
function comboKeyHandler({ open, setOpen, opts, hl, setHl, byKey, show, commit }) {
  return (e) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", " ", "Enter"].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    /** @param {number} i */
    const move = (i) => {
      e.preventDefault();
      byKey.current = true;
      setHl(Math.max(0, Math.min(opts.length - 1, i)));
    };
    if (e.key === "ArrowDown") move(hl + 1);
    else if (e.key === "ArrowUp") move(hl - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(opts.length - 1);
    else if (e.key === "Enter") {
      e.preventDefault();
      commit(opts[hl]); // disabled row: no commit, stays open with tip showing
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Tab") setOpen(false);
  };
}

// Close on outside pointerdown (not blur — a click in the pop must survive), on
// any scroll outside the pop, and on resize. Listeners exist only while open;
// scroll is capture-phase since scroll events don't bubble.
/**
 * @param {{ open: boolean, setOpen: (v: boolean) => void, btnRef: ElRef, popRef: ElRef }} ctx
 */
function useDismissOnOutside({ open, setOpen, btnRef, popRef }) {
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

// Placement work, split by what it depends on. The pop is measured and placed on
// OPEN only: re-running placement on highlight changes destroys the user's
// scroll position, since the maxHeight reset for re-measurement clamps scrollTop
// and warps the list back to the selection on every hover. Per-highlight work
// reveals the row only for keyboard moves — a hovered row is already visible —
// and places the tip. Layout effects, so both land before the frame paints; they
// do not run under SSR.
/**
 * @param {{ open: boolean, hl: number, tipText: string, byKey: { current: boolean },
 *   btnRef: ElRef, popRef: ElRef, tipRef: ElRef }} ctx
 */
function usePopPlacement({ open, hl, tipText, byKey, btnRef, popRef, tipRef }) {
  useLayoutEffect(() => {
    if (!open) return;
    if (btnRef.current && popRef.current) placePop(btnRef.current, popRef.current);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const p = popRef.current;
    const row = p && p.children[hl];
    if (!row) return;
    if (byKey.current) revealRow(p, row);
    if (tipRef.current) placeTip(tipRef.current, p, row);
  }, [open, hl, tipText]);
}

// One option in the pop. `row` is the shared context the whole list draws from:
// which index is highlighted and which is selected, the id prefix the button's
// aria-activedescendant points at, the favorite wiring, and the two writers.
/**
 * @param {{ o: RenderOption, i: number, row: RowCtx }} props
 */
function OptionRow({ o, i, row }) {
  const { open, hl, selIdx, id, fav, onFav, byKey, setHl, commit } = row;
  return html`
    <div
      class=${open && i === hl ? "dd-opt hl" : "dd-opt"}
      role="option"
      id=${`${id}-${i}`}
      aria-selected=${i === selIdx}
      aria-disabled=${o.disabled ? "true" : undefined}
      onPointerEnter=${() => {
        byKey.current = false;
        setHl(i);
      }}
      onClick=${() => commit(o)}
    >
      ${o.label}${o.disabled && o.reason ? ` — ${o.reason}` : ""}
      ${
        fav
          ? html`<button
              type="button"
              class=${fav(o) ? "dd-fav on" : "dd-fav"}
              aria-pressed=${!!fav(o)}
              aria-label=${`${fav(o) ? "Unfavorite" : "Favorite"} ${o.label}`}
              onClick=${(/** @type {Event} */ e) => {
                // never reaches the row's own click — a star toggle must not
                // commit the option or close the pop
                if (e && e.stopPropagation) e.stopPropagation();
                onFav?.(o); // the star only renders with `fav`, and callers pass the pair
              }}
            >
              ${fav(o) ? "★" : "☆"}
            </button>`
          : null
      }
    </div>
  `;
}

/**
 * @param {{ value: string | number | undefined, options: RenderOption[] | undefined,
 *   tips?: (o: RenderOption) => string, fav?: (o: RenderOption) => boolean,
 *   onFav?: (o: RenderOption) => void, disabled?: boolean,
 *   onChange: (v: string | number) => void }} props
 */
export function Combobox({ value, options, tips, fav, onFav, disabled, onChange }) {
  const opts = options || [];
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const id = useRef(`cbx-${++uid}`).current;
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const tipRef = useRef(null);
  // Whether the CURRENT highlight came from the keyboard. Only keyboard moves
  // may scroll the pop — a hovered row is visible by definition, and scrolling
  // on hover warps the list out from under the user's wheel.
  const byKey = useRef(false);

  const selIdx = opts.findIndex((o) => s(o.value) === s(value));
  const tipText = (open && tips && opts[hl] && tips(opts[hl])) || "";

  const show = () => {
    byKey.current = true; // opening reveals the selection, same as a key move
    setHl(selIdx >= 0 ? selIdx : 0);
    setOpen(true);
  };
  /** @param {RenderOption} o */
  const commit = (o) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
  };
  const onKey = comboKeyHandler({ open, setOpen, opts, hl, setHl, byKey, show, commit });
  useDismissOnOutside({ open, setOpen, btnRef, popRef });

  usePopPlacement({ open, hl, tipText, byKey, btnRef, popRef, tipRef });

  const label = selIdx >= 0 ? opts[selIdx].label : s(value);
  const row = { open, hl, selIdx, id, fav, onFav, byKey, setHl, commit };
  return html`
    <button
      type="button"
      class="dd-box"
      role="combobox"
      aria-expanded=${open}
      aria-haspopup="listbox"
      aria-activedescendant=${open ? `${id}-${hl}` : undefined}
      disabled=${disabled}
      ref=${btnRef}
      onClick=${() => (open ? setOpen(false) : show())}
      onKeyDown=${onKey}
    >
      ${label}
    </button>
    <div class="dd-pop" role="listbox" hidden=${!open} ref=${popRef} title="">
      ${opts.map((o, i) => html`<${OptionRow} o=${o} i=${i} row=${row} />`)}
    </div>
    ${
      tipText
        ? html`<div class="dd-tip" ref=${tipRef} style="position:fixed;max-width:340px;visibility:hidden">
          ${tipText}
        </div>`
        : null
    }
  `;
}
