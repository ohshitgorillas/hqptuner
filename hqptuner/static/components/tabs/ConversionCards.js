// Conversion cards, rendered on the Output tab: pre-process, the PCM and SDM
// output cards, and FFT filter length. Each output card is split by SOURCE
// type — a "PCM Sources" subsection (how a PCM source is handled for that
// output) and a "DSD Sources" subsection (how a DSD/SDM source is handled) —
// with a mode-mismatch note at the top when the current output mode doesn't
// use the card.
//
// The DSD Sources half is collapsible and starts shut: most libraries are
// entirely PCM, so its three controls are dead weight for most users. The narrow
// bar's "Source format" switch is its auto driver, one control opening the
// subsection in BOTH cards at once — which is the whole reason it is a narrow-bar
// facet rather than a second copy of the subhead button.
import { signal, computed, effect } from "@preact/signals";
import { html } from "../../lib/dom.js";
import { Field } from "../Field.js";
import { ChainPack } from "../ChainPack.js";
import { effective } from "../../store/resolve.js";
import { optionsFor } from "../../store/options.js";
import { Card, Tri, collapseFrom } from "../common.js";
import { nSrcFormat } from "../../store/narrow/state.js";

// DSP chain cards auto-open by mode (auto shows both). PCM chain is irrelevant
// in pure SDM mode and vice-versa; DSD-source decoding is irrelevant in PCM.
const pcmOpen = computed(() => effective("output_mode") !== "sdm");
const sdmOpen = computed(() => effective("output_mode") !== "pcm");
const pcmOverride = signal(null);
const sdmOverride = signal(null);

// A manual collapse (override non-null) otherwise wins forever, shadowing `auto`
// — so a card the user once closed stays closed even after they switch to the
// mode that needs it (collapse PCM in Auto, later select PCM → stuck shut). Drop
// both overrides whenever the mode changes, so each switch re-asserts the auto
// disclosure; a manual toggle still wins until the next mode change.
//
// Guard on the RESOLVED mode changing, not on the effect merely re-firing:
// effective() reads the whole staged + liveOverride signal maps, so ANY field
// edit re-runs this effect. Without the guard, editing an unrelated setting
// wipes the override and slams a card the user just opened shut.
/** @type {string | number | boolean | undefined} */
let prevMode;
effect(() => {
  const mode = effective("output_mode");
  if (mode === prevMode) return;
  prevMode = mode;
  pcmOverride.value = null;
  sdmOverride.value = null;
});

// The DSD Sources subsections. One auto driver — the narrow bar's source-format
// switch — and an override PER CARD: a user who shuts PCM Chain's copy is saying
// something about that card, not about SDM Chain's. Both overrides drop whenever
// the switch moves, so flipping to "+DSD" re-opens a section the user once shut,
// the same re-assertion the mode change does for the chain cards above.
const dsdOpen = computed(() => nSrcFormat.value === "both");
const pcmDsdOverride = signal(null);
const sdmDsdOverride = signal(null);

/** @type {string | undefined} */
let prevSrcFormat;
effect(() => {
  const fmt = nSrcFormat.value;
  if (fmt === prevSrcFormat) return;
  prevSrcFormat = fmt;
  pcmDsdOverride.value = null;
  sdmDsdOverride.value = null;
});

// Both subheads carry `data-sources` — "pcm" or "dsd". The heading's own wording
// is copy the owner may reword, so the attribute is what identifies a subsection
// (docs/testing.md rule 9); nothing may select one by the words it reads.
//
// A subhead that is its own toggle, the way a collapsible card's head is. Not a
// Card: a card nested in a card body is the wrong frame for a subsection, and
// .subhead already carries the type this heading wants.
/**
 * Renders the "DSD Sources" subhead as a toggle, with its body only when open.
 * @param {{ collapse: import("../common.js").CollapseHandle, children?: unknown }} props
 */
