// Per-1x-dropdown apodizing narrow control. Renders below a 1x filter dropdown
// (schema `apodNarrow`, Field.js), bound to THAT chain's independent apod state
// (keyed by the field key in store/narrowing.js). Apodizing narrowing is 1x-only
// and per-chain (user decision 2026-07-24) — moved here from the shared narrow
// bar so PCM and SDM 1x lists narrow independently.
//
// The caption is the existing settings tooltip verbatim (data/settings.json
// dsp.show_apodizing_only) — a novice-facing "what is apodizing" line, now
// visible instead of hover-only.
import { html } from "../lib/dom.js";
import { metadata } from "../store/state.js";
import { nApod, nApodHalf, setApod, setApodHalf } from "../store/narrowing.js";

function apodTip() {
  const s = (metadata.value && metadata.value.settings) || {};
  const e = s.dsp && s.dsp.apodizing;
  return (e && e.tooltip) || "";
}

export function ApodNarrow({ field }) {
  const on = nApod.value[field] === true;
  const half = nApodHalf.value[field] === true;
  const tip = apodTip();
  return html`
    <div class="apod-narrow">
      <label class="narrow-apod">
        <input type="checkbox" checked=${on} onChange=${(e) => setApod(field, e.target.checked)} />
        Show apodizing only
      </label>
      <label class="narrow-apod apod-sub ${on ? "" : "off"}">
        <input
          type="checkbox"
          checked=${half}
          disabled=${!on}
          onChange=${(e) => setApodHalf(field, e.target.checked)}
        />
        Show ½ apodizing filters
      </label>
      ${tip ? html`<div class="apod-narrow-note">${tip}</div>` : null}
    </div>
  `;
}
