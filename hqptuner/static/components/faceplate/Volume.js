// Playback volume at the right end of the engine row: − / readout / +, and the slider popover the readout opens. The
// lane is live: every change writes the level at once and nothing stages. ± steps once per press; holding repeats after
// a short delay, and a hold that already stepped ignores its trailing click. The bound the level sits on disables its
// button. While the level is pinned (Fixed volume, or Direct SDM over it) ±, the readout and the slider gray and the
// readout shows the pin; under Direct SDM its tooltip says why. While loudness reaches the output the slider marks its
// bounds: ( and ) at the bounds and a strip under the track between them.

import { useEffect, useRef } from "preact/hooks";
import { html, userEdit, wheelGuard } from "../../lib/dom.js";
import { PLATFORM } from "../../lib/clock.js";
import { holdRepeat } from "../../model/shell/timing.js";
import { percentOf } from "../../model/gauges/output.js";
import { dbText } from "../../model/gauges/volume.js";
import { minus } from "../../model/shell/format.js";
import { openPopover, togglePopover } from "../../store/faceplate/view.js";
import { loudnessMarks, volumeGrid, volumeNow, writeVolume } from "../../store/faceplate/volume.js";
import { Popover, UNDER_ENGINE_READOUT, parkAt, triggerProps } from "./Popover.js";

/** @typedef {import("../../lib/clock.js").Clock} Clock */
/** @typedef {import("../../lib/dom.js").ControlEvent} ControlEvent */

const ID = "volume";
const HOLD_DELAY = 400; // ms before a held ± starts repeating
const HOLD_RATE = 70; // ms between repeats
const SCALE = [-60, -40, -20, -10, 0]; // the slider's scale marks, dB

/**
 * Park the panel under the readout and hand the slider focus.
 *
 * @param {HTMLElement} panel
 */
function park(panel) {
  const at = parkAt(panel, UNDER_ENGINE_READOUT);
  if (at) {
    panel.style.left = `${Math.round(at.left)}px`;
    panel.style.top = `${Math.round(at.top)}px`;
  }
  panel.querySelector("input")?.focus();
}

/**
 * One step of a ± button, up (1) or down (−1), its write paced on `clock`.
 *
 * @param {number} dir
 * @param {Clock} clock
 */
const stepOnce = (dir, clock) => writeVolume(volumeNow().value + dir * volumeGrid().step, clock);

/**
 * A ± button's press: one step per click; holding repeats after HOLD_DELAY, until release or the bound.
 *
 * @param {number} dir
 * @param {Clock} clock
 */
function useHold(dir, clock) {
  const idle = () => false;
  const stop = useRef(idle);
  const end = () => void stop.current();
  return {
    onPointerDown: () => {
      stop.current = holdRepeat(
        () => {
          stepOnce(dir, clock);
          if (volumeNow().off[dir < 0 ? "down" : "up"]) end();
        },
        clock,
        HOLD_DELAY,
        HOLD_RATE,
      );
    },
    onPointerUp: end,
    onPointerLeave: end,
    onPointerCancel: end,
    onClick: () => {
      if (!stop.current()) stepOnce(dir, clock);
      stop.current = idle;
    },
  };
}

/**
 * The engine-row volume: − / readout / +. The readout opens the slider popover.
 *
 * @param {{ clock?: Clock }} props  the clock a held ± repeats and its writes pace on
 */
export function Volume({ clock = PLATFORM }) {
  const v = volumeNow();
  const down = useHold(-1, clock);
  const up = useHold(1, clock);
  return html`
    <div class="volc" role="group" aria-label="Playback volume">
      <button class="round vbtn" type="button" data-testid="volume-down" aria-label="Volume down" disabled=${v.off.down} ...${down}>−</button>
      <button
        class=${v.fixed ? "vfd volrd fixed" : "vfd volrd"}
        type="button"
        ...${triggerProps(ID, "dialog")}
        disabled=${v.fixed}
        title=${v.why || undefined}
      >
        <span class="l">Volume</span><span class="v">${v.txt}</span>
      </button>
      <button class="round vbtn" type="button" data-testid="volume-up" aria-label="Volume up" disabled=${v.off.up} ...${up}>+</button>
    </div>
  `;
}

