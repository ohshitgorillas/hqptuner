// Custom dropdown for description-carrying enums: a native <select> cannot
// show a per-option tip. Presentational like the rest of controls/ — no store
// knowledge, value/options in, onChange(value) out on commit only. Optional
// fav(o)/onFav(o) pair adds a per-row favorite star (filter dropdowns); star
// clicks toggle only, never commit. Optional badge(o) marks each apodizing
// row beside its own name — rows only, never a group header; optional collapse
// wiring folds the grouped (Simplified) family and variant containers, with
// the state owned by the caller so it can persist.
import { useRef, useState } from "preact/hooks";
import { html } from "../../lib/dom.js";
import { useDismissOnOutside, usePopPlacement } from "./combopop.js";
import { buildRows, rowOption, nestRows, visibleOption } from "./comborows.js";

/**
 * @typedef {import("./comborows.js").RenderOption} RenderOption
 * @typedef {import("./comborows.js").ListRow} ListRow
 * @typedef {import("./comborows.js").Slot} Slot
 * @typedef {import("./comborows.js").VGroup} VGroup
 * @typedef {import("./comborows.js").ApodClass} ApodClass
 * @typedef {import("./comborows.js").CollapseCtl} CollapseCtl
 *   The row model — flat list, nested containers, visibility under a fold —
 *   lives in comborows.js; this module owns the markup, focus and placement
 *   behaviour around it.
 * @typedef {{ current: HTMLElement | null }} ElRef
 *   A preact ref pointed at one of this widget's own elements.
 * @typedef {{ name: string, text: string, rows: [string, string][], chips: string[] }} TipContent
 *   One option's hover tip: the raw engine name (non-empty only when Simplified
 *   display has replaced it in the row), the manual prose, plus label/value
 *   facet rows and boolean facet chips (both empty outside the filter
 *   dropdowns).
 * @typedef {{ open: boolean, hl: number, selIdx: number, id: string,
 *   fav?: (o: RenderOption) => boolean, onFav?: (o: RenderOption) => void,
 *   badge?: (o: RenderOption) => ApodClass, collapse?: CollapseCtl,
 *   toggle: (key: string) => void,
 *   byKey: { current: boolean }, setHl: (i: number) => void,
 *   commit: (o: RenderOption) => void }} RowCtx
 *   The shared context every option row draws from — see OptionRow. `hl` and
 *   `selIdx` are indexes into the pop's row list (headers included), not into
 *   the options array. `toggle` wraps collapse.onToggle so a fold that hides
 *   the highlighted row can also move the highlight somewhere visible.
 */

/**
 * @param {string | number | undefined} v
 * @returns {string}
 */
const s = (v) => (v == null ? "" : String(v));
let uid = 0;

// An option row's visible text: the plain-names display when the option
// carries one, else the raw label; a disabled row appends its reason.
/**
 * @param {RenderOption} o
 * @returns {string}
 */
const rowText = (o) => `${o.display || o.label}${o.disabled && o.reason ? ` — ${o.reason}` : ""}`;

const APOD_LABEL = { full: "Apodizing", half: "Half apodizing" };
// The glyphs as baked outlines, not font text: where the glyph was a <text>
// node its position depended on which font the viewer's browser resolved, its
// weight (a selected row is semibold) and the engine's dominant-baseline
// mapping — different in every environment, so no anchor held everywhere.
// Outlines are Inter 400's own "A" and "onehalf" (fonts/inter-400.woff2,
// extracted with fontTools at an 11-unit em), each ink bounding box centered
// on the circle at (10,10) in viewBox units.
const APOD_PATH = {
  full:
    "M6.48 14.00 9.39 6.00H10.57L13.52 14.00H12.44L10.74 9.25Q10.59 8.81 10.38 8.16Q10.17 7.50 9.88 " +
    "6.48H10.07Q9.78 7.51 9.57 8.18Q9.36 8.85 9.22 9.25L7.57 14.00ZM7.95 11.77V10.88H12.05V11.77Z",
  half:
    "M7.75 6.00V10.36H6.89V6.73H6.84L5.80 7.53V6.67L6.68 6.00ZM6.41 14.00 11.91 6.00H12.82L7.32 " +
    "14.00ZM11.24 14.00V13.42L12.70 11.84Q12.99 11.53 13.15 11.30Q13.31 11.07 13.31 10.83Q13.31 " +
    "10.57 13.10 10.44Q12.90 10.30 12.65 10.30Q12.38 10.30 12.21 10.44Q12.04 10.59 12.04 " +
    "10.85H11.21Q11.21 10.26 11.63 9.93Q12.06 9.59 12.68 9.59Q13.33 9.59 13.74 9.95Q14.14 10.30 " +
    "14.14 10.80Q14.14 11.00 14.05 11.22Q13.97 11.43 13.72 11.76Q13.48 12.08 13.02 12.59L12.45 " +
    "13.22V13.28H14.20V14.00Z",
};

// The circled apodizing mark beside an option row's name. Inert: it is part
// of the name it sits beside, not a control, so it never commits, never
// toggles, and reads out through its label alone. Circle and glyph are one
// SVG sharing one coordinate system, and both are pure geometry, so they
// rasterize together whatever the page's fonts do.
/**
 * @param {{ kind: ApodClass | undefined }} props
 */
