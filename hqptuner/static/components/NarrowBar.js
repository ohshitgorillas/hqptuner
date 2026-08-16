// Filter narrowing bar — a card ABOVE the PCM/SDM filter cards, holding the
// genre / quality / focus / phase / length / ratio facets (all multi- or
// single-select popovers) on one row, and the apodizing, lossy and source-format
// segmented switches on a second row (global across PCM and SDM; apodizing is
// per stage, lossy is 1x only — user decision). Presentational only: source
// format is the one switch that discloses rather than narrows, opening the chain
// cards' DSD Sources subsections instead of filtering a dropdown.
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
import { narrowingActive, resetNarrowing, nApod1x, nApodNx, nLossy1x, nSrcFormat } from "../store/narrowing.js";
import { narrowingError } from "../store/narrowpersist.js";
import { notesVisible } from "../store/prefs.js";
import { closeExcept } from "./narrowbar/popover.js";
import { NarrowFacets } from "./narrowbar/Facets.js";
import { Segment } from "./controls/index.js";
import {
  APOD_SEGS,
  LOSSY_SEGS,
  LOSSY_TIP,
  SRC_FORMAT_SEGS,
  SRC_FORMAT_TIP,
  StageSeg,
  SwitchGroup,
  apodTip,
} from "./narrowbar/Stages.js";

/**
 * Renders the narrowing card above the filter cards: the facet dropdown row and
 * the two stage switch groups, plus the page-wide pointerdown listener that
 * retracts an open facet popover.
 */
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
      ${
        notesVisible.value
          ? html`<div class="t-caption">
              Reduce the number of filters in the dropdowns below by selecting which features you're looking for.
              Dropdown counts show the number of 1x/Nx filters resulting from (de)selecting that option. All narrowing
              data are sourced directly from the HQPlayer manual.
            </div>`
          : null
      }
      <div class="narrow-controls">
        <${NarrowFacets} />
      </div>
      <div class="narrow-switchcols">
        <${SwitchGroup} title="Apodizing filters" desc=${apodTip()}>
          <${StageSeg} stage="1x" sig=${nApod1x} options=${APOD_SEGS} />
          <${StageSeg} stage="nx" sig=${nApodNx} options=${APOD_SEGS} />
        <//>
        <span class="col-rule"></span>
        <div class="narrow-groupstack">
          <${SwitchGroup} title="1x sources" desc=${LOSSY_TIP}>
            <${StageSeg} stage="1x" sig=${nLossy1x} options=${LOSSY_SEGS} showStage=${false} />
          <//>
          <${SwitchGroup} title="Source format" desc=${SRC_FORMAT_TIP}>
            <${Segment}
              value=${nSrcFormat.value}
              options=${SRC_FORMAT_SEGS}
              onChange=${(/** @type {string} */ v) => (nSrcFormat.value = v)}
            />
          <//>
        </div>
      </div>
      ${narrowingError.value ? html`<div class="field-error">${narrowingError.value}</div>` : null}
    <//>
  `;
}
