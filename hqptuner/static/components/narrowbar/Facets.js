// The narrowing bar's first row, assembled: which facet gets which widget, which
// open signal, which option table and which count override. Its own module
// because this is the wiring layer — the widgets in Select.js stay facet-blind,
// and everything facet-specific about the dropdown row lands here.
import { html } from "../../lib/dom.js";
import { GENRES, QUALITY, FOCUS, PHASES, LENGTHS, RATIOS } from "./facet-data.js";
import { genreOpen, qualityOpen, focusOpen, phaseOpen, lengthOpen, ratioOpen } from "./popover.js";
import { focusLabel, genreLabel, ratioLabel, oneLabel, toggleVal } from "./labels.js";
import { CountChip, SingleSelect, MultiSelect } from "./Select.js";
import { Segment } from "../controls/index.js";
import {
  nGenre,
  nGenreMode,
  nQuality,
  nFocus,
  nFocusMode,
  nPhase,
  nLength,
  nRatio,
  nUpsampleOnly,
} from "../../store/narrowing.js";
import { favoriteFilters, nFavOnly } from "../../store/favorites.js";

// How a multi-select facet's picks combine, as the last row of its own popover:
// the checkbox rows above are WHICH tags, this is HOW they join. A segment
// rather than a checkbox because both halves are real answers — neither "and"
// nor "or" is the off position — and it spans the popover so the two halves read
// as one two-way choice, not as another option row.
const MODE_SEGS = [
  { value: "and", label: "AND" },
  { value: "or", label: "OR" },
];

/**
 * Renders one multi-select facet's AND/OR combine switch, bound to `sig`.
 * @param {{ sig: { value: string } }} props
 */
function ModeSwitch({ sig }) {
  return html`<div class="multi-extra multi-mode">
    <${Segment} value=${sig.value} options=${MODE_SEGS} onChange=${(/** @type {string} */ v) => (sig.value = v)} />
  </div>`;
}

/**
 * Renders the facet row: the genre, quality, focus, phase, length and ratio
 * dropdowns plus the favorites toggle. Each dropdown's `count` maps a candidate
 * option to the narrowing override its chip counts against.
 */
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
        extra=${html`<${ModeSwitch} sig=${nGenreMode} />`}
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
        extra=${html`<${ModeSwitch} sig=${nFocusMode} />`}
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
