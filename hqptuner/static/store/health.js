// Engine-health alerts off the Status frame's health fields (clips, apod,
// process_speed, input_fill/output_fill) — the daemon reports these but its own
// UI barely surfaces them. Everything is evaluated only while PLAYING: idle
// values are engine leftovers, not health.
//
// clips/apod are cumulative counters, so alerts work on per-track deltas
// (baseline reset when track_serial changes). process_speed and output_fill
// flutter at track edges, so their alerts require SUSTAIN consecutive
// below-threshold polls before firing (and clear instantly on recovery).
import { signal, computed, effect } from "@preact/signals";
import { engineStatus } from "./state.js";
import { filterFacets } from "./facets.js";

const PLAYING = 2;
// 1.05× is the danger floor for sustained DSP throughput (below it, transient
// load spikes eat the margin); below 1.00× the engine is actively dropping.
const SPEED_WARN = 1.05;
const SPEED_CRIT = 1.0;
const FILL_LOW = 0.15; // output_fill is 0.0–1.0 (protocol.md §Status)
const SUSTAIN = 3; // consecutive polls (~6 s at the 2 s cadence)

// per-track counter baselines + consecutive-poll streaks (internal state)
const track = signal({ serial: null, clips0: 0, apod0: 0 });
const streak = signal({ warn: 0, crit: 0, fill: 0 });

const num = (v) => {
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
let dispose = null;

export function initHealth() {
  if (dispose) return dispose;
  dispose = effect(() => {
    const st = (engineStatus.value || {}).status;
    if (!st) return;
    rebaseline(st);
    const s = streak.peek();
    const next = nextStreak(st, s);
    if (next.warn !== s.warn || next.crit !== s.crit || next.fill !== s.fill) streak.value = next;
  });
  return dispose;
}

// Rebaseline the per-track counters when the track changes. Strict !== on the
// raw value, so a serial that merely changes type still counts as a new track.
function rebaseline(st) {
  const t = track.peek();
  if (st.track_serial === t.serial) return;
  track.value = { serial: st.track_serial, clips0: num(st.clips) || 0, apod0: num(st.apod) || 0 };
}

// One streak step: count up while the reading qualifies, drop to zero the moment
// it doesn't — recovery is immediate, never decayed.
const step = (prev, qualifies) => (qualifies ? prev + 1 : 0);

// A usable speed figure. 0 and negatives mean "no reading", not "infinitely
// slow", so they reset the streak rather than tripping it.
const usableSpeed = (sp) => sp !== null && sp > 0;
// fill = -1 means "buffer doesn't apply" (observed live), not starvation.
const usableFill = (f) => f !== null && f >= 0;

function nextStreak(st, s) {
  const playing = Number(st.state) === PLAYING;
  const sp = num(st.process_speed);
  const fill = num(st.output_fill);
  const speedOk = playing && usableSpeed(sp);
  return {
    warn: step(s.warn, speedOk && sp < SPEED_WARN),
    crit: step(s.crit, speedOk && sp < SPEED_CRIT),
    fill: step(s.fill, playing && usableFill(fill) && fill < FILL_LOW),
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
// the same fault at two severities.
// Both alerts below share this remedy: the output buffer is starving because
// the DSP chain can't keep up, not because of the network path to the device
// (network connectivity has nothing to do with the output buffer).
const SLOW_DSP_TAIL = "Use a lighter filter or a lower output rate.";

function speedAlert(s, sp) {
  if (s.crit >= SUSTAIN) {
    return { sev: "crit", text: `DSP at ${sp.toFixed(2)}× realtime — actively dropping out. ${SLOW_DSP_TAIL}` };
  }
  if (s.warn >= SUSTAIN)
    return { sev: "warn", text: `DSP at ${sp.toFixed(2)}× realtime — dropout risk. ${SLOW_DSP_TAIL}` };
  return null;
}

function fillAlert(s, st) {
  if (s.fill < SUSTAIN) return null;
  const pct = Math.round((num(st.output_fill) || 0) * 100);
  return { sev: "warn", text: `Output buffer at ${pct}% — starvation. ${SLOW_DSP_TAIL}` };
}

function clipAlert(clips) {
  if (clips <= 0) return null;
  return { sev: "warn", text: `Clipping ×${clips} this track — reduce volume or gain.` };
}

// Only worth raising when the running filter is one an apodizing swap would
// help — silent for an unknown filter rather than guessing.
function apodAlert(apod, filterName) {
  if (apod <= 0) return null;
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
    speedAlert(s, num(st.process_speed)),
    fillAlert(s, st),
    clipAlert(counters.clips),
    apodAlert(counters.apod, st.active_filter),
  ].filter(Boolean);
});
