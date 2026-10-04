// The engine row: the process speed gauge, the input and output buffers, the clipping and apodizing counters, and the
// playback volume at the right end. Every reading is live off the Status poll (store/faceplate/engine.js); one with
// nothing to show prints — and takes no zone. The speed figure and each buffer read the gauge's own arcs, red | amber |
// green, and a counter's lamp lights while this track has counted. The volume's slider popover renders beside the row,
// so that it is a child of the plate as every popover is.

import { html } from "../../lib/dom.js";
import { PLATFORM } from "../../lib/clock.js";
import { gaugeReading, zone } from "../../model/shell/frame.js";
import { engineStatus } from "../../store/signals.js";
import { outputBufferApplies, trackCounters } from "../../store/health.js";
import { engineReadings } from "../../store/faceplate/engine.js";
import { Volume, VolumePopover } from "./Volume.js";

/** @typedef {import("../../lib/clock.js").Clock} Clock */
/** @typedef {import("../../store/faceplate/engine.js").Count} Count */
/** @typedef {import("../../model/shell/frame.js").Seams} Seams */

/** The speed gauge's seams, ×: red below the first, amber to the second, green above. @type {Seams} */
const SPEED = [0.87, 1];
/** The buffers' seams, percent. @type {Seams} */
const BUFFER = [25, 50];

/** @param {number | null} n */
const figure = (n) => (n === null ? "—" : n.toLocaleString("en-US"));

/** @param {{ speed: number | null }} props */
function Gauge({ speed }) {
  const g = gaugeReading(speed, SPEED);
  return html`
    <div class="gauge">
      <svg viewBox="0 0 110 60" width="62" height="34" aria-label="Process speed gauge" role="img">
        <path class="trk" d="M10 54 A45 45 0 0 1 100 54" fill="none" stroke-width="6" />
        <path class="z-bad" d="M10 54 A45 45 0 0 1 32 17" fill="none" stroke-width="6" />
        <path class="z-warn" d="M32 17 A45 45 0 0 1 42 12" fill="none" stroke-width="6" />
        <path class="z-ok" d="M42 12 A45 45 0 0 1 100 54" fill="none" stroke-width="6" />
        <line class="ndl" x1="55" y1="54" x2=${g.x2} y2=${g.y2} stroke-width="2.5" stroke-linecap="round" />
        <circle class="hub" cx="55" cy="54" r="4" />
      </svg>
      <div class="readout">
        <span class="mono val" data-zone=${g.zone}>${g.text}</span><span class="cnt">process speed</span>
      </div>
    </div>
  `;
}

/** @param {{ k: string, label: string, percent: number | null }} props */
const Buffer = ({ k, label, percent }) => html`
  <div class="meter" data-k=${k} data-zone=${zone(percent, BUFFER)}>
    <span class="ml">${label}</span>
    <span class="bar"><span class="fill" style=${`width:${percent ?? 0}%`}></span></span>
    <span class="mv">${percent === null ? "—" : `${percent}%`}</span>
  </div>
`;

/** @param {{ k: string, label: string, count: Count }} props */
const Counter = ({ k, label, count }) => html`
  <div class="counter" data-k=${k}>
    <span class=${(count.track ?? 0) > 0 ? "lamp big bad" : "lamp big"}></span>
    <span class="eng">${label}</span>
    <span class="cnts">
      <span class="cnt">${figure(count.track)} this track</span>
      <span class="cnt">${figure(count.total)} total</span>
    </span>
  </div>
`;

/**
 * The engine row, with the volume's slider popover beside it.
 *
 * @param {{ clock?: Clock }} props  the clock the volume's held ± repeats on
 */
export function EngineRow({ clock = PLATFORM }) {
  const r = engineReadings((engineStatus.value || {}).status, trackCounters.value, outputBufferApplies.value);
  return html`
    <div class="engine">
      <${Gauge} speed=${r.speed} />
      <div class="meters">
        <${Buffer} k="input_fill" label="Input buffer" percent=${r.input} />
        <${Buffer} k="output_fill" label="Output buffer" percent=${r.output} />
      </div>
      <${Counter} k="clips" label="Clipping" count=${r.clips} />
      <${Counter} k="apod" label="Apodizing" count=${r.apod} />
      <${Volume} clock=${clock} />
    </div>
    <${VolumePopover} />
  `;
}
