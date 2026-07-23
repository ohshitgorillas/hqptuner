// Resampling tab: filter narrowing bar, the PCM and SDM output cards, and FFT
// filter length. Each output card is split by SOURCE type — a "PCM Sources"
// subsection (how a PCM source is handled for that output) and an "SDM Sources"
// subsection (how a DSD/SDM source is handled) — with a mode-mismatch note at
// the top when the current output mode doesn't use the card.
import { signal, computed, effect } from "@preact/signals";
import { html } from "../../lib/dom.js";
import { Field } from "../Field.js";
import { effective } from "../../store/state.js";
import { optionsFor } from "../../store/options.js";
import { NarrowBar } from "../NarrowBar.js";
import { Section, Collapsible } from "./common.js";

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
effect(() => {
  void effective("output_mode");
  pcmOverride.value = null;
  sdmOverride.value = null;
});

// FFT filter length configures the FFT-based resampling filters only (readme
// §1.2 fft_size), so the card follows the selection instead of sitting open
// permanently. Any of the four filter slots can select an FFT filter, so all
// four are checked. The stored value is the engine's list INDEX, which is
// volatile (outline §2) — match on the option's name, never on the number.
const FILTER_CONTROLS = [
  ["pcm_filter_1x", "filter1x"],
  ["pcm_filter_nx", "filter"],
  ["sdm_filter_1x", "oversampling1x"],
  ["sdm_filter_nx", "oversampling"],
];
const fftOpen = computed(() =>
  FILTER_CONTROLS.some(([key, field]) => {
    const v = String(effective(key));
    const opt = optionsFor("config", field).find((o) => String(o.value) === v);
    return !!opt && /\bFFT\b/i.test(opt.label);
  }),
);
const fftOverride = signal(null);

export const Resampling = () =>
  html`<${Section}>
    <${NarrowBar} />
    <${Collapsible} title="PCM" auto=${pcmOpen} override=${pcmOverride}>
      ${effective("output_mode") === "sdm" ? html`<div class="section-note">Output mode is SDM. These settings have no effect.</div>` : null}
      <div class="subhead">PCM Sources</div>
      <div class="pack chain">
        <${Field} k="pcm_filter_1x" />
        <${Field} k="pcm_filter_nx" />
        <${Field} k="pcm_dither" />
      </div>
      <div class="subhead">SDM Sources</div>
      <div class="pack chain">
        <${Field} k="noise_filter" />
        <${Field} k="pcm_conversion" />
        <${Field} k="dsd_gain_6db" />
      </div>
    <//>
    <${Collapsible} title="SDM" auto=${sdmOpen} override=${sdmOverride}>
      ${effective("output_mode") === "pcm" ? html`<div class="section-note">Output mode is PCM. These settings have no effect.</div>` : null}
      <div class="subhead">PCM Sources</div>
      <div class="pack chain">
        <${Field} k="sdm_filter_1x" />
        <${Field} k="sdm_filter_nx" />
        <${Field} k="sdm_modulator" />
      </div>
      <div class="subhead">SDM Sources</div>
      <div class="pack chain">
        <${Field} k="sdm_integrator" />
        <${Field} k="sdm_conversion" />
        <${Field} k="direct_sdm" />
      </div>
    <//>
    <${Collapsible} title="Filter length" auto=${fftOpen} override=${fftOverride}>
      <${Field} k="fft_size" />
    <//>
  <//>`;
