// The header's apodizing indicator: a jewel lamp on the chrome row, off unless
// the preference in the System tab's HQPTuner card switches it on.
//
// It is the Engine health strip's reading condensed to one pixel of panel. Both
// take the same scale (lib/apodscale.js), so the lamp and the strip never
// disagree about the same music, but the lamp spends it on brightness where the
// strip spends it on color: a lamp whose rest state is a painted floor is a lamp
// that is lit whenever the page is up, and an indicator that is always on
// indicates nothing.
//
// What the component publishes is the PEAK for the newest bin, on the --lamp
// custom property. The decay is CSS's affair (css/base/header.css): the jewel
// carries the bin sequence as its key, so every recorded bin remounts it and
// restarts the flash from that peak. Fast attack and slow release is what an
// incandescent jewel does when its filament heats and cools, and it is also the
// only envelope that reads as a flash rather than a level meter, since ordinary
// playback on an apodizing filter never stops producing events.
import { computed } from "@preact/signals";
import { html } from "../lib/dom.js";
import { rateOf, intensity } from "../lib/apodscale.js";
import { apodBins, apodBinSeq } from "../store/apodhistory.js";
import { apodLight } from "../store/prefs.js";
import { fastPollMs } from "../store/ui.js";

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

/** The header's apodizing jewel lamp, or nothing at all when the preference is off. */
export function ApodLamp() {
  if (!apodLight.value) return null;
  const style = `--lamp: ${peak.value.toFixed(3)}; --lamp-decay: ${Math.round(fastPollMs.value / DECAY_FRACTION)}ms`;
  return html`
    <span class="apod-lamp" data-testid="apod-lamp" title="Apodizing activity" aria-hidden="true" style=${style}>
      <span class="apod-jewel" key=${apodBinSeq.value}></span>
      <span class="apod-legend">APOD</span>
    </span>
  `;
}
