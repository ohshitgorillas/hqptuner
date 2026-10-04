// The engine-row volume, read off what the engine reports and what the daemon is running, never a staged edit: the
// level it shows on a 0.5 dB step, the range it moves over, the pins that hold it (Direct SDM over Fixed volume), the
// write that moves it, and the loudness bounds and where they sit along its slider.
//
// The range is the one the Volume tab's dial is drawn on (components/volume/Playback.js): the engine's own report while
// it has the control, else the running config's, since the range the engine reports while it holds the control is not
// the configured one. A collapsed running range (min at or above max; 0 / 0 bypasses the volume control, manual §4.2)
// draws on the daemon's full −60…0 dB with the level pinned at 0 dB, nothing being attenuated.
//
// Writes go out at most once per 100 ms, the newest held write sent when the window closes, so a slider drag does not
// flood the engine; the level each write asks for shows at once.

import { volume, volumeDrag, volumeRange, volumeShown } from "../signals.js";
import { runningValue } from "../resolve.js";
import { setVolume } from "../actions.js";
import { directSdm, isoLevel } from "../schema/gray.js";
import { num, truthy } from "../../lib/coerce.js";
import { PLATFORM } from "../../lib/clock.js";
import { revertAfter } from "../../model/shell/timing.js";
import { dbText, directPin, fixedPin, loudSpan, volumeView } from "../../model/gauges/volume.js";

/** @typedef {import("../../model/gauges/volume.js").Grid} Grid */
/** @typedef {import("../../model/gauges/volume.js").Pin} Pin */
/** @typedef {import("../../model/gauges/volume.js").Pins} Pins */
/** @typedef {import("../../model/gauges/volume.js").VolumeView} VolumeView */
/** @typedef {import("../../lib/clock.js").Clock} Clock */

const STEP = 0.5; // dB, the Volume tab dial's step
const FULL = { min: -60, max: 0 }; // dBFS, the daemon's own range
const SEND_EVERY = 100; // ms, the least time between two writes
/** The level a collapsed running range pins: nothing attenuated. @type {Pin} */
const BYPASS = { level: 0, level_txt: dbText(0), text: dbText(0) };

/**
 * A wire number, `d` for an absent or empty one (`num` alone reads null as 0).
 *
 * @param {unknown} v
 * @param {number} d
 */
const wireNum = (v, d) => (v == null || v === "" ? d : num(v, d));

/**
 * The range the level moves over, and its step.
 *
 * @returns {Grid}
 */
export function volumeGrid() {
  const vr = volumeRange.value || {};
  const held = heldRange();
  if (!held) return { min: wireNum(vr.min, FULL.min), max: wireNum(vr.max, FULL.max), step: STEP };
  return held.min >= held.max ? { ...FULL, step: STEP } : { ...held, step: STEP };
}

/**
 * The running config's range while the engine holds the control; null while the engine reports the control enabled,
 * since its report is then the range the writes land on, and null when the running config has no usable range.
 *
 * @returns {{ min: number, max: number } | null}
 */
function heldRange() {
  const vr = volumeRange.value || {};
  // VolumeRange reports the flag as 1 / "1" / true and nothing else (Playback.js knobRange)
  if (vr.enabled === "1" || vr.enabled === 1 || vr.enabled === true) return null;
  const [min, max] = ["volume_min", "volume_max"].map((k) => wireNum(runningValue(k), NaN));
  return Number.isNaN(min) || Number.isNaN(max) ? null : { min, max };
}

/**
 * The pins the running config holds the level with. Auto headroom (Optimal ISO) supersedes the manual level
 * (store/schema/gray.js), a collapsed running range pins it at 0 dB below both (Playback.js disabledReason), and
 * Direct SDM pins it at −3 dBFS over all three with the reason its gray predicate gives.
 *
 * @returns {Pins}
 */
