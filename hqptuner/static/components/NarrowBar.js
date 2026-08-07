// Filter narrowing bar — a card ABOVE the PCM/SDM filter cards, holding the
// genre / quality / focus / phase / length / ratio facets (all multi- or
// single-select popovers) on one row, and the per-stage apodizing / hi-res
// segmented switches on a second row (global across PCM and SDM, separate for
// 1x and Nx — user decision). Presentational only.
//
// It is a real `Card`, not a panel of its own: painting the card frame itself —
// card surface, card radius, a hand-rolled heading — under its own class name
// is how a panel drifts to the wrong border token and a doubled bottom margin
// without any gate noticing. A card that reads as a card IS a Card
// (docs/design-system.md).
//
// The parts live in ./narrowbar/: facet-data.js (option tables), popover.js
// (exclusive open state), labels.js (summary labels and preview counts),
// Select.js (the popover widgets), Facets.js (the dropdown row), Stages.js (the
// switch rows).
import { useEffect } from "preact/hooks";
import { html } from "../lib/dom.js";
import { Card } from "./common.js";
import { narrowingActive, resetNarrowing, nApod1x, nApodNx, nHires1x, nHiresNx } from "../store/narrowing.js";
import { closeExcept } from "./narrowbar/popover.js";
import { NarrowFacets } from "./narrowbar/Facets.js";
import {
  APOD_SEGS,
  HIRES_1X_SEGS,
  HIRES_NX_SEGS,
  HIRES_TIP,
  StageSeg,
  SwitchGroup,
  apodTip,
} from "./narrowbar/Stages.js";

export function NarrowBar() {
  useEffect(() => {
    const onDown = (/** @type {Event} */ e) => closeExcept(/** @type {Element | null} */ (e.target));
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
  return html`
    <${Card}
      title=${html`Narrow filters${
        narrowingActive.value
          ? html`<button type="button" class="narrow-reset" onClick=${resetNarrowing}>Reset</button>`
          : null
      }`}
      cardClass="narrow-card"
    >
      <div class="t-caption">
        Reduce the number of filters in the dropdowns below by selecting which features you're looking for. Dropdown
        counts show the number of 1x/Nx filters resulting from (de)selecting that option. All narrowing data are sourced
        directly from the HQPlayer manual.
      </div>
      <div class="narrow-controls">
        <${NarrowFacets} />
      </div>
      <div class="narrow-switchcols">
        <${SwitchGroup} title="Apodizing filters" desc=${apodTip()}>
          <${StageSeg} stage="1x" sig=${nApod1x} options=${APOD_SEGS} />
          <${StageSeg} stage="nx" sig=${nApodNx} options=${APOD_SEGS} />
        <//>
        <span class="col-rule"></span>
        <${SwitchGroup} title="Hi-res filters" desc=${HIRES_TIP} cls="narrow-hires">
          <${StageSeg} stage="1x" sig=${nHires1x} options=${HIRES_1X_SEGS} />
          <${StageSeg} stage="nx" sig=${nHiresNx} options=${HIRES_NX_SEGS} />
        <//>
      </div>
    <//>
  `;
}
