// Engine-health alerts off the Status frame's health fields (clips, apod,
// process_speed, input_fill/output_fill) — the daemon reports these but its own
// UI barely surfaces them. Everything is evaluated only while PLAYING: idle
// values are engine leftovers, not health.
//
// clips/apod are cumulative counters, so alerts work on per-track deltas
// (baseline reset when track_serial changes). process_speed flutters at track
// edges, so its alerts require SUSTAIN consecutive below-threshold polls before
// firing (and clear instantly on recovery).
import { signal, computed, effect } from "@preact/signals";
import { engineStatus } from "./signals.js";
import { filterFacets } from "./facets.js";

const PLAYING = 2;
// 1.05× is the danger floor for sustained DSP throughput (below it, transient
// load spikes eat the margin); below 1.00× the engine is actively dropping.
const SPEED_WARN = 1.05;
const SPEED_CRIT = 1.0;
const SUSTAIN = 3; // consecutive polls (~6 s at the 2 s cadence)
// A handful of apodizing events per track is normal on ordinary material; the
// alert is only worth the user's attention once they pile up.
const APOD_MIN = 10;
// Same idea for clipping: wait for a pile-up rather than the first event.
const CLIP_MIN = 10;

// per-track counter baselines + consecutive-poll streaks (internal state)
const track = signal({ serial: null, clips0: 0, apod0: 0 });
const streak = signal({ warn: 0, crit: 0 });

// Whether output_fill has been seen > 0 at least once this track. A buffer that
// only ever holds at 0 does not apply to this output (SDM/DSD direct paths
// report a flat 0, input_fill a flat -1) — the meter shows it as N/A rather
// than a false 0%. There is deliberately no sustained-low "starvation" alert:
// a real output-buffer underrun is transient by design — the buffer drains to
// 0, playback skips for a moment, then it refills to 100% — never a sustained
// low, so any sustained-low reading is a non-applicable buffer, not a fault.
const outputActive = signal(false);
export const outputBufferApplies = computed(() => outputActive.value);

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
 * @typedef {{ warn: number, crit: number }} Streak
 *   Consecutive below-threshold polls, one count per severity.
 */

const num = (/** @type {string | number | undefined} */ v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Streak/baseline bookkeeping. Subscribes to engineStatus ONLY — internal
// signals are peek()ed so the effect never re-triggers itself.
//
// Registration is idempotent, and has to be: the effects share one `streak`, so
// each extra registration advances it again per poll and an alert fires after
// ceil(SUSTAIN/n) polls instead of SUSTAIN — a second call silently cuts the
// sustain threshold to 2 polls, a third to 1. app.js calls this once, but
// nothing enforced that, and the dispose handle was dropped so the duplicate
// could never be unregistered. Returns the disposer for a caller that wants it.
/** @type {(() => void) | null} */
let dispose = null;

export function initHealth() {
  if (dispose) return dispose;
  dispose = effect(() => {
    const st = (engineStatus.value || {}).status;
    if (!st) return;
    rebaseline(st);
    if (Number(st.state) === PLAYING && (num(st.output_fill) || 0) > 0 && !outputActive.peek()) {
      outputActive.value = true; // this output populates a buffer — latch for the track
    }
    const s = streak.peek();
    const next = nextStreak(st, s);
    if (next.warn !== s.warn || next.crit !== s.crit) streak.value = next;
  });
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
  track.value = { serial: st.track_serial, clips0: num(st.clips) || 0, apod0: num(st.apod) || 0 };
  outputActive.value = false; // re-prove the buffer applies on each new track
}

// One streak step: count up while the reading qualifies, drop to zero the moment
// it doesn't — recovery is immediate, never decayed.
const step = (/** @type {number} */ prev, /** @type {boolean} */ qualifies) => (qualifies ? prev + 1 : 0);

// A usable speed figure. 0 and negatives mean "no reading", not "infinitely
// slow", so they reset the streak rather than tripping it.
const usableSpeed = (/** @type {number} */ sp) => sp !== null && sp > 0;

/**
 * @param {StatusFrame} st
 * @param {Streak} s
 * @returns {Streak}
 */
function nextStreak(st, s) {
  const playing = Number(st.state) === PLAYING;
  // an unreadable speed is 0, which usableSpeed rejects exactly as the null did
  const sp = num(st.process_speed) ?? 0;
  const speedOk = playing && usableSpeed(sp);
  return {
    warn: step(s.warn, speedOk && sp < SPEED_WARN),
    crit: step(s.crit, speedOk && sp < SPEED_CRIT),
  };
}

// This track's counter deltas — the System-tab health card shows them alongside
// the raw totals.
export const trackCounters = computed(() => {
  const st = (engineStatus.value || {}).status;
  const t = track.value;
  if (!st) return { clips: 0, apod: 0 };
  return {
    clips: Math.max(0, (num(st.clips) || 0) - t.clips0),
    apod: Math.max(0, (num(st.apod) || 0) - t.apod0),
  };
});

// The alert list the strip renders: [{sev: "warn"|"crit", text}]. Empty when
// healthy or idle — the strip contributes zero chrome then.
// One alert per category, or null. Order below is the order they render in.
// Critical speed supersedes the warning rather than joining it — they describe
// the same fault at two severities. The remedy names the DSP chain, not the
// network path to the device (connectivity has nothing to do with throughput).
const SLOW_DSP_TAIL = "Use a lighter filter or a lower output rate.";

/**
 * @param {Streak} s
 * @param {number} sp
 * @returns {{ sev: string, text: string } | null}
 */
function speedAlert(s, sp) {
  if (s.crit >= SUSTAIN) {
    return { sev: "crit", text: `DSP at ${sp.toFixed(2)}× realtime — actively dropping out. ${SLOW_DSP_TAIL}` };
  }
  if (s.warn >= SUSTAIN)
    return { sev: "warn", text: `DSP at ${sp.toFixed(2)}× realtime — dropout risk. ${SLOW_DSP_TAIL}` };
  return null;
}

/**
 * @param {number} clips
 * @returns {{ sev: string, text: string } | null}
 */
function clipAlert(clips) {
  if (clips < CLIP_MIN) return null;
  return { sev: "warn", text: `Clipping ×${clips} this track — reduce volume or gain.` };
}

// Only worth raising when the running filter is one an apodizing swap would
// help — silent for an unknown filter rather than guessing.
/**
 * @param {number} apod
 * @param {string} filterName
 * @returns {{ sev: string, text: string } | null}
 */
function apodAlert(apod, filterName) {
  if (apod < APOD_MIN) return null;
  const f = filterFacets.value[filterName];
  if (!f || f.apodizing || f.apodizingHalf) return null;
  const text = `Apodizing events ×${apod} this track, but ${filterName} is non-apodizing — consider an apodizing filter.`;
  return { sev: "warn", text };
}

export const engineAlerts = computed(() => {
  const st = (engineStatus.value || {}).status;
  if (!st || Number(st.state) !== PLAYING) return [];
  const s = streak.value;
  const counters = trackCounters.value;
  return [
    speedAlert(s, num(st.process_speed) ?? 0),
    clipAlert(counters.clips),
    apodAlert(counters.apod, st.active_filter),
  ].filter(Boolean);
});