function DsdSection({ collapse, children }) {
  return html`
    <button type="button" class="subhead" data-sources="dsd" onClick=${collapse.onToggle}>
      ${Tri(collapse.open)} DSD Sources
    </button>
    ${collapse.open ? children : null}
  `;
}

// FFT filter length configures the FFT-based resampling filters only (readme
// §1.2 fft_size), so the card follows the selection instead of sitting open
// permanently. Any of the four filter slots can select an FFT filter, so all
// four are checked.
//
// The stored value is the ENUM ID — these four are http-lane controls whose
// baseline comes from the daemon's own /config form, and the form's option
// values are enum ids, not list positions. (The live 4321 lane is the one that
// speaks list indices; the two domains must never be mixed, protocol.md §4.)
// Either way the number is volatile across engine versions (architecture §2), so
// match on the option's name and never on the number.
const FILTER_CONTROLS = [
  ["pcm_filter_1x", "filter1x"],
  ["pcm_filter_nx", "filter"],
  ["sdm_filter_1x", "oversampling1x"],
  ["sdm_filter_nx", "oversampling"],
];
const fftOpen = computed(() =>
  FILTER_CONTROLS.some(([key, field]) => {
    const v = String(effective(key));
    const opt = optionsFor("config", field).find((/** @type {OptionItem} */ o) => String(o.value) === v);
    return !!opt && /\bFFT\b/i.test(opt.label);
  }),
);
const fftOverride = signal(null);

/** Pre-process card: the junk filter and pre-before-meter toggles. */
export const PreProcessCard = () =>
  html`<${Card} id="pre-process" title="Pre-process">
    <div class="pack">
      <${Field} k="junk_filter" />
      <${Field} k="pre_before_meter" />
    </div>
  <//>`;

/** PCM chain card, noting when the output mode makes it inert. */
export const PcmChainCard = () =>
  html`<${Card} id="pcm-chain" title="PCM Chain" collapse=${collapseFrom(pcmOpen, pcmOverride)}>
    ${effective("output_mode") === "sdm" ? html`<div class="section-note" data-note="mode-mismatch">Output mode is SDM. These settings have no effect.</div>` : null}
    <div class="subhead" data-sources="pcm">PCM Sources</div>
    <${ChainPack}>
      <${Field} k="pcm_filter_1x" />
      <${Field} k="pcm_filter_nx" />
      <${Field} k="pcm_dither" />
    <//>
    <${DsdSection} collapse=${collapseFrom(dsdOpen, pcmDsdOverride)}>
      <${ChainPack}>
        <${Field} k="noise_filter" />
        <${Field} k="pcm_conversion" />
        <${Field} k="dsd_gain_6db" />
      <//>
    <//>
  <//>`;

/** SDM chain card, noting when the output mode makes it inert. */
export const SdmChainCard = () =>
  html`<${Card} id="sdm-chain" title="SDM Chain" collapse=${collapseFrom(sdmOpen, sdmOverride)}>
    ${effective("output_mode") === "pcm" ? html`<div class="section-note" data-note="mode-mismatch">Output mode is PCM. These settings have no effect.</div>` : null}
    <div class="subhead" data-sources="pcm">PCM Sources</div>
    <${ChainPack}>
      <${Field} k="sdm_filter_1x" />
      <${Field} k="sdm_filter_nx" />
      <${Field} k="sdm_modulator" />
    <//>
    <${DsdSection} collapse=${collapseFrom(dsdOpen, sdmDsdOverride)}>
      <${ChainPack}>
        <${Field} k="sdm_integrator" />
        <${Field} k="sdm_conversion" />
        <${Field} k="direct_sdm" />
      <//>
    <//>
  <//>`;

/** Filter length card, open while any filter slot selects an FFT filter. */
export const FilterLengthCard = () =>
  html`<${Card} id="filter-length" title="Filter length" collapse=${collapseFrom(fftOpen, fftOverride)}>
    <${Field} k="fft_size" />
  <//>`;
