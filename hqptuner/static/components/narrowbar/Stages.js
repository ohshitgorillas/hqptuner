// The narrowing bar's second row: the per-stage apodizing / hi-res segmented
// switches, their segment tables and their captions. Its own module because this
// row is a different control family from the facet dropdowns — segments over
// stage signals, not popovers over facet values — and shares no state with them.
import { html } from "../../lib/dom.js";
import { effective } from "../../store/resolve.js";
import { optionsFor } from "../../store/options.js";
import { metadata } from "../../store/signals.js";
import { Segment } from "../controls/index.js";
import { previewCount } from "../../store/narrowing.js";

/**
 * @typedef {{ value: string }} StageSignal
 * @typedef {{ value: string, label: string, ov: import("./labels.js").NarrowOverrides }} StageSegment
 */

// Per-stage segmented switches: every segment names the LIST YOU GET, never an
// action — "All" is uniformly "narrowing off", so any switch not on its
// leftmost/neutral value reads as narrowing at a glance. `ov` is the selection
// override that segment stands for, merged onto the live facets to preview how
// many filters the pick would leave (the count inside each button).
export const APOD_SEGS = [
  { value: "all", label: "All", ov: { apod: false, half: false } },
  { value: "only", label: "Only", ov: { apod: true, half: false } },
  { value: "half", label: "+½", ov: { apod: true, half: true } },
];
export const HIRES_1X_SEGS = [
  { value: "show", label: "Show", ov: { hideHires: false } },
  { value: "hide", label: "Hide", ov: { hideHires: true } },
];
export const HIRES_NX_SEGS = [
  { value: "all", label: "All", ov: { hiresOnly: false } },
  { value: "only", label: "Only", ov: { hiresOnly: true } },
];

// The manual's apodizing explainer (data/settings.json dsp.apodizing tooltip) —
// stays a VISIBLE caption under the switch row (user decision), as it was under
// the 1x dropdowns.
export function apodTip() {
  const s = (metadata.value && metadata.value.settings) || {};
  const e = s.dsp && s.dsp.apodizing;
  return (e && e.tooltip) || "";
}

export const HIRES_TIP =
  "Hi-res filters suit high-rate sources and lossy material like MP3 and MQA. " +
  "Use them at 1x for lossy sources; at Nx, Only narrows to filters built for them.";

// One stage's switch row: muted stage micro-label, the segment, then preview
// counts trailing the switch in button order — how many filters in that stage's
// ACTIVE-chain list (PCM unless the output mode is SDM) each pick would leave
// under the other live facets.
/**
 * @param {{ stage: string, sig: StageSignal, options: StageSegment[] }} props
 */
export function StageSeg({ stage, sig, options }) {
  const sdm = effective("output_mode") === "sdm";
  const one = stage === "1x";
  const cfgKey = one ? (sdm ? "oversampling1x" : "filter1x") : sdm ? "oversampling" : "filter";
  const field = one ? (sdm ? "sdm_filter_1x" : "pcm_filter_1x") : sdm ? "sdm_filter_nx" : "pcm_filter_nx";
  const list = optionsFor("config", cfgKey);
  const counts = options.map((o) => previewCount(list, stage, field, o.ov));
  return html`
    <div class="narrow-stage-row">
      <span class="t-label">${one ? "1x" : "Nx"}</span>
      <${Segment} value=${sig.value} options=${options} onChange=${(/** @type {string} */ v) => (sig.value = v)} />
      <span class="narrow-count">${counts.join(" · ")}</span>
    </div>
  `;
}

// One function group: title beside its two stage rows, description under the
// rows in the same column.
/**
 * @param {{ title: string, desc?: string, cls?: string, children?: unknown }} props
 */
export function SwitchGroup({ title, desc, cls, children }) {
  return html`
    <div class="narrow-group ${cls || ""}">
      <span class="t-label narrow-group-title">${title}</span>
      <div class="narrow-group-body">
        ${children}
        ${desc ? html`<div class="t-caption">${desc}</div>` : null}
      </div>
    </div>
  `;
}
