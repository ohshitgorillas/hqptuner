// The Source drawer's meter block: the apodizing strip over the spectrogram on one time axis, frequency up the side
// to the source Nyquist, with the Range, Channel and Window switches in its head. Where there is no stream to draw, the
// line saying why takes the meter's place. Mounted by the drawer as its one block; every control here is a view, not
// a setting, so nothing stages. What it shows is the store's (store/faceplate/drawers/source.js); the canvases are
// painted by source/paint.js.

import { useRef } from "preact/hooks";
import { html } from "../../../lib/dom.js";
import { sourceMeter } from "../../../store/faceplate/drawers/source.js";
import { FreqAxis, TimeAxis } from "./source/Axes.js";
import { SpectrogramControls } from "./source/Controls.js";
import { SPEC_SIZE, useMeterPaint } from "./source/paint.js";

/** @typedef {import("../../../store/faceplate/drawers/source.js").SourceMeterView} SourceMeterView */
/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

/** The no-stream lines, by state (v1, components/meter/View.js). @type {Record<string, string>} */
const NOTES = {
  idle: "Start playback to see the meter.",
  off: "No metering available.",
  silent: "No metering available.",
  matrix: "Engage the matrix engine to see DSD metering.",
};

/**
 * The strip, the spectrogram and their two axes on one grid: gutter beside plot, strip above spectrogram above time.
 *
 * @param {{ view: SourceMeterView }} props
 */
function Plot({ view }) {
  const spec = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  const strip = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  useMeterPaint(spec, strip);
  return html`
    <div class="sgrid2">
      <span class="rowl">Apodizing</span>
      <canvas
        ref=${strip}
        class="apodstrip"
        width=${SPEC_SIZE.width}
        height="1"
        role="img"
        aria-label="Apodizing events over time"
      ></canvas>
      <${FreqAxis} freq=${view.freq} />
      <canvas
        ref=${spec}
        class="spec"
        width=${SPEC_SIZE.width}
        height=${SPEC_SIZE.height}
        role="img"
        aria-label="Spectrogram"
      ></canvas>
      <span></span>
      <${TimeAxis} time=${view.time} />
    </div>
  `;
}

/**
 * The Source drawer's meter, or the line saying why there is none.
 *
 * @param {{ schema: DrawerSchema }} _props  the drawer's schema; the meter reads none of it
 */
export function SourceMeter(_props) {
  const view = sourceMeter();
  if (view.state !== "live") {
    return html`<div class="mnone" data-meter=${view.state}><p>${NOTES[view.state]}</p></div>`;
  }
  return html`
    <div class="mblk" data-meter=${view.state}>
      <div class="mhead">
        <b class="mt">Spectrogram</b>
        <span class="grow"></span>
        <${SpectrogramControls} view=${view} />
      </div>
      <${Plot} view=${view} />
    </div>
  `;
}
