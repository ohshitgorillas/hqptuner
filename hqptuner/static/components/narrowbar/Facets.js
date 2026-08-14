// The narrowing bar's first row, assembled: which facet gets which widget, which
// open signal, which option table and which count override. Its own module
// because this is the wiring layer — the widgets in Select.js stay facet-blind,
// and everything facet-specific about the dropdown row lands here.
import { html } from "../../lib/dom.js";
import { GENRES, QUALITY, FOCUS, PHASES, LENGTHS } from "./facet-data.js";
import { genreOpen, qualityOpen, focusOpen, phaseOpen, lengthOpen, rateOpen } from "./popover.js";
import { focusLabel, genreLabel, rateLabel, oneLabel, toggleVal } from "./labels.js";
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
  nHide2x,
  nHideInt,
  nDownsafeOnly,
  RATE_RULE_DEFAULT,
} from "../../store/narrowing.js";
import { rateAutoHide, effHide2x, effHideInt } from "../../store/narrowmatch.js";
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
      <${RateFacet} />
    </div>
  `;
}

// One hide-rule row of the rate-change popover: a checkbox showing the rule's
// EFFECTIVE state, with the count preview of the state clicking it lands on.
// Clicking writes the explicit opposite of what the box shows — from "auto"
// that is an override, and only overrides highlight the facet button.
/**
 * @param {{ on: boolean, label: string, onToggle: () => void,
 *           count: import("./labels.js").NarrowOverrides }} props
 */
function RateRule({ on, label, onToggle, count }) {
  return html`<label>
    <input type="checkbox" checked=${on} onChange=${onToggle} />
    <span class="opt-label">${label}</span>
    <${CountChip} overrides=${count} />
  </label>`;
}

// The rate-change facet. The manual's ratio column names limitations, so the
// popover offers hide rules for the scenarios where a limitation bites —
// cross-family (fractional) conversion and downsampling — never a "show only
// limitation X" pick. The favorites toggle closes the row: it needs a starred
// filter to be reachable.
function RatePop() {
  const autoEngaged =
    rateAutoHide.value && (nHide2x.value === RATE_RULE_DEFAULT || nHideInt.value === RATE_RULE_DEFAULT);
  return html`<div class="multi-pop rate-pop">
    <div class="multi-head t-label">1x / Nx</div>
    <${RateRule}
      on=${effHide2x.value}
      onToggle=${() => (nHide2x.value = effHide2x.value ? "off" : "on")}
      label="Hide 2x-only filters"
      count=${{ hide2x: !effHide2x.value }}
    />
    <${RateRule}
      on=${effHideInt.value}
      onToggle=${() => (nHideInt.value = effHideInt.value ? "off" : "on")}
      label="Hide integer-only filters"
      count=${{ hideInt: !effHideInt.value }}
    />
    <${RateRule}
      on=${nDownsafeOnly.value}
      onToggle=${() => (nDownsafeOnly.value = !nDownsafeOnly.value)}
      label="Show only downsampling-safe filters"
      count=${{ downsafeOnly: !nDownsafeOnly.value }}
    />
    ${
      autoEngaged
        ? html`<div class="rate-note t-caption">
            Auto: this device exposes no 48 kHz-family DSD rates, so 2x- and integer-only filters are hidden by
            default. Toggling a rule overrides the automatic choice.
          </div>`
        : null
    }
    <div class="rate-note t-caption">
      <strong>2x-only:</strong> This filter can only output multiples of the source rate by factors of two. For
      example, for a 48kHz source file, the filter could output 2x48, 4x48, 8x48, ...
    </div>
    <div class="rate-note t-caption">
      <strong>Integer-only:</strong> Similar to 2x-only, but also capable of intermediate rates like 3x, 5x, etc.
    </div>
    <div class="rate-note t-caption">
      <strong>HQPTuner Hints:</strong> If your output mode is SDM but your DAC doesn't support 48kHz-family DSD
      rates, avoid 2x- and Integer-only filters. These will fail to produce output with 48kHz-family source
      material.
    </div>
  </div>`;
}

function RateFacet() {
  const active = nHide2x.value !== RATE_RULE_DEFAULT || nHideInt.value !== RATE_RULE_DEFAULT || nDownsafeOnly.value;
  return html`
      <div class="multi" data-multi="rate">
        <button type="button" class="multi-btn ${active ? "active" : ""}" onClick=${() => (rateOpen.value = !rateOpen.value)}>
          ${rateLabel()} <span class="multi-caret">▾</span>
        </button>
        ${rateOpen.value ? html`<${RatePop} />` : null}
      </div>
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
