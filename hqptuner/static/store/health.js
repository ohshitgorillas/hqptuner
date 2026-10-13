// Engine-health alerts off the Status frame's health fields (clips, apod,
// process_speed, input_fill/output_fill) — the daemon reports these but its own
// UI barely surfaces them. Everything is evaluated only while PLAYING: idle
// values are engine leftovers, not health.
//
// clips/apod are cumulative counters, so alerts work on per-track deltas
// (baseline reset when track_serial changes). process_speed flutters at track
// edges, so each of its alerts fires only once speed has stayed below its
// threshold for SUSTAIN_MS on the clock (and clears instantly on recovery).
import { signal, computed, effect } from "@preact/signals";
import { engineStatus, PLAYING } from "./signals.js";
import { filterFacets } from "./narrow/facets.js";
import { PLATFORM } from "../lib/clock.js";
import { num } from "../lib/coerce.js";
import { quietWindow } from "../model/shell/timing.js";

/** @typedef {import("../lib/clock.js").Clock} Clock */
/** @typedef {ReturnType<typeof quietWindow>} Wait */

// 1.05× is the danger floor for sustained DSP throughput (below it, transient
// load spikes eat the margin); below 1.00× the engine is actively dropping.
const SPEED_WARN = 1.05;
const SPEED_CRIT = 1.0;
// How long speed must stay below a threshold before that threshold's alert
// fires. Status frames arrive only when something changes, so the wait runs on
// a timer.
const SUSTAIN_MS = 6000;
// A handful of apodizing events per track is normal on ordinary material; the
// alert is only worth the user's attention once they pile up.
const APOD_MIN = 10;
// Same idea for clipping: wait for a pile-up rather than the first event.
const CLIP_MIN = 10;

// per-track counter baselines + which slow-speed waits have run out (internal state)
const track = signal({ serial: null, clips0: 0, apod0: 0 });
const slow = signal({ warn: false, crit: false });

// Per severity, whether the last frame qualified, so a wait starts only on the
// frame that begins qualifying.
/** @type {Record<Severity, boolean>} */
const qualifying = { warn: false, crit: false };

// Whether output_fill has been seen > 0 at least once this track. A buffer that
// only ever holds at 0 does not apply to this output (SDM/DSD direct paths
// report a flat 0, input_fill a flat -1) — the engine row shows no reading rather
// than a false 0%. There is deliberately no sustained-low "starvation" alert:
// a real output-buffer underrun is transient by design — the buffer drains to
// 0, playback skips for a moment, then it refills to 100% — never a sustained
// low, so any sustained-low reading is a non-applicable buffer, not a fault.
const outputActive = signal(false);
export const outputBufferApplies = computed(() => outputActive.value);

// A clip flash per frame whose clip counter rose over the frame before it on the
// same track: `level` is 1 on that frame and 0 on any other, and `seq` counts the
// rises, so a reader can restart a flash on each one.
export const clipFlash = signal({ seq: 0, level: 0 });
let prevClips = 0;

/**
 * @typedef {object} StatusFrame
 *   The daemon's Status frame as /api/status serves it under `status`. Every
 *   attribute arrives as a string off the 4321 XML; the numeric ones are coerced
 *   at the point of use.
 * @property {string} [state]
 * @property {string} [track_serial]
 * @property {string} [clips]
 * @property {string} [apod]
 * @property {string} [process_speed]
 * @property {string} [input_fill]
 * @property {string} [output_fill]
 * @property {string} [active_filter]
 *
 * @typedef {"warn" | "crit"} Severity
 *
 * @typedef {Record<Severity, boolean>} Slow
 *   Per severity, whether speed has held below that threshold for SUSTAIN_MS.
 *
 * @typedef {{ kind: string, sev: string, text: string }} Alert
 *   One engine-health alert, placed on the faceplate by store/faceplate/alerts.js.
 *   `kind` identifies which alert this is and `sev` how bad it is; `text` is the
 *   wording, which nothing but the reader depends on.
 */

// Slow-speed/baseline bookkeeping. Subscribes to engineStatus ONLY — internal
// signals are peek()ed so the effect never re-triggers itself.
//
// Registration is idempotent: the effects would share one set of baselines and
// waits, so a second registration would judge every frame twice. Returns the
// disposer for a caller that wants it; it stops the effect and cancels both
// pending waits.
/** @type {(() => void) | null} */
let dispose = null;

/**
 * Register the slow-speed/baseline effect once, and hand back its disposer.
 *
 * @param {Clock} [clock] the clock the slow-speed waits run on; a later call keeps the first registration's
 */
export function initHealth(clock = PLATFORM) {
  if (dispose) return dispose;
  /** @type {Record<Severity, Wait>} */
  const waits = {
    warn: quietWindow(SUSTAIN_MS, () => markSlow("warn", true), clock),
    crit: quietWindow(SUSTAIN_MS, () => markSlow("crit", true), clock),
  };
  const stop = effect(() => {
    const st = (engineStatus.value || {}).status;
    if (!st) return;
    rebaseline(st);
    flashClips(st);
    if (Number(st.state) === PLAYING && num(st.output_fill) > 0 && !outputActive.peek()) {
      outputActive.value = true; // this output populates a buffer — latch for the track
    }
    const below = belowThresholds(st);
    waitOut("warn", below.warn, waits.warn);
    waitOut("crit", below.crit, waits.crit);
  });
  dispose = () => {
    stop();
    waits.warn.cancel();
    waits.crit.cancel();
  };
  return dispose;
}