/**
 * The scale marks along the slider: each that falls inside the range at its place, the top of the range in full.
 *
 * @param {{ min: number, max: number }} range
 */
const ScaleMarks = ({ min, max }) => html`
  <div class="scale" aria-hidden="true">
    ${SCALE.filter((m) => m >= min && m <= max).map(
      (m) =>
        html`<span style=${`left:${percentOf(m, min, max)}%`}>${m === max ? `${minus(m)} dB` : dbText(m).replace(/\.0 dB$/, "")}</span>`,
    )}
  </div>
`;

/** Loudness bounds over the slider, in the Range bar's grammar; hidden while loudness does not reach the output. */
function LoudMarks() {
  const span = loudnessMarks();
  return html`
    <div class="lmk" aria-hidden="true" hidden=${!span}>
      ${
        span &&
        html`
          <span class="lband" style=${`left:${span.lo}%;width:${span.width}%`}></span>
          <span class="lpw" style=${`left:${span.lo}%`}><svg class="lp" viewBox="0 0 10 18" width="10" height="18"><path d="M8,1 Q2,9 8,17" /></svg></span>
          <span class="lpw r" style=${`left:${span.hi}%`}><svg class="lp" viewBox="0 0 10 18" width="10" height="18"><path d="M2,1 Q8,9 2,17" /></svg></span>
        `
      }
    </div>
  `;
}

/**
 * The slider over its loudness marks, grayed while the level is pinned.
 *
 * @param {{ clock: Clock }} props  the clock the slider's writes pace on
 */
function Track({ clock }) {
  const v = volumeNow();
  const { min, max, step } = volumeGrid();
  const edit = userEdit(v.level, (/** @type {ControlEvent} */ e) => writeVolume(Number(e.target.value), clock));
  return html`
    <div class="vsl">
      <input
        type="range"
        min=${min}
        max=${max}
        step=${step}
        value=${v.level}
        aria-label="Playback volume"
        disabled=${v.fixed}
        onInput=${edit}
        onChange=${edit}
        onWheel=${wheelGuard}
      />
      <${LoudMarks} />
    </div>
  `;
}

/**
 * The slider popover: heading with the level, the slider over its loudness marks, the scale. A child of the plate.
 *
 * @param {{ clock?: Clock }} props  the clock the slider's writes pace on
 */
export function VolumePopover({ clock = PLATFORM }) {
  const v = volumeNow();
  const { min, max } = volumeGrid();
  // A level that becomes pinned has nothing to slide: an open popover closes.
  useEffect(() => {
    if (v.fixed && openPopover.value === ID) togglePopover(ID);
  }, [v.fixed]);
  return html`
    <${Popover} id=${ID} cls="vpop" role="dialog" label="Playback volume" park=${park}>
      <div class="vh"><span class="eng">Playback volume</span><span class="v">${v.txt}</span></div>
      <${Track} clock=${clock} />
      <${ScaleMarks} min=${min} max=${max} />
    <//>
  `;
}

/**
 * The Setting Switcher's volume bar while its target is Volume: − / the slider over its scale / + / the readout.
 *
 * @param {{ clock?: Clock }} props  the clock a held ± repeats and every write paces on
 */
export function VolumeBar({ clock = PLATFORM }) {
  const v = volumeNow();
  const { min, max } = volumeGrid();
  const down = useHold(-1, clock);
  const up = useHold(1, clock);
  return html`
    <div class="vbar" role="group" aria-label="Playback volume">
      <span class="vbt">Playback volume</span>
      <button class="round vbtn" type="button" aria-label="Volume down" disabled=${v.off.down} ...${down}>−</button>
      <div class="vbsl">
        <${Track} clock=${clock} />
        <${ScaleMarks} min=${min} max=${max} />
      </div>
      <button class="round vbtn" type="button" aria-label="Volume up" disabled=${v.off.up} ...${up}>+</button>
      <div class="vfd vbrd" role="status" title=${v.why || undefined}><span class="v">${v.txt}</span></div>
    </div>
  `;
}
