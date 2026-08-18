// Custom dropdown for description-carrying enums: a native <select> cannot
// show a per-option tip. Presentational like the rest of controls/ — no store
// knowledge, value/options in, onChange(value) out on commit only. Optional
// fav(o)/onFav(o) pair adds a per-row favorite star (filter dropdowns); star
// clicks toggle only, never commit.
import { useRef, useState } from "preact/hooks";
import { html } from "../../lib/dom.js";
import { useDismissOnOutside, usePopPlacement } from "./combopop.js";

/**
 * @typedef {SchemaOption & { disabled?: boolean, reason?: string, display?: string,
 *   closedLabel?: string, group?: string, subgroup?: string | null,
 *   groupBlurb?: string, subgroupBlurb?: string }} RenderOption
 *   One row as it reaches this widget. Wider than either shared type: Field.js
 *   forwards a schema literal's SchemaOption list unchanged when the entry
 *   carries `options`, and an OptionItem from the option stores when it carries
 *   `optionsFrom` — so disabled/reason are present on one path only. The
 *   display/closedLabel/group/subgroup fields ride in from the plain-names
 *   decoration (store/plainnames.js) and are absent in Standard mode.
 * @typedef {{ o: RenderOption, oi: number } | { header: string, sub: boolean, blurb?: string }} ListRow
 *   One rendered row of the open pop: an option (with its index in `options`),
 *   or a family/variant header with its optional blurb caption. Headers are
 *   presentation only — never selectable, never committable, skipped by
 *   keyboard navigation.
 * @typedef {{ r: { o: RenderOption, oi: number }, i: number }} Slot
 *   One option row with its index in the flat row list — the index domain hl,
 *   selIdx and the aria ids live in, whatever the DOM nesting.
 * @typedef {{ head: string, blurb?: string, items: Slot[] }} VGroup
 *   A variant's subheader, its optional blurb caption and its option rows, one
 *   nested container.
 * @typedef {{ head: string, blurb?: string, kids: (Slot | VGroup)[] }} FGroup
 *   A family's header, its optional blurb caption, its bare option rows and
 *   its variant groups, one nested container.
 * @typedef {{ current: HTMLElement | null }} ElRef
 *   A preact ref pointed at one of this widget's own elements.
 * @typedef {{ name: string, text: string, rows: [string, string][], chips: string[] }} TipContent
 *   One option's hover tip: the raw engine name (non-empty only when Simplified
 *   display has replaced it in the row), the manual prose, plus label/value
 *   facet rows and boolean facet chips (both empty outside the filter
 *   dropdowns).
 * @typedef {{ open: boolean, hl: number, selIdx: number, id: string,
 *   fav?: (o: RenderOption) => boolean, onFav?: (o: RenderOption) => void,
 *   byKey: { current: boolean }, setHl: (i: number) => void,
 *   commit: (o: RenderOption) => void }} RowCtx
 *   The shared context every option row draws from — see OptionRow. `hl` and
 *   `selIdx` are indexes into the pop's row list (headers included), not into
 *   the options array.
 */

/**
 * @param {string | number | undefined} v
 * @returns {string}
 */
const s = (v) => (v == null ? "" : String(v));
let uid = 0;

// The open pop's row list: options 1:1 in Standard mode, and with a family
// header before each family's first option and a variant subheader before each
// non-null variant's first option when the options carry plain-names groups.
// Group runs are contiguous by construction (store/plainnames.js sorts them),
// so a boundary check per option is enough.
/**
 * @param {RenderOption[]} opts
 * @returns {ListRow[]}
 */
function buildRows(opts) {
  /** @type {ListRow[]} */
  const rows = [];
  /** @type {string | null} */
  let g = null;
  /** @type {string | null} */
  let sg = null;
  opts.forEach((o, oi) => {
    if (o.group != null) {
      if (o.group !== g) {
        rows.push({ header: o.group, sub: false, blurb: o.groupBlurb });
        g = o.group;
        sg = null;
      }
      if (o.subgroup != null && o.subgroup !== sg) rows.push({ header: o.subgroup, sub: true, blurb: o.subgroupBlurb });
      sg = o.subgroup == null ? null : o.subgroup;
    } else {
      g = null;
      sg = null;
    }
    rows.push({ o, oi });
  });
  return rows;
}

/**
 * @param {ListRow | undefined} row
 * @returns {RenderOption | undefined}
 */
const rowOption = (row) => (row && "o" in row ? row.o : undefined);

// Fold the flat row list into nested family/variant containers for display —
// a family header owns its group, a variant subheader its subgroup, so each
// can stick to the pop's top while its own rows scroll under it. Indices stay
// in the flat row domain; only the DOM nests. Unknown and Standard-mode rows
// (no group) stay at the top level.
/**
 * @param {ListRow[]} rows
 * @returns {(Slot | FGroup)[]}
 */
