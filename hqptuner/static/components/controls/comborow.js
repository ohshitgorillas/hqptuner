// The combobox pop's row markup (Combobox.js, its only caller): option rows,
// family and variant headers, the apodizing and rate-floor badges, and the
// favorite heart. Combobox.js keeps focus, placement and commit.
import { html } from "../../lib/dom.js";
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

const APOD_LABEL = { full: "Apodizing", half: "Half apodizing" };
// The glyphs as baked outlines, not font text: where the glyph was a <text>
// node its position depended on which font the viewer's browser resolved, its
// weight (a selected row is semibold) and the engine's dominant-baseline
// mapping — different in every environment, so no anchor held everywhere.
// Outlines are Inter 400's own "A" and "onehalf" (fonts/inter-400.woff2,
// extracted with fontTools), each ink bounding box centered on the circle at
// (10,10) in viewBox units, per-glyph ink height 10 (A) and 10.75 (the
// fraction's digits go illegible smaller; any bigger crowds the circle).
const APOD_PATH = {
  full:
    "M5.61 15.00 9.24 5.00H10.71L14.39 15.00H13.05L10.93 9.07Q10.73 8.52 10.48 7.69Q10.22 6.87 " +
    "9.85 5.60H10.09Q9.73 6.89 9.46 7.72Q9.20 8.56 9.02 9.07L6.96 15.00ZM7.43 12.21V11.09H12.57V12.21Z",
  half:
    "M6.98 4.62V10.48H5.82V5.61H5.75L4.36 6.68V5.53L5.54 4.62ZM5.18 15.38 12.57 4.62H13.79L6.40 " +
    "15.38ZM11.67 15.38V14.60L13.63 12.47Q14.02 12.06 14.23 11.75Q14.44 11.44 14.44 11.11Q14.44 " +
    "10.77 14.17 10.58Q13.90 10.40 13.56 10.40Q13.20 10.40 12.97 10.59Q12.74 10.79 12.74 " +
    "11.14H11.62Q11.62 10.35 12.19 9.90Q12.77 9.45 13.60 9.45Q14.48 9.45 15.02 9.93Q15.56 10.40 " +
    "15.56 11.07Q15.56 11.34 15.44 11.63Q15.33 11.93 15.00 12.36Q14.68 12.79 14.05 13.48L13.29 " +
    "14.33V14.40H15.64V15.38Z",
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
