// The engine row: the process speed gauge, the input and output buffers, the clipping and apodizing counters stacked
// one over the other, the HF filter, and the playback volume at the right end. Every reading is live off the Status
// poll (store/faceplate/engine.js); one with nothing to show prints — and takes no zone. The speed figure and each
// buffer read the gauge's own arcs, red | amber | green. A counter prints one figure, this track's count and the total
// split by a slash ("12/5,410"), or the total alone where there is no track count apart from it; its lamp flashes on a
// frame that counted and fades, and stays dark while there is no total. The HF filter reads the playback filter that
// runs and opens a menu of the engine's playback filters, a pick written live. Its menu and the volume's slider
// popover render beside the row, so that each is a child of the plate as every popover is. An alert homed on the gauge
// blinks it in the alert's colour, and while one is up the gauge takes a tap or Enter like a button, opening the alert
// lines; its popover renders beside the row too.

import { html } from "../../lib/dom.js";
import { PLATFORM } from "../../lib/clock.js";
import { gaugeReading, zone } from "../../model/shell/frame.js";
import { engineStatus } from "../../store/signals.js";
import { clipFlash, outputBufferApplies, trackCounters } from "../../store/health.js";
import { apodLampLevel } from "../../store/meter/apodlamp.js";
import { apodBinSeq } from "../../store/apodhistory.js";
import { fastPollMs } from "../../store/ui/ui.js";
import { engineReadings } from "../../store/faceplate/engine.js";
import { alertsNow } from "../../store/faceplate/alerts.js";
import { togglePopover } from "../../store/faceplate/view.js";
import { triggerProps } from "./Popover.js";
import { AlertNote, noteId } from "./Header.js";
import { HfFilter, HfFilterPopover } from "./HfFilter.js";
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

const NOTE = noteId("gauge");

/** @param {KeyboardEvent} e */
const enter = (e) => {
  if (e.key === "Enter") togglePopover(NOTE);
};

/**
 * What the gauge carries while an alert is homed on it: the blink, and a button's role, focus and tap.
 *
 * @param {string | undefined} alert  the blink up on the gauge, if any
 */
const alertProps = (alert) =>
  alert ? { "data-alert": alert, role: "button", tabIndex: 0, onKeyDown: enter, ...triggerProps(NOTE, "dialog") } : {};

/** @param {{ speed: number | null }} props */
function Gauge({ speed }) {
  const g = gaugeReading(speed, SPEED);
  return html`
    <div class="gauge" ...${alertProps(alertsNow.value.blinks.el.get("gauge"))}>
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

/** @param {{ k: string, label: string, count: Count, level: number, seq: number }} props */
const Counter = ({ k, label, count, level, seq }) => html`
  <div class="counter" data-k=${k}>
    <span
      class=${`lamp big flash-${seq % 2}`}
      style=${`--lamp: ${(count.total === null ? 0 : level).toFixed(3)}; --lamp-decay: ${Math.round(fastPollMs.value / 4)}ms`}
    ></span>
    <span class="eng">${label}</span>
    <span class="cnt">${count.track === null ? figure(count.total) : `${figure(count.track)}/${figure(count.total)}`}</span>
  </div>
`;

/**
 * The engine row, with the HF filter's menu and the volume's slider popover beside it.
 *
 * @param {{ clock?: Clock }} props  the clock the volume's held ± repeats on
 */
export function EngineRow({ clock = PLATFORM }) {
  const r = engineReadings((engineStatus.value || {}).status, trackCounters.value, outputBufferApplies.value);
  return html`
    <div class="engine">
      <${Gauge} speed=${r.speed} />
      <div class="meters">
        <${Buffer} k="input_fill" label="Input" percent=${r.input} />
        <${Buffer} k="output_fill" label="Output" percent=${r.output} />
      </div>
      <div class="counters">
        <${Counter}
          k="clips"
          label="Clipping"
          count=${r.clips}
          level=${clipFlash.value.level}
          seq=${clipFlash.value.seq}
        />
        <${Counter} k="apod" label="Apodizing" count=${r.apod} level=${apodLampLevel.value} seq=${apodBinSeq.value} />
      </div>
      <${HfFilter} />
      <${Volume} clock=${clock} />
    </div>
    <${HfFilterPopover} />
    <${VolumePopover} />
    <${AlertNote} el="gauge" />
  `;
}
