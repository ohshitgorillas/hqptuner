// Custom dropdown for description-carrying enums: a native <select> cannot
// show a per-option tip. Presentational like the rest of controls/ — no store
// knowledge, value/options in, onChange(value) out on commit only.
import { useRef, useState, useEffect, useLayoutEffect } from "preact/hooks";
import { html } from "../../lib/dom.js";

const s = (v) => (v == null ? "" : String(v));
let uid = 0;

// Fixed-position placement, all coordinates from getBoundingClientRect. Flip
// above the button only when below can't fit the natural height AND above is
// roomier; cap to the chosen side minus an 8px viewport margin.
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
export function Combobox({ value, options, tips, disabled, onChange }) {
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
  const commit = (o) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
  };
  const onKey = (e) => {
    if (!open) {
      // Closed arrows open, never step the value — stepping would write to the
      // engine for a keystroke the user meant as browsing.
      if (["ArrowDown", "ArrowUp", " ", "Enter"].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
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
    } else if (e.key === "Tab") setOpen(false); // let focus move on
  };

  // Close on outside pointerdown (not blur — a click in the pop must survive),
  // on any scroll outside the pop, and on resize. Listeners exist only while
  // open; scroll is capture-phase since scroll events don't bubble.
  useEffect(() => {
    if (!open) return undefined;
    const inside = (t) =>
      (btnRef.current && btnRef.current.contains(t)) || (popRef.current && popRef.current.contains(t));
    const down = (e) => !inside(e.target) && setOpen(false);
    const scroll = (e) => !(popRef.current && popRef.current.contains(e.target)) && setOpen(false);
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

  // Measure and place the pop on OPEN only — layout effect, so it is
  // positioned before the frame paints. Re-running placement on highlight
  // changes destroyed the user's scroll position: the maxHeight reset for
  // re-measurement clamps scrollTop, warping the list back to the selection
  // on every hover. Runs only in the browser (effects don't run under SSR).
  useLayoutEffect(() => {
    if (!open) return;
    if (btnRef.current && popRef.current) placePop(btnRef.current, popRef.current);
  }, [open]);

  // Per-highlight work: reveal the row only for keyboard moves (a hovered row
  // is already visible; scrolling on hover fights the wheel), and place the tip.
  useLayoutEffect(() => {
    if (!open) return;
    const p = popRef.current;
    const row = p && p.children[hl];
    if (!row) return;
    if (byKey.current) revealRow(p, row);
    if (tipRef.current) placeTip(tipRef.current, p, row);
  }, [open, hl, tipText]);

  const label = selIdx >= 0 ? opts[selIdx].label : s(value);
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
      ${opts.map(
        (o, i) => html`
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
          </div>
        `,
      )}
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
