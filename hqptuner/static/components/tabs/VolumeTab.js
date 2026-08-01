// Volume tab: the live playback knob, the three-handle volume range, the
// fixed/automatic volume cards, and Loudness (volume-adaptive by definition —
// moved here from the dissolved post-process tab, 2026-07-21 reorg).
import { html } from "../../lib/dom.js";
import { Field } from "../Field.js";
import { Segment } from "../controls/index.js";
import { PlaybackVolume } from "../PlaybackVolume.js";
import { VolumeRangeBar } from "../VolumeRangeBar.js";
import { effective, isDirty } from "../../store/state.js";
import { loudnessSide } from "../../store/ui.js";
import { grayReason } from "../../store/graying.js";
import { LoudnessPlot } from "../plots.js";
import { Section, Card } from "./common.js";
import { truthy } from "../../lib/coerce.js";

const SIDES = [
  { value: "low", label: "Bass" },
  { value: "high", label: "Treble" },
];
// staged edits on the hidden side must never be invisible — the inactive
// segment button carries an accent dot while any of that side's keys is dirty
const sideDirty = (s) => ["freq", "level", "steep", "type"].some((f) => isDirty(`loudness_${s}_${f}`));

function LoudnessCard() {
  // dim the body when disabled OR gated (volume control bypassed — loudness
  // can't adapt; the enable field's caption carries the reason)
  const on = truthy(effective("loudness_enabled")) && !grayReason("loudness_enabled");
  const side = loudnessSide.value;
  return html`
    <${Card} title="Loudness">
      <div class="dsp-card">
        <${Field} k="loudness_enabled" />
        <div class="dsp-body ${on ? "" : "off"}">
          <div class="dsp-controls">
            <div class="range-group">
              <div class="cluster-head">Range</div>
              <div class="range-row">
                <${Field} k="loudness_range_low" />
                <${Field} k="loudness_range_high" />
              </div>
            </div>
            <div class="band-strip loudness-strip">
              <div class="loudness-side-row">
                <${Segment}
                  value=${side}
                  options=${SIDES.map((o) => ({ ...o, dirty: o.value !== side && sideDirty(o.value) }))}
                  onChange=${(v) => (loudnessSide.value = v)}
                />
              </div>
              <${Field} k="loudness_${side}_type" />
              <div class="band-slots">
                <${Field} k="loudness_${side}_freq" />
                <span class="col-rule" aria-hidden="true"></span>
                <${Field} k="loudness_${side}_level" />
                <span class="col-rule" aria-hidden="true"></span>
                <${Field} k="loudness_${side}_steep" />
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
