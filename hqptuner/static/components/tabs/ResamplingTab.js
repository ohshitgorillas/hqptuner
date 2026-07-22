// Resampling tab: filter narrowing bar, the PCM/SDM filter chains, DSD-source
// decoding, and FFT filter length.
import { signal, computed } from "@preact/signals";
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
const dsdOpen = computed(() => effective("output_mode") !== "pcm");
const pcmOverride = signal(null);
const sdmOverride = signal(null);
const dsdOverride = signal(null);

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
      <div class="pack chain">
        <${Field} k="pcm_filter_1x" />
        <${Field} k="pcm_filter_nx" />
        <${Field} k="pcm_dither" />
      </div>
    <//>
    <${Collapsible} title="SDM" auto=${sdmOpen} override=${sdmOverride}>
      <div class="pack chain">
        <${Field} k="sdm_filter_1x" />
        <${Field} k="sdm_filter_nx" />
        <${Field} k="sdm_modulator" />
      </div>
    <//>
    <${Collapsible} title="DSD sources" auto=${dsdOpen} override=${dsdOverride}>
      <div class="pack">
        <${Field} k="direct_sdm" />
        <${Field} k="dsd_gain_6db" />
      </div>
      <!-- chain: each column is one conversion path, stacked in signal order —
           SDM in (Integrator, then SDM → SDM) left, SDM out (Noise filter, then
           SDM → PCM) right. Row order would pair them across the divider, which
           reads as a relation they don't have. -->
      <div class="pack chain">
        <${Field} k="sdm_integrator" />
        <${Field} k="sdm_conversion" />
        <${Field} k="noise_filter" />
        <${Field} k="pcm_conversion" />
      </div>
    <//>
    <${Collapsible} title="Filter length" auto=${fftOpen} override=${fftOverride}>
      <${Field} k="fft_size" />
    <//>
  <//>`;
