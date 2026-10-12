// An option list's rows: one option's name, its marks and its heart, and the key to the filter rows' marks. A filter
// row marks its apodizing (a circled A or ½) and its quality stars, a modulator row the DSD rate floor it needs, a
// dither or DSD row nothing. Hover or focus shows the row's tip, a tap picks it, the heart stars it without picking,
// on the kinds that keep favorites.

import { html } from "../../../lib/dom.js";
import { hasFavorites, hideTip, pickFromList, showTip } from "../../../store/faceplate/lists/open.js";
import { isListFavorite, toggleListFavorite } from "../../../store/faceplate/lists/options.js";
import { AMark, TierMark } from "../NameFace.js";

/** @typedef {import("../../../model/shell/option-list.js").Opt} Opt */
/** @typedef {import("../../../store/faceplate/view.js").ListRequest} ListRequest */
/** @typedef {import("../../../store/faceplate/lists/open.js").ListKind} ListKind */

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

/** The key to the filter rows' marks, each as `glyph = word`. */
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
