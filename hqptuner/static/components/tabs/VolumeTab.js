// Volume tab: the live playback knob, the three-handle volume range, and the
// fixed/automatic volume cards.
import { html } from "../../lib/dom.js";
import { Field } from "../Field.js";
import { PlaybackVolume } from "../PlaybackVolume.js";
import { VolumeRangeBar } from "../VolumeRangeBar.js";
import { Section, Card } from "./common.js";

export const Volume = () =>
  html`<${Section}>
    <${PlaybackVolume} />
    <${VolumeRangeBar} />
    <div class="card-grid">
      <${Card} title="Fixed volume">
        <${Field} k="fixed_volume_enabled" />
        <div class="indent">
          <${Field} k="fixed_volume" />
          <${Field} k="optimal_iso" />
        </div>
      <//>
      <${Card} title="Automatic">
        <${Field} k="adaptive_volume" />
        <${Field} k="playlist_album_gain" />
      <//>
    </div>
  <//>`;