function nestRows(rows) {
  /** @type {(Slot | FGroup)[]} */
  const top = [];
  /** @type {FGroup | null} */
  let g = null;
  /** @type {VGroup | null} */
  let v = null;
  rows.forEach((r, i) => {
    if (!("o" in r)) {
      if (r.sub && g) {
        v = { head: r.header, blurb: r.blurb, items: [] };
        g.kids.push(v);
      } else if (!r.sub) {
        g = { head: r.header, blurb: r.blurb, kids: [] };
        v = null;
        top.push(g);
      }
      return;
    }
    if (r.o.group == null) {
      g = null;
      v = null;
    } else if (r.o.subgroup == null) {
      v = null; // a bare-family row after a variant group leaves the subgroup
    }
    (v ? v.items : g ? g.kids : top).push({ r, i });
  });
  return top;
}

// An option row's visible text: the plain-names display when the option
// carries one, else the raw label; a disabled row appends its reason.
/**
 * @param {RenderOption} o
 * @returns {string}
 */
const rowText = (o) => `${o.display || o.label}${o.disabled && o.reason ? ` — ${o.reason}` : ""}`;

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
 *   setHl: (i: number) => void, byKey: { current: boolean }, show: () => void,
 *   commit: (o: RenderOption | undefined) => void }} ctx
 * @returns {(e: KeyboardEvent) => void}
 */
function comboKeyHandler({ open, setOpen, rows, hl, setHl, byKey, show, commit }) {
  // Arrow moves land on option rows only: from `from`, the nearest option row
  // in `dir`, or `from` itself when none is left in that direction.
  /**
   * @param {number} from
   * @param {number} dir
   * @returns {number}
   */
  const nextOption = (from, dir) => {
    for (let j = from + dir; j >= 0 && j < rows.length; j += dir) {
      if (rowOption(rows[j])) return j;
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
      ${rowText(o)}
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

// One node of the nested pop body: an option row, or a variant container —
// subheader plus its rows.
/**
 * @param {Slot | VGroup} k
 * @param {RowCtx} row
 * @returns {ReturnType<typeof html>}
 */
function renderKid(k, row) {
  if (!("items" in k)) return html`<${OptionRow} o=${k.r.o} i=${k.i} row=${row} />`;
  return html`<div class="dd-vgrp">
    <div class="dd-hdr dd-subhdr" role="presentation">${k.head}</div>
    ${k.blurb ? html`<div class="dd-blurb t-caption" role="presentation">${k.blurb}</div>` : null}
    ${k.items.map((it) => renderKid(it, row))}
  </div>`;
}

// The pop's body: family containers holding their headers, bare rows and
// variant containers in Simplified mode; a flat option list otherwise. The
// family header appends the word "family" (uppercased by CSS, so it reads
// e.g. CLOSED FORM FAMILY).
/**
 * @param {ListRow[]} rows
 * @param {RowCtx} row
 * @returns {ReturnType<typeof html>[]}
 */
function renderRows(rows, row) {
  return nestRows(rows).map((n) =>
    "kids" in n
      ? html`<div class="dd-grp">
          <div class="dd-hdr t-head" role="presentation">${n.head} family</div>
          ${n.blurb ? html`<div class="dd-blurb t-caption" role="presentation">${n.blurb}</div>` : null}
          ${n.kids.map((k) => renderKid(k, row))}
        </div>`
      : renderKid(n, row),
  );
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
 * star. Reports a value on commit only.
 * @param {{ value: string | number | undefined, options: RenderOption[] | undefined,
 *   valueLabel?: string, tips?: (o: RenderOption) => TipContent, fav?: (o: RenderOption) => boolean,
 *   onFav?: (o: RenderOption) => void, disabled?: boolean,
 *   onChange: (v: string | number) => void }} props
 */
export function Combobox({ value, options, valueLabel, tips, fav, onFav, disabled, onChange }) {
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

  const show = () => {
    byKey.current = true; // opening reveals the selection, same as a key move
    const first = rows.findIndex((r) => "o" in r);
    setHl(selIdx >= 0 ? selIdx : Math.max(0, first));
    setOpen(true);
  };
  /** @param {RenderOption | undefined} o */
  const commit = (o) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
  };
  const onKey = comboKeyHandler({ open, setOpen, rows, hl, setHl, byKey, show, commit });
  useDismissOnOutside({ open, setOpen, btnRef, popRef });

  usePopPlacement({ open, hl, id, tipKey, byKey, btnRef, popRef, tipRef });

  // A narrowed dropdown can drop the current selection off its own list
  // (store/narrow/state.js); the closed control still has to name that selection,
  // so the caller passes the label the option list no longer carries.
  const sel = rowOption(rows[selIdx]);
  const label = sel ? sel.closedLabel || sel.label : valueLabel || s(value);
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
      ${renderRows(rows, row)}
    </div>
    ${tip ? html`<${TipPop} tip=${tip} tipRef=${tipRef} />` : null}
  `;
}
