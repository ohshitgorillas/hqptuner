// Custom dropdown for description-carrying enums: a native <select> cannot
// show a per-option tip. Presentational like the rest of controls/ — no store
// knowledge, value/options in, onChange(value) out on commit only. Optional
// fav(o)/onFav(o) pair adds a per-row favorite star (filter dropdowns); star
// clicks toggle only, never commit. Optional badge(o) marks each apodizing
// row beside its own name — rows only, never a group header; optional tier(o)
// puts a rate-floor badge there the same way (modulator rows); optional collapse
// wiring folds the grouped (Simplified) family and variant containers, with
// the state owned by the caller so it can persist.
import { useRef, useState } from "preact/hooks";
import { html } from "../../lib/dom.js";
import { useDismissOnOutside, usePopPlacement } from "./combopop.js";
import { renderRows, s } from "./comborow.js";
import { buildRows, rowOption, visibleOption } from "./comborows.js";

/**
 * @typedef {import("./comborows.js").RenderOption} RenderOption
 * @typedef {import("./comborows.js").ListRow} ListRow
 * @typedef {import("./comborows.js").ApodClass} ApodClass
 * @typedef {import("./comborows.js").CollapseCtl} CollapseCtl
 *   The row model — flat list, nested containers, visibility under a fold —
 *   lives in comborows.js; this module owns the markup, focus and placement
 *   behavior around it.
 * @typedef {{ current: HTMLElement | null }} ElRef
 *   A preact ref pointed at one of this widget's own elements.
 * @typedef {object} TipContent
 *   One option's hover tip: the raw engine name (non-empty only when Simplified
 *   display has replaced it in the row), the manual prose, plus facet rows and
 *   boolean facet chips (both empty outside the filter dropdowns). Every row and
 *   chip leads with a code, so the tip can be read by facet rather than by the
 *   words in it.
 * @property {string} name
 * @property {string} text
 * @property {import("../narrowbar/facettip.js").FacetRow[]} rows
 * @property {[string, string][]} chips
 * @typedef {import("./comborow.js").RowCtx} RowCtx
 */

let uid = 0;

// The three writers the pop shares between its rows, its headers and the key
// handler: open the list on a row the user can see, commit an option, fold a
// group without stranding the highlight underneath it.
/**
 * @param {{ rows: ListRow[], selIdx: number, visible: (row: ListRow | undefined) => boolean,
 *   hl: number, setHl: (i: number) => void, setOpen: (v: boolean) => void,
 *   byKey: { current: boolean }, collapse: CollapseCtl | undefined,
 *   onChange: (v: string | number) => void }} ctx
 */
function popActions({ rows, selIdx, visible, hl, setHl, setOpen, byKey, collapse, onChange }) {
  const show = () => {
    byKey.current = true; // opening reveals the selection, same as a key move
    const first = rows.findIndex(visible);
    // A selection folded under a collapsed group stays folded — the user chose
    // the fold — so the highlight opens on the first row still visible.
    setHl(selIdx >= 0 && visible(rows[selIdx]) ? selIdx : Math.max(0, first));
    setOpen(true);
  };
  /** @param {RenderOption | undefined} o */
  const commit = (o) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
  };
  // Folding the group that holds the highlighted row would strand the
  // highlight on an unmounted node; the caller's state updates synchronously,
  // so re-checking right after the toggle sees the new fold.
  /** @param {string} key */
  const toggle = (key) => {
    collapse?.onToggle(key);
    if (!visible(rows[hl])) {
      const first = rows.findIndex(visible);
      if (first >= 0) setHl(first);
    }
  };
  return { show, commit, toggle };
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
 * @param {{ open: boolean, setOpen: (v: boolean) => void, rows: ListRow[], hl: number,
 *   visible: (row: ListRow | undefined) => boolean,
 *   setHl: (i: number) => void, byKey: { current: boolean }, show: () => void,
 *   commit: (o: RenderOption | undefined) => void }} ctx
 * @returns {(e: KeyboardEvent) => void}
 */
function comboKeyHandler({ open, setOpen, rows, hl, visible, setHl, byKey, show, commit }) {
  // Arrow moves land on visible option rows only: from `from`, the nearest one
  // in `dir`, or `from` itself when none is left in that direction. Rows folded
  // under a collapsed group are skipped the same way headers are.
  /**
   * @param {number} from
   * @param {number} dir
   * @returns {number}
   */
  const nextOption = (from, dir) => {
    for (let j = from + dir; j >= 0 && j < rows.length; j += dir) {
      if (visible(rows[j])) return j;
    }
    return from;
  };
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
      setHl(i);
    };
    if (e.key === "ArrowDown") move(nextOption(hl, 1));
    else if (e.key === "ArrowUp") move(nextOption(hl, -1));
    else if (e.key === "Home") move(nextOption(-1, 1));
    else if (e.key === "End") move(nextOption(rows.length, -1));
    else if (e.key === "Enter") {
      e.preventDefault();
      commit(rowOption(rows[hl])); // disabled row: no commit, stays open with tip showing
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Tab") setOpen(false);
  };
}

