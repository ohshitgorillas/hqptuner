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
import { nApod, nApodHalf, nHideHires, nHiresOnly, setApod, setApodHalf, setHideHires, setHiresOnly } from "../store/narrowing.js";

function apodTip() {
  const s = (metadata.value && metadata.value.settings) || {};
  const e = s.dsp && s.dsp.apodizing;
  return (e && e.tooltip) || "";
}

// 1x-dropdown narrow control: apodizing (+½) and the hide-hi-res toggle. All
// three bind to THIS chain's own keyed state (store/narrowing.js). Hide-hi-res
// defaults ON — at 1x (base source rates) the hi-res / MQA-MP3 filters are the
// off-topic entries, so they start hidden and the checkbox reveals them.
export function ApodNarrow({ field }) {
  const on = nApod.value[field] === true;
  const half = nApodHalf.value[field] === true;
  const hideHires = nHideHires.value[field] === true;
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
      <label class="narrow-apod narrow-hires">
        <input type="checkbox" checked=${hideHires} onChange=${(e) => setHideHires(field, e.target.checked)} />
        Hide hi-res filters
      </label>
      <div class="apod-narrow-note">
        Hi-res filters are optimal for lossy material such as mp3 and MQA at 1x.
      </div>
    </div>
  `;
}

// Nx-dropdown narrow control: the inverse hi-res toggle. Off by default — check
// it to restrict the Nx list to the hi-res poly-sinc / MQA-MP3 filters only.
export function HiresNarrow({ field }) {
  const only = nHiresOnly.value[field] === true;
  return html`
    <div class="apod-narrow">
      <label class="narrow-apod narrow-hires">
        <input type="checkbox" checked=${only} onChange=${(e) => setHiresOnly(field, e.target.checked)} />
        Show only hi-res filters
      </label>
      <div class="apod-narrow-note">Restricts the list to the hi-res poly-sinc and MQA/MP3 filters.</div>
    </div>
  `;
}
