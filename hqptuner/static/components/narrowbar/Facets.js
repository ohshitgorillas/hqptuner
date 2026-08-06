// The narrowing bar's first row, assembled: which facet gets which widget, which
// open signal, which option table and which count override. Its own module
// because this is the wiring layer — the widgets in Select.js stay facet-blind,
// and everything facet-specific about the dropdown row lands here.
import { html } from "../../lib/dom.js";
import { GENRES, QUALITY, FOCUS, PHASES, LENGTHS, RATIOS } from "./facet-data.js";
import { genreOpen, qualityOpen, focusOpen, phaseOpen, lengthOpen, ratioOpen } from "./popover.js";
import { focusLabel, genreLabel, ratioLabel, oneLabel, toggleVal } from "./labels.js";
import { CountChip, SingleSelect, MultiSelect } from "./Select.js";
import { nGenre, nQuality, nFocus, nPhase, nLength, nRatio, nUpsampleOnly, nFavOnly } from "../../store/narrowing.js";
import { favoriteFilters } from "../../store/favorites.js";

// The facet row: six dropdowns and the favorites toggle. Each dropdown's `count`
// maps a candidate option to the narrowing override the chip counts against.
export function NarrowFacets() {
  return html`
    <div class="narrow-facets">
      <${MultiSelect}
        open=${genreOpen}
        name="genre"
        label=${genreLabel()}
        items=${GENRES}
        sig=${nGenre}
        active=${!!nGenre.value.length}
        count=${(/** @type {string} */ v) => ({ genre: toggleVal(nGenre.value, v) })}
      />
      <${SingleSelect}
        open=${qualityOpen}
        name="quality"
        label=${oneLabel(QUALITY, nQuality.value, "Any quality")}
        value=${nQuality.value}
        items=${QUALITY}
        onPick=${(/** @type {string | number} */ v) => (nQuality.value = Number(v))}
        active=${Number(nQuality.value) > 0}
        count=${(/** @type {string | number} */ v) => ({ quality: Number(v) })}
      />
      <${MultiSelect}
        open=${focusOpen}
        name="focus"
        label=${focusLabel()}
        items=${FOCUS}
        sig=${nFocus}
        active=${!!nFocus.value.length}
        count=${(/** @type {string} */ v) => ({ focus: toggleVal(nFocus.value, v) })}
      />
      <${SingleSelect}
        open=${phaseOpen}
        name="phase"
        label=${oneLabel(PHASES, nPhase.value, "Any phase")}
        value=${nPhase.value}
        items=${PHASES}
        onPick=${(/** @type {string} */ v) => (nPhase.value = v)}
        active=${!!nPhase.value}
        count=${(/** @type {string} */ v) => ({ phase: v })}
      />
      <${SingleSelect}
        open=${lengthOpen}
        name="length"
        label=${oneLabel(LENGTHS, nLength.value, "Any length")}
        value=${nLength.value}
        items=${LENGTHS}
        onPick=${(/** @type {string} */ v) => (nLength.value = v)}
        active=${!!nLength.value}
        count=${(/** @type {string} */ v) => ({ length: v })}
      />
      <${RatioFacet} />
    </div>
  `;
}

// The ratio dropdown carries the upsample-only checkbox inside its pop, and the
// favorites toggle closes the row: it needs a starred filter to be reachable.
function RatioFacet() {
  return html`
      <${SingleSelect}
        open=${ratioOpen}
        name="ratio"
        label=${ratioLabel()}
        value=${nRatio.value}
        items=${RATIOS}
        onPick=${(/** @type {string} */ v) => (nRatio.value = v)}
        active=${!!nRatio.value || nUpsampleOnly.value}
        count=${(/** @type {string} */ v) => ({ ratio: v })}
        extra=${html`<label class="multi-extra">
          <input
            type="checkbox"
            checked=${nUpsampleOnly.value}
            onChange=${() => (nUpsampleOnly.value = !nUpsampleOnly.value)}
          />
          <span class="opt-label">Upsample-only</span>
          <${CountChip} overrides=${{ upsampleOnly: true }} />
        </label>`}
      />
      <button
        type="button"
        class="multi-btn ${nFavOnly.value ? "active" : ""}"
        disabled=${!favoriteFilters.value.size}
        title=${
          favoriteFilters.value.size
            ? "Show only the filters you starred in the dropdowns below"
            : "Star a filter in a dropdown below to enable"
        }
        onClick=${() => (nFavOnly.value = !nFavOnly.value)}
      >
        ★ Favorites
      </button>
  `;
}
