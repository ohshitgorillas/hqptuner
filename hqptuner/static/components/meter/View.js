// The METER page. A mode like LIVE, opened from the header's mini spectrum. It
// shows the level meters, the apodizing strip and the spectrogram under it on
// one time axis, all read from the feed (store/meter/feed.js), or, where there
// is no level to show, says why: metering is off, the engine is not playing, or
// the feed has gone silent while it plays. A silent DSD source with the matrix
// off is named apart, since the matrix is what turns DSD metering on.
import { html } from "../../lib/dom.js";
import { truthy as on } from "../../lib/coerce.js";
import { engineStatus } from "../../store/signals.js";
import { metering } from "../../store/actions.js";
import { runningValue } from "../../store/resolve.js";
import { trackCounters } from "../../store/health.js";
import { meterGeometry, meterLevels, meterSilent } from "../../store/meter/feed.js";
import {
  METER_FLOORS,
  meterFloor,
  setMeterFloor,
  METER_RANGES,
  meterRange,
  setMeterRange,
  meterChannel,
  setMeterChannel,
  meterScale,
  setMeterScale,
} from "../../store/ui/prefs.js";
import { sourceIsDsd } from "../SignalPath.js";
import { ApodStrip } from "../ApodStrip.js";
import { Dropdown, Segment } from "../controls/index.js";
import { Levels } from "./Levels.js";
import { Spectrogram } from "./Spectrogram.js";

const PLAYING = 2;
const STEREO = 2;

const NOTES = {
  idle: "Start playback to see the meter.",
  off: "No metering available.",
  silent: "No metering available.",
  matrix: "Engage the matrix engine to see DSD metering.",
};

const FLOOR_OPTIONS = METER_FLOORS.map((v) => ({ value: v, label: `${v} dB` }));
const RANGE_OPTIONS = METER_RANGES.map((v) => ({ value: v, label: `${v} dB` }));
const SCALE_OPTIONS = [
  { value: "log", label: "Log" },
  { value: "linear", label: "Linear" },
];

/**
 * The channel picker's options: Left, Right and Sum on a stereo source,
 * numbered channels and Sum otherwise.
 *
 * @param {number} channels
 */
function channelOptions(channels) {
  const each =
    channels === STEREO
      ? [
          { value: "0", label: "Left" },
          { value: "1", label: "Right" },
        ]
      : Array.from({ length: channels }, (_, i) => ({ value: String(i), label: String(i + 1) }));
  return [...each, { value: "sum", label: "Sum" }];
}

/** The spectrogram's channel, frequency scale and range. @param {{ channels: number }} props */
function SpecHead({ channels }) {
  const options = channelOptions(channels);
  const pick = options.some((o) => o.value === meterChannel.value) ? meterChannel.value : "sum";
  return html`
    <div class="mt-head mt-spec-head">
      <label class="mt-floor t-label">
        Channel
        <${Segment} value=${pick} options=${options} onChange=${setMeterChannel} />
      </label>
      <label class="mt-floor t-label">
        Scale
        <${Segment} value=${meterScale.value} options=${SCALE_OPTIONS} onChange=${setMeterScale} />
      </label>
      <label class="mt-floor t-label">
        Range
        <${Dropdown} value=${meterRange.value} options=${RANGE_OPTIONS} onChange=${setMeterRange} />
      </label>
    </div>
  `;
}

// One grid for the strip and the spectrogram: the spectrogram's frequency
// gutter is the first column, and the strip sits in the second, so both charts
// span the same width and share one time axis.
/** The apodizing strip, and the spectrogram under it on the same time axis. @param {{ channels: number }} props */
function Recorder({ channels }) {
  return html`
    <div class="mt-rec">
      <div class="mt-rec-strip"><${ApodStrip} always=${true} /></div>
      <div class="mt-rec-head"><${SpecHead} channels=${channels} /></div>
      <${Spectrogram} />
    </div>
  `;
}

/**
 * Which of the page's states it is in.
 *
 * @param {boolean} available
 * @param {boolean} playing
 * @param {{ sdm?: string, samplerate?: string }} md
 * @returns {"off" | "idle" | "silent" | "matrix" | "live"}
 */
function stateOf(available, playing, md) {
  if (!available) return "off";
  if (!playing) return "idle";
  if (!meterSilent()) return "live";
  return sourceIsDsd(md) && !on(runningValue("matrix_enabled")) ? "matrix" : "silent";
}

/** The floor picker and the clip flag. @param {{ clip: boolean }} props */
function Head({ clip }) {
  return html`
    <div class="mt-head">
      <label class="mt-floor t-label">
        Floor
        <${Dropdown} value=${meterFloor.value} options=${FLOOR_OPTIONS} onChange=${setMeterFloor} />
      </label>
      <span class="mt-clip t-micro ${clip ? "lit" : ""}">CLIP</span>
    </div>
  `;
}

/** The bars while live or idle, and the note in every state but live. @param {{ state: string, playing: boolean }} props */
function Body({ state, playing }) {
  const geo = meterGeometry.value;
  const channels = geo ? geo.channels : STEREO;
  const bars =
    state === "live" || state === "idle"
      ? html`<${Levels}
            levels=${playing ? meterLevels.value : []}
            channels=${channels}
            floor=${Number(meterFloor.value)}
          />
          <${Recorder} channels=${channels} />`
      : null;
  const note = state in NOTES ? NOTES[/** @type {keyof NOTES} */ (state)] : null;
  return html`${bars}${note ? html`<p class="t-caption" data-testid="meter-note">${note}</p>` : null}`;
}

/** The METER page's root section. */
export function MeterView() {
  const status = engineStatus.value || {};
  const playing = Number((status.status || {}).state) === PLAYING;
  const available = metering.value;
  const state = stateOf(available, playing, status.metadata || {});
  const clip = playing && trackCounters.value.clips > 0;
  return html`
    <section
      class="tab-body mt-page ${state === "idle" ? "mt-idle" : ""}"
      data-testid="meter-page"
      data-meter=${state}
      data-clip=${String(clip)}
    >
      <${Head} clip=${clip} />
      <${Body} state=${state} playing=${playing} />
    </section>
  `;
}
