// Volume tab: the live playback knob, the three-handle volume range, the
// fixed/automatic volume cards, and Loudness (volume-adaptive by definition —
// moved here from the dissolved post-process tab, 2026-07-21 reorg).
import { html } from "../../lib/dom.js";
import { Field } from "../Field.js";
import { PlaybackVolume } from "../PlaybackVolume.js";
import { VolumeRangeBar } from "../VolumeRangeBar.js";
import { effective } from "../../store/state.js";
import { grayReason } from "../../store/graying.js";
import { LoudnessPlot } from "../plots.js";
import { Section, Card, truthy } from "./common.js";

function LoudnessCard() {
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
              <span class="col-rule" aria-hidden="true"></span>
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

export const Volume = () =>
  html`<${Section}>
    <div class="card-grid">
      <${PlaybackVolume} />
      <${Card} title="Fixed volume">
        <${Field} k="optimal_iso" />
        <${Field} k="fixed_volume_enabled" />
        <div class="indent">
          <${Field} k="fixed_volume" />
        </div>
      <//>
    </div>
    <${VolumeRangeBar} />
    <${Card} title="Automatic">
      <div class="pack">
        <${Field} k="adaptive_volume" />
        <${Field} k="playlist_album_gain" />
      </div>
    <//>
    <${LoudnessCard} />
  <//>`;
