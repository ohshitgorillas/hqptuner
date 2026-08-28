// The combobox pop's row markup (Combobox.js, its only caller): option rows,
// family and variant headers, the apodizing and rate-floor badges, and the
// favorite heart. Combobox.js keeps focus, placement and commit.
import { html } from "../../lib/dom.js";
import { Apod } from "./apod.js";
import { nestRows } from "./comborows.js";

/**
 * @typedef {import("./comborows.js").RenderOption} RenderOption
 * @typedef {import("./comborows.js").ListRow} ListRow
 * @typedef {import("./comborows.js").Slot} Slot
 * @typedef {import("./comborows.js").VGroup} VGroup
 * @typedef {import("./comborows.js").ApodClass} ApodClass
 * @typedef {import("./comborows.js").CollapseCtl} CollapseCtl
 * @typedef {{ open: boolean, hl: number, selIdx: number, id: string,
 *   fav?: (o: RenderOption) => boolean, onFav?: (o: RenderOption) => void,
 *   badge?: (o: RenderOption) => ApodClass, stars?: (o: RenderOption) => number | null,
 *   tier?: (o: RenderOption) => string | null,
 *   collapse?: CollapseCtl,
 *   toggle: (key: string) => void,
 *   byKey: { current: boolean }, setHl: (i: number) => void,
 *   commit: (o: RenderOption) => void }} RowCtx
 *   The shared context every option row draws from — see OptionRow. `hl` and
 *   `selIdx` are indexes into the pop's row list (headers included), not into
 *   the options array. `toggle` wraps collapse.onToggle so a fold that hides
 *   the highlighted row can also move the highlight somewhere visible.
 */

/**
 * An option value as the string the DOM and the selection test compare in.
 * @param {string | number | undefined} v
 * @returns {string}
 */
export const s = (v) => (v == null ? "" : String(v));

// An option row's visible text: the plain-names display when the option
// carries one, else the raw label; a disabled row appends its reason.
/**
 * @param {RenderOption} o
 * @returns {string}
 */
const rowText = (o) => `${o.display || o.label}${o.disabled && o.reason ? ` — ${o.reason}` : ""}`;

// A dropdown row is a filter, so the mark reads out in the filters' own
// vocabulary. Easy Mode names the same mark in plain words instead, which is
// why the label belongs to the caller and not to `Apod` (controls/apod.js).
const APOD_LABEL = { full: "Apodizing", half: "Half apodizing" };

/**
 * A row's badge label, empty for a row that carries no badge.
 * @param {ApodClass | undefined} kind
 * @returns {string}
 */
const apodLabel = (kind) => (kind ? APOD_LABEL[kind] : "");

// The manual's Recommended flag beside a Simplified row's name — `rec` rides
// in from the plain-names decoration and never exists in Standard mode. Inert
// like the apodizing mark it sits beside: part of the name, not a control.
/**
 * @param {{ on: boolean | undefined }} props
 */
function Rec({ on }) {
  if (!on) return null;
  return html`<span class="dd-rec" role="img" aria-label="Recommended">✓</span>`;
}

// One option in the pop. `row` is the shared context the whole list draws from:
// which index is highlighted and which is selected, the id prefix the button's
// aria-activedescendant points at, the favorite wiring, and the two writers.
// `apod` is the row's own badge, null for a row that is not apodizing.
/**
 * @param {{ o: RenderOption, i: number, apod: ApodClass, row: RowCtx }} props
 */
function OptionRow({ o, i, apod, row }) {
  const { open, hl, selIdx, id, fav, onFav, stars, byKey, setHl, commit } = row;
  const q = stars ? stars(o) : null;
  return html`
    <div
      class=${open && i === hl ? "dd-opt hl" : "dd-opt"}
      role="option"
      data-v=${o.value}
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
      <${Rec} on=${o.rec} />
      <${Apod} kind=${apod} label=${apodLabel(apod)} />
      <${Tier} o=${o} row=${row} />
      ${q == null ? null : html`<span class="dd-stars">${"★".repeat(q)}</span>`}
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
              ${fav(o) ? "♥" : "♡"}
            </button>`
          : null
      }
    </div>
  `;
}

// The rate floor beside an option's name (modulator rows): a read, never a
// control, and inert like the apodizing mark it sits next to. Nothing at all
// for a row whose option has no floor, and for every dropdown without a `tier`
// resolver.
/**
 * @param {{ o: RenderOption, row: RowCtx }} props
 */
function Tier({ o, row }) {
  const t = row.tier ? row.tier(o) : null;
  if (t == null) return null;
  return html`<span class="dd-tier" role="img" aria-label=${`Needs DSD${t.slice(0, -1)} or higher`}>${t}</span>`;
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
 * The pop's whole body, as the rows and containers the list renders.
 * @param {ListRow[]} rows
 * @param {RowCtx} row
 * @returns {ReturnType<typeof html>[]}
 */
export function renderRows(rows, row) {
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
