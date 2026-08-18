// The narrowing bar's second row: the apodizing and lossy segmented switches,
// their segment tables and their captions. Its own module because this row is a
// different control family from the facet dropdowns — segments over stage
// signals, not popovers over facet values — and shares no state with them.
import { html } from "../../lib/dom.js";
import { effective } from "../../store/resolve.js";
import { optionsFor } from "../../store/options.js";
import { metadata } from "../../store/signals.js";
import { Segment } from "../controls/index.js";
import { previewCount } from "../../store/narrow/match.js";
import { notesVisible } from "../../store/prefs.js";

/**
 * @typedef {{ value: string }} StageSignal
 * @typedef {{ value: string, label: string, ov: import("./labels.js").NarrowOverrides }} StageSegment
 */

// Segmented switches: every segment names the LIST YOU GET, never an action,
// and the leftmost segment is uniformly "narrowing off", so any switch not on
// it reads as narrowing at a glance. `ov` is the selection override that
// segment stands for, merged onto the live facets to preview how many filters
// the pick would leave (the count inside each button).
export const APOD_SEGS = [
  { value: "all", label: "All", ov: { apod: false, half: false } },
  { value: "only", label: "Only", ov: { apod: true, half: false } },
  { value: "half", label: "+½", ov: { apod: true, half: true } },
];
export const LOSSY_SEGS = [
  { value: "both", label: "Both", ov: { lossy: "" } },
  { value: "lossless", label: "Lossless", ov: { lossy: "lossless" } },
  { value: "lossy", label: "Lossy", ov: { lossy: "lossy" } },
];

// Source format carries no `ov`: it narrows no dropdown, so there is no
// selection to preview and no count to show. It discloses the chain cards' DSD
// Sources subsections instead (components/tabs/ConversionCards.js), which is why
// its row is a bare Segment rather than a StageSeg.
export const SRC_FORMAT_SEGS = [
  { value: "pcm", label: "PCM only" },
  { value: "both", label: "+DSD" },
];

// The manual's apodizing explainer (data/settings.json dsp.apodizing tooltip) —
// a caption under the switch row, following the feature-description master like
// every other static note: hidden when it is off, hover tip instead.
/** The apodizing caption text, read from the loaded metadata's dsp.apodizing tooltip; empty string when absent. */
export function apodTip() {
  const s = (metadata.value && metadata.value.settings) || {};
  const e = s.dsp && s.dsp.apodizing;
  return (e && e.tooltip) || "";
}

export const LOSSY_TIP =
  'This feature determines whether to show or hide filters capable of reducing ultrasonic noise (containing "hires" or "mp3/mqa" in the name) in the 1x filter dropdowns. ' +
  "At 1x rates, this only benefits lossy material like MP3 and MQA; lossless material contains no ultrasonic content to attenuate. " +
  'Selecting "Lossless" hides these filters; "Lossy" shows them only.';

// The "Option style" switch (store/prefs.js plainNames): Simplified re-renders
// the six chain dropdowns with the plain-names overlay's grouped plain-English
// text; Standard is the raw engine names, untouched.
export const OPTION_STYLE_SEGS = [
  { value: "standard", label: "Standard" },
  { value: "simplified", label: "Simplified" },
];

export const OPTION_STYLE_TIP =
  "This feature reduces the mental load required to parse the filter, dither, and modulator lists by stating each selection's properties in plain English. " +
  "Items are categorized into families, optionally into variants, and listed by their distinguishing properties.";

export const SRC_FORMAT_TIP =
  "The vast majority of music is packaged as PCM: if you're using streaming services only, leave this setting alone. " +
  'If you have a personal library with DSD files (*.DSF and *.DFF), select "+DSD" to show the chain settings for these sources as well.';

// One stage's switch row: muted stage micro-label, the segment, then preview
// counts trailing the switch in button order — how many filters in that stage's
// ACTIVE-chain list (PCM unless the output mode is SDM) each pick would leave
// under the other live facets.
/**
 * Renders one stage's switch row: the 1x/Nx micro-label, the segmented control
 * bound to `sig`, and the per-segment preview counts trailing it. `showStage`
 * drops the micro-label for a single-row group whose title already names the
 * stage.
 * @param {{ stage: string, sig: StageSignal, options: StageSegment[], showStage?: boolean }} props
 */
export function StageSeg({ stage, sig, options, showStage = true }) {
  const sdm = effective("output_mode") === "sdm";
  const one = stage === "1x";
  const cfgKey = one ? (sdm ? "oversampling1x" : "filter1x") : sdm ? "oversampling" : "filter";
  const field = one ? (sdm ? "sdm_filter_1x" : "pcm_filter_1x") : sdm ? "sdm_filter_nx" : "pcm_filter_nx";
  const list = optionsFor("config", cfgKey);
  const counts = options.map((o) => previewCount(list, stage, field, o.ov));
  return html`
    <div class="narrow-stage-row">
      ${showStage ? html`<span class="t-label">${one ? "1x" : "Nx"}</span>` : null}
      <${Segment} value=${sig.value} options=${options} onChange=${(/** @type {string} */ v) => (sig.value = v)} />
      <span class="narrow-count">${counts.join(" · ")}</span>
    </div>
  `;
}

// One function group: title beside its stage rows, description under the rows
// in the same column. The description is a static feature note, so it follows
// the feature-description master: caption when on, hover tip when off.
/**
 * Renders one function group: its title beside the stage rows passed as
 * children, with `desc` as a caption under them in the same column when feature
 * descriptions are shown, and as the group's hover title when they are hidden.
 * @param {{ title: string, desc?: string, children?: unknown }} props
 */
export function SwitchGroup({ title, desc, children }) {
  const show = desc && notesVisible.value;
  return html`
    <div class="narrow-group" title=${show ? "" : desc || ""}>
      <span class="t-label narrow-group-title">${title}</span>
      <div class="narrow-group-body">
        ${children}
        ${show ? html`<div class="t-caption">${desc}</div>` : null}
      </div>
    </div>
  `;
}
