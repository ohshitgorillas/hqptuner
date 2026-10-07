// An option list's rows: one option's name, its marks and its heart, and the key to the filter rows' marks. A filter
// row marks its apodizing (v1's circled A or ½) and its quality stars, a modulator row the DSD rate floor it needs, a
// dither or DSD row nothing. Hover or focus shows the row's tip, a tap picks it, the heart stars it without picking,
// on the kinds that keep favorites.

import { html } from "../../../lib/dom.js";
import { hasFavorites, hideTip, pickFromList, showTip } from "../../../store/faceplate/lists/open.js";
import { isListFavorite, toggleListFavorite } from "../../../store/faceplate/lists/options.js";
import { TierMark } from "../NameFace.js";

/** @typedef {import("../../../model/shell/option-list.js").Opt} Opt */
/** @typedef {import("../../../store/faceplate/view.js").ListRequest} ListRequest */
/** @typedef {import("../../../store/faceplate/lists/open.js").ListKind} ListKind */

// The glyphs as outlines, Inter 400's "A" and "onehalf", each centered on the circle (v1 components/controls/apod.js).
const APOD_PATH = {
  full:
    "M5.61 15.00 9.24 5.00H10.71L14.39 15.00H13.05L10.93 9.07Q10.73 8.52 10.48 7.69Q10.22 6.87 9.85 5.60H10.09Q9.73 " +
    "6.89 9.46 7.72Q9.20 8.56 9.02 9.07L6.96 15.00ZM7.43 12.21V11.09H12.57V12.21Z",
  half:
    "M6.98 4.62V10.48H5.82V5.61H5.75L4.36 6.68V5.53L5.54 4.62ZM5.18 15.38 12.57 4.62H13.79L6.40 15.38ZM11.67 " +
    "15.38V14.60L13.63 12.47Q14.02 12.06 14.23 11.75Q14.44 11.44 14.44 11.11Q14.44 10.77 14.17 10.58Q13.90 10.40 " +
    "13.56 10.40Q13.20 10.40 12.97 10.59Q12.74 10.79 12.74 11.14H11.62Q11.62 10.35 12.19 9.90Q12.77 9.45 13.60 " +
    "9.45Q14.48 9.45 15.02 9.93Q15.56 10.40 15.56 11.07Q15.56 11.34 15.44 11.63Q15.33 11.93 15.00 12.36Q14.68 12.79 " +
    "14.05 13.48L13.29 14.33V14.40H15.64V15.38Z",
};
const APOD_LABEL = { full: "Apodizing", half: "Half apodizing" };

/**
 * The apodizing mark of a kind; nothing for a filter that does not apodize.
 *
 * @param {{ kind: "full" | "half" | null | undefined }} props
 */
export function AMark({ kind }) {
  if (!kind) return null;
  return html`
    <span class="amark" role="img" aria-label=${APOD_LABEL[kind]}>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="9.3" />
        <path d=${APOD_PATH[kind]} />
      </svg>
    </span>
  `;
}

/**
 * A row's marks for its list kind.
 *
 * @param {ListKind} kind
 * @param {Opt} o
 */
function marks(kind, o) {
  if (kind === "filters") {
    const q = o.f?.q;
    return html`
      <span class="mk"><${AMark} kind=${o.f?.apod} /></span>
      <span class="qst" aria-label=${q ? `Quality ${q}/5` : undefined}>${q ? "★".repeat(q) : ""}</span>
    `;
  }
  if (kind !== "modulators") return null;
  return html`<span class="mk"><${TierMark} tier=${o.tier} /></span>`;
}

/**
 * A row's heart: stars or unstars the option, and neither picks it nor closes the list.
 *
 * @param {ListRequest} req
 * @param {Opt} o
 */
function heart(req, o) {
  const fav = isListFavorite(req.key, o.v);
  return html`
    <button
      type="button"
      class=${fav ? "fav on" : "fav"}
      data-fav=${o.v}
      aria-pressed=${String(fav)}
      aria-label=${`${fav ? "Unfavorite" : "Favorite"} ${o.v}`}
      onClick=${(/** @type {Event} */ e) => {
        e.stopPropagation();
        void toggleListFavorite(req.key, o.v);
      }}
    >
      ${fav ? "♥" : "♡"}
    </button>
  `;
}

/**
 * One option's row. Standard names the engine option, Simplified its plain leaf.
 *
 * @param {{ o: Opt, req: ListRequest, kind: ListKind, std: boolean }} props
 */
export function Row({ o, req, kind, std }) {
  return html`
    <div
      class="orow"
      role="option"
      tabindex="-1"
      data-v=${o.v}
      aria-selected=${String(o.v === req.value)}
      onClick=${() => pickFromList(o.v)}
      onPointerEnter=${(/** @type {PointerEvent} */ e) => e.pointerType !== "touch" && showTip(o.v)}
      onPointerLeave=${() => hideTip(o.v)}
      onFocus=${() => showTip(o.v)}
      onBlur=${() => hideTip(o.v)}
    >
      <span class="nm">${std ? o.v : o.leaf}</span>
      ${marks(kind, o)} ${hasFavorites(kind) ? heart(req, o) : null}
    </div>
  `;
}

/** The key to the filter rows' marks, in v1's `glyph = word` grammar. */
export function Legend() {
  return html`
    <div class="olegend" role="presentation">
      <span><${AMark} kind="full" /> = Apodizing</span>
      <span><${AMark} kind="half" /> = Half apodizing</span>
      <span><span class="lq">★</span> = Quality</span>
      <span><span class="lf">♥</span> = Favorite</span>
    </div>
  `;
}
