// The narrowing bar's first row, assembled: which facet gets which widget, which
// open signal, which option table and which count override. Its own module
// because this is the wiring layer — the widgets in Select.js stay facet-blind,
// and everything facet-specific about the dropdown row lands here.
import { html } from "../../lib/dom.js";
import { GENRES, QUALITY, FOCUS, PHASES, LENGTHS } from "./facet-data.js";
import { genreOpen, qualityOpen, focusOpen, phaseOpen, lengthOpen, rateOpen } from "./popover.js";
import {
  focusLabel,
  genreLabel,
  genreRowOff,
  phaseLabel,
  lengthLabel,
  rateLabel,
  oneLabel,
  tagRowOff,
  toggleVal,
} from "./labels.js";
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
  nHideLimited,
  nOddRateOnly,
  nDownsafeOnly,
  QUALITY_DEFAULT,
  RATE_RULE_DEFAULT,
} from "../../store/narrow/state.js";
import { effHideLimited } from "../../store/narrow/match.js";
import { favoriteFilters, favoriteModulators, nFavOnly } from "../../store/narrow/favorites.js";

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

// Two readings of one row, and they are different questions. `*Pick` is the
// selection clicking it would produce, which is what its chip counts. `*Solo` is
// that facet narrowed to this tag ALONE with every other facet untouched, which
// is what says whether any filter carries the tag at all.
const genrePick = (/** @type {string} */ v) => ({ genre: toggleVal(nGenre.value, v) });
const focusPick = (/** @type {string} */ v) => ({ focus: toggleVal(nFocus.value, v) });
const phasePick = (/** @type {string} */ v) => ({ phase: toggleVal(nPhase.value, v) });
const lengthPick = (/** @type {string} */ v) => ({ length: toggleVal(nLength.value, v) });

const genreSolo = (/** @type {string} */ v) => ({ genre: [v] });
const focusSolo = (/** @type {string} */ v) => ({ focus: [v] });
const phaseSolo = (/** @type {string} */ v) => ({ phase: [v] });
const lengthSolo = (/** @type {string} */ v) => ({ length: [v] });

// The hint prose closing the quality, focus, phase and length popovers —
// owner-approved copy, verbatim, in the same note chrome the rate popover's
// explainer uses.
const QualityHint = html`<div class="rate-note t-caption">
  <strong>HQPTuner Hints:</strong> Quality ratings are relative to general-purpose use; lesser-rated filters can
  outperform higher-rated ones with the appropriate content.
</div>`;
const FocusHint = html`<div class="rate-note t-caption">
  <p><strong>HQPTuner Hints:</strong> Select the properties you want emphasized by the filter.</p>
  <p>
    <strong>Transients</strong> are sudden sounds like a snare hit or the leading edge of a plucked string; these
    filters emphasize clean reproduction of such events.
  </p>
  <p>
    <strong>Timbre</strong> is how natural and realistic instruments and voices are rendered; these filters
    emphasize a more lifelike sound.
  </p>
  <p>
    <strong>Space</strong> is how we perceive the spatial distribution of instruments within a recording; these
    filters emphasize the content's soundstage.
  </p>
</div>`;
const PhaseHint = html`<div class="rate-note t-caption">
  <strong>HQPTuner Hints:</strong> Phase sets where a filter smears transients in time, through ringing: a
  trade-off between transient reproduction and spatial accuracy. Linear phase lands all frequencies together for
  spatial accuracy, but pre-rings, smearing the transient into the time before it occurs. Minimum phase delays
  higher frequencies relative to lower, marring the sense of space, but has no pre-ringing and so more natural
  transients. Intermediate phase rings asymmetrically, more after the transient than before.
</div>`;
const LengthHint = html`<div class="rate-note t-caption">
  <strong>HQPTuner Hints:</strong> Length represents a trade-off between cleaner transients and an improved sense of
  space through better filtering or junk removal. Shorter filters ring less and produce cleaner transients at the
  cost of less filtering; longer filters smear transients more in time but are more capable at filtering the junk.
</div>`;

// The phase and length dropdowns, out of the assembly the way RateFacet is:
// each is one MultiSelect wired to its facet's signals, closed by its hint.
function PhaseFacet() {
  return html`<${MultiSelect}
    open=${phaseOpen}
    name="phase"
    label=${phaseLabel()}
    items=${PHASES}
    sig=${nPhase}
    active=${!!nPhase.value.length}
    count=${phasePick}
    off=${(/** @type {string} */ v) => tagRowOff(nPhase.value, v, phaseSolo(v), phasePick(v))}
    extra=${PhaseHint}
  />`;
}
function LengthFacet() {
  return html`<${MultiSelect}
    open=${lengthOpen}
    name="length"
    label=${lengthLabel()}
    items=${LENGTHS}
    sig=${nLength}
    active=${!!nLength.value.length}
    count=${lengthPick}
    off=${(/** @type {string} */ v) => tagRowOff(nLength.value, v, lengthSolo(v), lengthPick(v))}
    extra=${LengthHint}
  />`;
}

