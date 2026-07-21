// DSP tab: the post-processing pair (crossfeed + loudness), controls on top,
// a full-width response plot across the bottom. When the feature checkbox is
// off, the body (sub-controls + plot) dims as a unit — the sub-controls also
// go non-interactive via their grayWhen.
import { html } from "../../lib/dom.js";
import { Field } from "../Field.js";
import { effective } from "../../store/state.js";
import { grayReason } from "../../store/graying.js";
import { CrossfeedPlot, LoudnessPlot } from "../plots.js";
import { Section, Card, truthy } from "./common.js";

export function CrossfeedCard() {
  const on = truthy(effective("crossfeed_enabled"));
  return html`
    <${Card} title="Crossfeed">
      <div class="dsp-card">
        <div class="pack split">
          <${Field} k="crossfeed_enabled" />
          <${Field} k="crossfeed_preset" />
        </div>
        <div class="dsp-body ${on ? "" : "off"}">
          <div class="knob-cluster">
            <${Field} k="crossfeed_frequency" />
            <${Field} k="crossfeed_level" />
          </div>
          <div class="dsp-plot"><${CrossfeedPlot} /></div>
        </div>
      </div>
    <//>
  `;
}

export function LoudnessCard() {
  // dim the body when disabled OR gated (volume control bypassed — loudness
  // can't adapt; the enable field's caption carries the reason)
  const on = truthy(effective("loudness_enabled")) && !grayReason("loudness_enabled");
  return html`
    <${Card} title="Loudness">
      <div class="dsp-card">
        <${Field} k="loudness_enabled" />
        <div class="dsp-body ${on ? "" : "off"}">
          <div class="dsp-controls">
            <div class="cluster-row">
              <div class="cluster">
                <div class="cluster-head">Bass</div>
                <${Field} k="loudness_low_level" />
                <${Field} k="loudness_low_freq" />
                <${Field} k="loudness_low_steep" />
                <${Field} k="loudness_low_type" />
              </div>
              <div class="cluster">
                <div class="cluster-head">Treble</div>
                <${Field} k="loudness_high_level" />
                <${Field} k="loudness_high_freq" />
                <${Field} k="loudness_high_steep" />
                <${Field} k="loudness_high_type" />
              </div>
            </div>
            <div class="range-group">
              <div class="cluster-head">Range</div>
              <div class="range-row">
                <${Field} k="loudness_range_low" />
                <${Field} k="loudness_range_high" />
              </div>
            </div>
          </div>
          <div class="dsp-plot"><${LoudnessPlot} /></div>
        </div>
      </div>
    <//>
  `;
}

// DAC correction lives on the Output tab (it belongs to the output device).
export const Dsp = () =>
  html`<${Section}>
    <${CrossfeedCard} />
    <${LoudnessCard} />
  <//>`;
