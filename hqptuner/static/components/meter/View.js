// The METER page. A mode like LIVE, opened from the header's mini spectrum. It
// holds the feed open while it is up (store/meter/feed.js) and shows the level
// meters, or, where there is no level to show, says why: metering is off, the
// engine is not playing, or the feed has gone silent while it plays. A silent
// DSD source with the matrix off is named apart, since the matrix is what
// turns DSD metering on.
import { useEffect } from "preact/hooks";
import { html } from "../../lib/dom.js";
import { truthy as on } from "../../lib/coerce.js";
import { engineStatus } from "../../store/signals.js";
import { metering } from "../../store/actions.js";
import { runningValue } from "../../store/resolve.js";
import { trackCounters } from "../../store/health.js";
import { meterGeometry, meterLevels, openMeterFeed, closeMeterFeed, meterSilent } from "../../store/meter/feed.js";
import { METER_FLOORS, meterFloor, setMeterFloor } from "../../store/ui/prefs.js";
import { sourceIsDsd } from "../SignalPath.js";
import { Dropdown } from "../controls/index.js";
import { Levels } from "./Levels.js";

const PLAYING = 2;
const STEREO = 2;

const NOTES = {
  idle: "Start playback to see the meter.",
  off: "No metering available.",
  silent: "No metering available.",
  matrix: "Engage the matrix engine to see DSD metering.",
};

const FLOOR_OPTIONS = METER_FLOORS.map((v) => ({ value: v, label: `${v} dB` }));

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
  const bars =
    state === "live" || state === "idle"
      ? html`<${Levels}
          levels=${playing ? meterLevels.value : []}
          channels=${geo ? geo.channels : STEREO}
          floor=${Number(meterFloor.value)}
        />`
      : null;
  const note = state in NOTES ? NOTES[/** @type {keyof NOTES} */ (state)] : null;
  return html`${bars}${note ? html`<p class="t-caption" data-testid="meter-note">${note}</p>` : null}`;
}

/** The METER page's root section. */
export function MeterView() {
  const status = engineStatus.value || {};
  const playing = Number((status.status || {}).state) === PLAYING;
  const available = metering.value;
  useEffect(() => {
    if (!available) return undefined;
    openMeterFeed();
    return closeMeterFeed;
  }, [available]);
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