/**
 * Renders the facet row: the genre, quality, focus, phase, length and ratio
 * dropdowns plus the favorites toggle. Each dropdown's `count` maps a candidate
 * option to the narrowing override its chip counts against, and each tag
 * facet's `off` asks that same override whether the pick would change anything.
 *
 * Quality carries no `off`: its rows are ordered floors rather than tags, and a
 * floor that changes nothing usually means every filter already clears it.
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
        count=${genrePick}
        off=${(/** @type {string} */ v) => genreRowOff(v) || tagRowOff(nGenre.value, v, genreSolo(v), genrePick(v))}
        extra=${html`<${ModeSwitch} sig=${nGenreMode} />`}
      />
      <${SingleSelect}
        open=${qualityOpen}
        name="quality"
        label=${oneLabel(QUALITY, nQuality.value, "Any quality")}
        value=${nQuality.value}
        items=${QUALITY}
        onPick=${(/** @type {string | number} */ v) => (nQuality.value = Number(v))}
        active=${Number(nQuality.value) !== QUALITY_DEFAULT}
        count=${(/** @type {string | number} */ v) => ({ quality: Number(v) })}
        extra=${QualityHint}
      />
      <${MultiSelect}
        open=${focusOpen}
        name="focus"
        label=${focusLabel()}
        items=${FOCUS}
        sig=${nFocus}
        active=${!!nFocus.value.length}
        count=${focusPick}
        off=${(/** @type {string} */ v) => tagRowOff(nFocus.value, v, focusSolo(v), focusPick(v))}
        extra=${html`<${ModeSwitch} sig=${nFocusMode} />${FocusHint}`}
      />
      <${PhaseFacet} />
      <${LengthFacet} />
      <${RateFacet} />
    </div>
  `;
}

// One hide-rule row of the rate-change popover: a checkbox showing the rule's
// EFFECTIVE state, with the count preview of the state clicking it lands on.
// Clicking writes the explicit opposite of what the box shows — from "auto"
// that is an override, and only overrides highlight the facet button.
/**
 * @param {{ on: boolean, label: string, code: string, onToggle: () => void,
 *           count: import("./labels.js").NarrowOverrides }} props
 */
function RateRule({ on, label, code, onToggle, count }) {
  return html`<label data-v=${code}>
    <${CountChip} overrides=${count} />
    <input type="checkbox" checked=${on} onChange=${onToggle} />
    <span class="opt-label">${label}</span>
  </label>`;
}

// The rate-change facet. The manual's ratio column names limitations, so the
// popover offers hide rules for the scenarios where a limitation bites —
// cross-family (fractional) conversion and downsampling — never a "show only
// limitation X" pick. The favorites toggle closes the row: it needs a starred
// filter to be reachable.
function RatePop() {
  return html`<div class="multi-pop rate-pop">
    <div class="multi-head t-label">1x / Nx</div>
    <${RateRule}
      on=${effHideLimited.value}
      onToggle=${() => (nHideLimited.value = effHideLimited.value ? "off" : "on")}
      label="Hide output rate-limited filters"
      code="hide-limited"
      count=${{ hideLimited: !effHideLimited.value }}
    />
    <${RateRule}
      on=${nDownsafeOnly.value}
      onToggle=${() => (nDownsafeOnly.value = !nDownsafeOnly.value)}
      label="Show only filters that support downsampling"
      code="downsafe"
      count=${{ downsafeOnly: !nDownsafeOnly.value }}
    />
    <${RateRule}
      on=${nOddRateOnly.value}
      onToggle=${() => (nOddRateOnly.value = !nOddRateOnly.value)}
      label="Show only filters that support resampling uncommon source rates (e.g., 32kHz)"
      code="odd-rates"
      count=${{ oddOnly: !nOddRateOnly.value }}
    />
    <div class="rate-note t-caption">
      <strong>HQPTuner Hints:</strong> Rate-limited filters are only capable of output rates that are whole-number
      or factor-of-two multiples of the source rate. For example, given a 48kHz source file, such filters cannot
      resample to 44.1kHz-family output rates: they are restricted to PCM output at 2x48k, 4x48k, 8x48k, … and DSD
      at 64x48k, 128x48k, 256x48k, … If your output mode is SDM and your DAC doesn't support 48kHz-family DSD
      rates, these filters will produce no output when fed 48k-family source files; hide them with the checkbox
      above.
    </div>
  </div>`;
}

function RateFacet() {
  const active = nHideLimited.value !== RATE_RULE_DEFAULT || nOddRateOnly.value || nDownsafeOnly.value;
  return html`
      <div class="multi" data-multi="rate">
        <button type="button" class="multi-btn ${active ? "active" : ""}" onClick=${() => (rateOpen.value = !rateOpen.value)}>
          ${rateLabel()}<span class="multi-caret"></span>
        </button>
        ${rateOpen.value ? html`<${RatePop} />` : null}
      </div>
      <button
        type="button"
        class="multi-btn ${nFavOnly.value ? "active" : ""}"
        disabled=${!favoriteFilters.value.size && !favoriteModulators.value.size}
        title=${
          favoriteFilters.value.size || favoriteModulators.value.size
            ? "Show only the filters and modulators you favorited in the dropdowns below"
            : "Favorite a filter or modulator below to enable"
        }
        onClick=${() => (nFavOnly.value = !nFavOnly.value)}
      >
        ♥ Favorites
      </button>
  `;
}