// Rebaseline the per-track counters when the track changes. Strict !== on the
// raw value, so a serial that merely changes type still counts as a new track.
/**
 * @param {StatusFrame} st
 * @returns {void}
 */
function rebaseline(st) {
  const t = track.peek();
  if (st.track_serial === t.serial) return;
  track.value = { serial: st.track_serial, clips0: num(st.clips), apod0: num(st.apod) };
  outputActive.value = false; // re-prove the buffer applies on each new track
  prevClips = num(st.clips);
}

/**
 * @param {StatusFrame} st
 * @returns {void}
 */
function flashClips(st) {
  const clips = num(st.clips);
  const f = clipFlash.peek();
  if (clips > prevClips) clipFlash.value = { seq: f.seq + 1, level: 1 };
  else if (f.level !== 0) clipFlash.value = { seq: f.seq, level: 0 };
  prevClips = clips;
}

// One severity's wait: start it on the first qualifying frame and let further
// qualifying frames leave it running; the frame that stops qualifying cancels
// it and clears the alert — recovery is immediate, never decayed.
/**
 * @param {Severity} sev
 * @param {boolean} qualifies
 * @param {Wait} wait
 * @returns {void}
 */
function waitOut(sev, qualifies, wait) {
  const was = qualifying[sev];
  qualifying[sev] = qualifies;
  if (qualifies) {
    if (!was) wait.arm();
    return;
  }
  wait.cancel();
  if (slow.peek()[sev]) markSlow(sev, false);
}

/**
 * @param {Severity} sev
 * @param {boolean} on
 * @returns {void}
 */
function markSlow(sev, on) {
  slow.value = { ...slow.peek(), [sev]: on };
}

// A usable speed figure. 0 and negatives mean "no reading", not "infinitely
// slow", so they start the wait over rather than tripping it.
const usableSpeed = (/** @type {number} */ sp) => sp > 0;

/**
 * @param {StatusFrame} st
 * @returns {Slow}
 */
function belowThresholds(st) {
  const playing = Number(st.state) === PLAYING;
  // an unreadable speed reads as 0, which usableSpeed rejects
  const sp = num(st.process_speed);
  const speedOk = playing && usableSpeed(sp);
  return {
    warn: speedOk && sp < SPEED_WARN,
    crit: speedOk && sp < SPEED_CRIT,
  };
}

// This track's counter deltas — the engine row shows them alongside the raw
// totals.
export const trackCounters = computed(() => {
  const st = (engineStatus.value || {}).status;
  const t = track.value;
  if (!st) return { clips: 0, apod: 0 };
  return {
    clips: Math.max(0, num(st.clips) - t.clips0),
    apod: Math.max(0, num(st.apod) - t.apod0),
  };
});

// The engine-health alert list: [{kind, sev: "warn"|"crit", text}]. Empty
// when healthy or idle.
//
// `kind` names WHICH alert fired, independent of its wording; the faceplate
// homes each alert by it (store/faceplate/alerts.js). Without it the sentence
// would be the only thing telling two alerts apart, making the copy load-bearing.
// One alert per category, or null. Order below is the order they render in.
// Critical speed supersedes the warning rather than joining it — they describe
// the same fault at two severities. The remedy names the DSP chain, not the
// network path to the device (connectivity has nothing to do with throughput).
const SLOW_DSP_TAIL = "Use a lighter filter or a lower output rate.";

/**
 * @param {Slow} s
 * @param {number} sp
 * @returns {Alert | null}
 */
function speedAlert(s, sp) {
  if (s.crit) {
    return {
      kind: "dsp-speed",
      sev: "crit",
      text: `DSP at ${sp.toFixed(2)}× realtime — actively dropping out. ${SLOW_DSP_TAIL}`,
    };
  }
  if (s.warn)
    return {
      kind: "dsp-speed",
      sev: "warn",
      text: `DSP at ${sp.toFixed(2)}× realtime — dropout risk. ${SLOW_DSP_TAIL}`,
    };
  return null;
}

/**
 * @param {number} clips
 * @returns {Alert | null}
 */
function clipAlert(clips) {
  if (clips < CLIP_MIN) return null;
  return { kind: "clipping", sev: "warn", text: `Clipping ×${clips} this track — reduce volume or gain.` };
}

// Only worth raising when the running filter is one an apodizing swap would
// help — silent for an unknown filter rather than guessing.
/**
 * @param {number} apod
 * @param {string} filterName
 * @returns {Alert | null}
 */
function apodAlert(apod, filterName) {
  if (apod < APOD_MIN) return null;
  const f = filterFacets.value[filterName];
  if (!f || f.apodizing || f.apodizingHalf) return null;
  const text = `Apodizing events ×${apod} this track, but ${filterName} is non-apodizing — consider an apodizing filter.`;
  return { kind: "apodizing", sev: "warn", text };
}

export const engineAlerts = computed(() => {
  const st = (engineStatus.value || {}).status;
  if (!st || Number(st.state) !== PLAYING) return [];
  const s = slow.value;
  const counters = trackCounters.value;
  return [
    speedAlert(s, num(st.process_speed)),
    clipAlert(counters.clips),
    apodAlert(counters.apod, st.active_filter),
  ].filter(Boolean);
});