// The highlighted option's tip, or null when the pop is closed, the widget has
// no tip resolver, or the tip carries nothing to show.
/**
 * @param {boolean} open
 * @param {((o: RenderOption) => TipContent) | undefined} tips
 * @param {RenderOption | undefined} o
 * @returns {TipContent | null}
 */
function tipFor(open, tips, o) {
  if (!open || !tips || !o) return null;
  const t = tips(o);
  return t.name || t.text || t.rows.length || t.chips.length ? t : null;
}

// The tip beside the highlighted row: the manual prose, then the facet rows
// and chips where the option carries them. Positioned by placeTip after paint,
// so it renders hidden at a fixed origin.
// One boolean facet chip. Its own binding so the chips still render on a single
// line: a template broken across lines puts whitespace text nodes inside the row.
const chip = (/** @type {[string, string]} */ [code, c]) =>
  html`<span class="dd-tip-chip" data-chip=${code}>${c}</span>`;

/**
 * @param {{ tip: TipContent, tipRef: ElRef }} props
 */
function TipPop({ tip, tipRef }) {
  return html`
    <div class="dd-tip" ref=${tipRef} style="position:fixed;max-width:340px;visibility:hidden">
      ${tip.name ? html`<div class="dd-tip-name">${tip.name}</div>` : null}
      ${tip.text ? html`<div class="dd-tip-desc">${tip.text}</div>` : null}
      ${
        tip.rows.length
          ? html`<div class="dd-tip-rows">
            ${tip.rows.map(
              ([facet, k, v]) =>
                html`<span class="dd-tip-key" data-facet=${facet}>${k}</span><span class="dd-tip-val">${v}</span>`,
            )}
          </div>`
          : null
      }
      ${tip.chips.length ? html`<div class="dd-tip-chips">${tip.chips.map(chip)}</div>` : null}
    </div>
  `;
}

/**
 * Renders a dropdown as a button and an owned listbox popover, so each option
 * row can show its own tip from `tips` and, where `fav` is passed, a favorite
 * star; `badge` marks apodizing rows and `collapse` folds the grouped lists.
 * Reports a value on commit only.
 * @param {{ value: string | number | undefined, options: RenderOption[] | undefined,
 *   valueLabel?: string, tips?: (o: RenderOption) => TipContent, fav?: (o: RenderOption) => boolean,
 *   onFav?: (o: RenderOption) => void, badge?: (o: RenderOption) => ApodClass,
 *   stars?: (o: RenderOption) => number | null, tier?: (o: RenderOption) => string | null,
 *   collapse?: CollapseCtl, disabled?: boolean,
 *   onChange: (v: string | number) => void }} props
 */
export function Combobox(props) {
  const { value, options, valueLabel, tips, fav, onFav, badge, stars, tier, collapse, disabled, onChange } = props;
  const opts = options || [];
  const rows = buildRows(opts);
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

  // Row index of the selection — headers are rows too, so every index the
  // widget holds (hl, selIdx, the aria ids) is in the row domain.
  const selIdx = rows.findIndex((r) => "o" in r && s(r.o.value) === s(value));
  const hlOpt = rowOption(rows[hl]);
  const tip = tipFor(open, tips, hlOpt);
  // Placement keys on the highlighted option, not the tip object — `tips` builds
  // a fresh object every render, and an identity dep would re-place per render.
  const tipKey = tip && hlOpt ? s(hlOpt.value) : "";

  // Rows under a collapsed group are unmounted, so the highlight and the arrow
  // keys must never land on them.
  const visible = visibleOption(collapse);
  const { show, commit, toggle } = popActions({
    rows,
    selIdx,
    visible,
    hl,
    setHl,
    setOpen,
    byKey,
    collapse,
    onChange,
  });
  const onKey = comboKeyHandler({ open, setOpen, rows, hl, visible, setHl, byKey, show, commit });
  useDismissOnOutside({ open, setOpen, btnRef, popRef });

  usePopPlacement({ open, hl, id, tipKey, byKey, btnRef, popRef, tipRef });

  // A narrowed dropdown can drop the current selection off its own list
  // (store/narrow/state.js); the closed control still has to name that selection,
  // so the caller passes the label the option list no longer carries.
  const sel = rowOption(rows[selIdx]);
  const label = sel ? sel.closedLabel || sel.label : valueLabel || s(value);
  const row = { open, hl, selIdx, id, fav, onFav, badge, stars, tier, collapse, toggle, byKey, setHl, commit };
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
      ${renderRows(rows, row)}
      ${
        // The Recommended legend rides only where a check is on screen to
        // explain: `rec` exists only under Simplified decoration, so Standard
        // pops never grow the footer.
        rows.some((r) => "o" in r && r.o.rec)
          ? html`<div class="dd-legend t-caption" role="presentation"><span class="dd-legend-check">✓</span> = recommended</div>`
          : null
      }
    </div>
    ${tip ? html`<${TipPop} tip=${tip} tipRef=${tipRef} />` : null}
  `;
}
