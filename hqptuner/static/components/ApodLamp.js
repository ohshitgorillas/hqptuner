// The header's apodizing indicator: a jewel lamp on the chrome row, off unless
// the preference in the System tab's HQPTuner card switches it on.
//
// It is the Engine health strip's reading condensed to one pixel of panel. Both
// take the same scale (lib/apodscale.js), and the lamp spends it on brightness
// where the strip spends it on color: a lamp whose rest state is a painted floor
// is a lamp that is lit whenever the page is up, and an indicator that is always
// on indicates nothing.
//
// On "all" the two agree about the same music by construction. On "uncorrected"
// they part company, and that is the whole point of that mode: the strip keeps
// painting every event, while the lamp reports only what the running filter left
// uncorrected, so a full apodizing filter paints the strip hot and leaves the
// jewel dark. The scale is still shared; the correction is applied after it,
// here, and nowhere else.
//
// What the component publishes is the PEAK for the newest bin TIMES that
// correction, on the --lamp custom property. The decay is CSS's affair (css/base/header.css), and what
// restarts it on every bin is the jewel alternating between two class names that
// name two identical keyframes: a running animation restarts when its NAME
// changes, and nothing else here is allowed to depend on the DOM node being
// replaced.
//
// Keying the jewel on the bin sequence was the first attempt and it does not
// work. The template's own whitespace lands as unkeyed text children beside it,
// which puts preact back on matching children by position, so the node is reused
// across a change of key however the key moves — and a reused node never re-runs
// its animation. Measured: the lamp flashed once on mount and sat dark through
// every bin after that. Fast attack and slow release is what an
// incandescent jewel does when its filament heats and cools, and it is also the
// only envelope that reads as a flash rather than a level meter, since ordinary
// playback on an apodizing filter never stops producing events.
import { computed } from "@preact/signals";
import { html } from "../lib/dom.js";
import { rateOf, intensity } from "../lib/apodscale.js";
import { apodBins, apodBinSeq } from "../store/apodhistory.js";
import { apodLight } from "../store/prefs.js";
import { fastPollMs } from "../store/ui.js";
import { engineStatus } from "../store/signals.js";
import { filterFacets } from "../store/narrow/facets.js";

// Release runs at a quarter of the poll interval, so the lamp is back at rest
// well before the next bin can land. Pinning it to a constant would run flashes
// into one another in LIVE, whose 1 s cadence is twice the rate the 2 s tabs poll
// at, and a lamp that never returns to dark is the level meter again.
const DECAY_FRACTION = 4;

// The newest bin's reading. An empty history is dark rather than absent: the
// preference is on, so the lamp is on the panel, unlit, which is the state that
// tells a reader it works and is quiet.
const peak = computed(() => {
  const all = apodBins.value;
  const bin = all.length ? all[all.length - 1] : null;
  return bin ? intensity(rateOf(bin)) : 0;
});

// What the running filter is already doing about the events the counter scored.
// Half is read before full: the two facts come off independent bits of the
// enumeration's `arg` (store/narrow/facets.js), so a record can carry both, and
// a record carrying both is a half-apodizing filter — reading full first would
// take it dark instead of to half. A filter the facet table does not hold
// corrects nothing as far as this lamp is concerned, which is the reading that
// keeps a monitor honest when it cannot tell.
const HALF = 0.5;

const correction = computed(() => {
  if (apodLight.value !== "uncorrected") return 1;
  const st = engineStatus.value && engineStatus.value.status;
  const name = st && st.active_filter;
  const facet = name ? filterFacets.value[name] : undefined;
  if (!facet) return 1;
  if (facet.apodizingHalf) return HALF;
  return facet.apodizing ? 0 : 1;
});

/** The header's apodizing jewel lamp, or nothing at all when the preference is off. */
export function ApodLamp() {
  if (apodLight.value === "off") return null;
  const lamp = peak.value * correction.value;
  const style = `--lamp: ${lamp.toFixed(3)}; --lamp-decay: ${Math.round(fastPollMs.value / DECAY_FRACTION)}ms`;
  return html`
    <span class="apod-lamp" data-testid="apod-lamp" title="Apodizing activity" aria-hidden="true" style=${style}>
      <span class="apod-jewel apod-flash-${apodBinSeq.value % 2}"></span>
      <span class="apod-legend">APOD</span>
    </span>
  `;
}