function Apod({ kind }) {
  if (!kind) return null;
  return html`<span class="dd-apod" role="img" aria-label=${APOD_LABEL[kind]}>
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="9.3" />
      <path d=${APOD_PATH[kind]} />
    </svg>
  </span>`;
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

// One option in the pop. `row` is the shared context the whole list draws from:
// which index is highlighted and which is selected, the id prefix the button's
// aria-activedescendant points at, the favorite wiring, and the two writers.
// `apod` is the row's own badge, null for a row that is not apodizing.
/**
 * @param {{ o: RenderOption, i: number, apod: ApodClass, row: RowCtx }} props
 */
function OptionRow({ o, i, apod, row }) {
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
      ${rowText(o)}
      <${Apod} kind=${apod} />
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

// A family or variant header: a plain presentation row without collapse
// wiring, a disclosure toggle with it. The toggle is a real button so it takes
// activation without inventing key handling — the pop's focus model stays on
// the trigger, same arrangement as the favorite star. Headers never carry an
// apodizing badge — the mark belongs to the rows alone.
/**
 * @param {{ cls: string, text: string, ckey: string, row: RowCtx }} props
 */
function GroupHead({ cls, text, ckey, row }) {
  const { collapse, toggle } = row;
  if (!collapse) {
    return html`<div class=${cls} role="presentation">${text}</div>`;
  }
  const folded = collapse.collapsed(ckey);
  // The disclosure caret is CSS (::before off aria-expanded), so the header's
  // children stay its text in both header forms.
  return html`<button type="button" class=${cls} aria-expanded=${!folded} onClick=${() => toggle(ckey)}>
    ${text}
  </button>`;
}

// One node of the nested pop body: an option row, or a variant container —
// subheader plus its rows, folded down to the subheader alone when collapsed.
/**
 * @param {Slot | VGroup} k
 * @param {RowCtx} row
 * @returns {ReturnType<typeof html>}
 */
function renderKid(k, row) {
  if (!("items" in k)) {
    const apod = row.badge ? row.badge(k.r.o) : null;
    return html`<${OptionRow} o=${k.r.o} i=${k.i} apod=${apod} row=${row} />`;
  }
  const folded = row.collapse ? row.collapse.collapsed(k.key) : false;
  return html`<div class="dd-vgrp">
    <${GroupHead} cls="dd-hdr dd-subhdr" text=${k.head} ckey=${k.key} row=${row} />
    ${!folded && k.blurb ? html`<div class="dd-blurb t-caption" role="presentation">${k.blurb}</div>` : null}
    ${folded ? null : k.items.map((it) => renderKid(it, row))}
  </div>`;
}

// The pop's body: family containers holding their headers, bare rows and
// variant containers in Simplified mode; a flat option list otherwise. The
// family header appends the word "family" (uppercased by CSS, so it reads
// e.g. CLOSED FORM FAMILY). A collapsed family keeps only its header row.
/**
 * @param {ListRow[]} rows
 * @param {RowCtx} row
 * @returns {ReturnType<typeof html>[]}
 */
function renderRows(rows, row) {
  return nestRows(rows).map((n) => {
    if (!("kids" in n)) return renderKid(n, row);
    const folded = row.collapse ? row.collapse.collapsed(n.key) : false;
    return html`<div class="dd-grp">
      <${GroupHead} cls="dd-hdr t-head" text=${`${n.head} family`} ckey=${n.key} row=${row} />
      ${!folded && n.blurb ? html`<div class="dd-blurb t-caption" role="presentation">${n.blurb}</div>` : null}
      ${folded ? null : n.kids.map((k) => renderKid(k, row))}
    </div>`;
  });
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
            ${tip.rows.map(([k, v]) => html`<span class="dd-tip-key">${k}</span><span class="dd-tip-val">${v}</span>`)}
          </div>`
          : null
      }
      ${
        tip.chips.length
          ? html`<div class="dd-tip-chips">${tip.chips.map((c) => html`<span class="dd-tip-chip">${c}</span>`)}</div>`
          : null
      }
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
 *   collapse?: CollapseCtl, disabled?: boolean,
 *   onChange: (v: string | number) => void }} props
 */
export function Combobox({ value, options, valueLabel, tips, fav, onFav, badge, collapse, disabled, onChange }) {
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
  const onKey = comboKeyHandler({ open, setOpen, rows, hl, visible, setHl, byKey, show, commit });
  useDismissOnOutside({ open, setOpen, btnRef, popRef });

  usePopPlacement({ open, hl, id, tipKey, byKey, btnRef, popRef, tipRef });

  // A narrowed dropdown can drop the current selection off its own list
  // (store/narrow/state.js); the closed control still has to name that selection,
  // so the caller passes the label the option list no longer carries.
  const sel = rowOption(rows[selIdx]);
  const label = sel ? sel.closedLabel || sel.label : valueLabel || s(value);
  const row = { open, hl, selIdx, id, fav, onFav, badge, collapse, toggle, byKey, setHl, commit };
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
    </div>
    ${tip ? html`<${TipPop} tip=${tip} tipRef=${tipRef} />` : null}
  `;
}