function pins() {
  const iso = isoLevel(runningValue("optimal_iso"));
  const mode = iso !== "0" ? "auto" : truthy(runningValue("fixed_volume_enabled")) ? "manual" : "off";
  const level = runningValue("fixed_volume");
  const why = directSdm({ mode: "", effective: runningValue });
  const held = heldRange();
  return {
    fixed:
      fixedPin(mode, typeof level === "boolean" || level == null ? "" : level, iso) ||
      (held && held.min >= held.max ? BYPASS : null),
    direct: directPin(truthy(runningValue("direct_sdm")), why),
  };
}

/**
 * The level the page shows (a knob drag in flight, else the engine's report), the bottom of the range with none.
 *
 * @param {Grid} grid
 */
const shownLevel = (grid) => wireNum(volumeShown.value, grid.min);

/**
 * What the engine-row volume shows now.
 *
 * @returns {VolumeView}
 */
export function volumeNow() {
  const grid = volumeGrid();
  const at = shownLevel(grid);
  return volumeView(at, at, pins(), grid);
}

/**
 * A sender that writes at most once per SEND_EVERY ms on `clock`: a write with no window open goes at once and opens
 * one; a write inside it is held, a newer one replacing it, and goes when the window closes, opening the next. The
 * level asked for is held in `volumeDrag` while a window is open, so neither an engine answer nor a poll moves what
 * shows under a drag; a window closing with nothing held adopts the last level sent, as the Volume tab's dial does on
 * release.
 *
 * @param {Clock} clock
 * @returns {(level: string) => void}
 */
function pacedSender(clock) {
  /** @type {string | null} */
  let held = null;
  let last = "";
  let open = false;
  const close = revertAfter(
    SEND_EVERY,
    () => {
      if (held !== null) {
        send(held);
        return;
      }
      open = false;
      volume.value = last; // adopted before the drag clears, so nothing reads the last polled level in between
      volumeDrag.value = null;
    },
    clock,
  );
  /** @param {string} level */
  function send(level) {
    held = null;
    last = level;
    open = true;
    setVolume(level).catch(() => {}); // the next poll reports the level the engine holds
    close();
  }
  return (level) => {
    volumeDrag.value = Number(level);
    if (open) held = level;
    else send(level);
  };
}

/** One sender per clock, so a test's fake clock paces its own. @type {WeakMap<Clock, (level: string) => void>} */
const senders = new WeakMap();

/**
 * Move the level: the request lands on the step inside the range, shows at once and goes to the engine, at most one
 * write per SEND_EVERY ms. Nothing is sent while the level is pinned, nor for a request landing where the level already
 * is.
 *
 * @param {number} level  dB
 * @param {Clock} [clock]  the clock the writes pace on
 */
export function writeVolume(level, clock = PLATFORM) {
  const grid = volumeGrid();
  const at = shownLevel(grid);
  const p = pins();
  const next = volumeView(level, at, p, grid);
  if (next.fixed || next.value === volumeView(at, at, p, grid).value) return;
  let send = senders.get(clock);
  if (!send) {
    send = pacedSender(clock);
    senders.set(clock, send);
  }
  send(String(next.value));
}

/**
 * The loudness bounds along the slider, as percentages of its range; null unless the matrix engine and loudness both
 * run with the level free, since loudness does not reach the output otherwise (store/matrix/loudness.js).
 *
 * @returns {{ lo: number, hi: number, width: number } | null}
 */
export function loudnessMarks() {
  const b = loudnessBounds();
  return b && loudSpan(b.low, b.high, volumeGrid());
}

/**
 * The loudness bounds in dBFS, on the same terms as loudnessMarks: null unless the matrix engine and loudness both run
 * with the level free.
 *
 * @returns {{ low: number, high: number } | null}
 */
export function loudnessBounds() {
  if (!truthy(runningValue("matrix_enabled")) || !truthy(runningValue("loudness_enabled"))) return null;
  if (volumeNow().fixed) return null;
  return {
    low: wireNum(runningValue("loudness_range_low"), -60),
    high: wireNum(runningValue("loudness_range_high"), -20),
  };
}
