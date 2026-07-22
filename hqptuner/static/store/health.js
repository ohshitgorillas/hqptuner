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
export function initHealth() {
  effect(() => {
    const st = (engineStatus.value || {}).status;
    if (!st) return;
    const t = track.peek();
    if (st.track_serial !== t.serial) {
      track.value = { serial: st.track_serial, clips0: num(st.clips) || 0, apod0: num(st.apod) || 0 };
    }
    const playing = Number(st.state) === PLAYING;
    const sp = num(st.process_speed);
    const fill = num(st.output_fill);
    const s = streak.peek();
    const next = {
      warn: playing && sp !== null && sp > 0 && sp < SPEED_WARN ? s.warn + 1 : 0,
      crit: playing && sp !== null && sp > 0 && sp < SPEED_CRIT ? s.crit + 1 : 0,
      // fill = -1 means "buffer doesn't apply" (observed live), not starvation
      fill: playing && fill !== null && fill >= 0 && fill < FILL_LOW ? s.fill + 1 : 0,
    };
    if (next.warn !== s.warn || next.crit !== s.crit || next.fill !== s.fill) streak.value = next;
  });
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
export const engineAlerts = computed(() => {
  const st = (engineStatus.value || {}).status;
  if (!st || Number(st.state) !== PLAYING) return [];
  const alerts = [];
  const s = streak.value;
  const sp = num(st.process_speed);
  if (s.crit >= SUSTAIN) {
    alerts.push({
      sev: "crit",
      text: `DSP at ${sp.toFixed(2)}× realtime — actively dropping out. Use a lighter filter or a lower output rate.`,
    });
  } else if (s.warn >= SUSTAIN) {
    alerts.push({
      sev: "warn",
      text: `DSP at ${sp.toFixed(2)}× realtime — dropout risk. Use a lighter filter or a lower output rate.`,
    });
  }
  if (s.fill >= SUSTAIN) {
    const pct = Math.round((num(st.output_fill) || 0) * 100);
    alerts.push({
      sev: "warn",
      text: `Output buffer at ${pct}% — starvation. Check the network path to the audio device.`,
    });
  }
  const counters = trackCounters.value;
  if (counters.clips > 0) {
    alerts.push({ sev: "warn", text: `Clipping ×${counters.clips} this track — reduce volume or gain.` });
  }
  if (counters.apod > 0) {
    const f = filterFacets.value[st.active_filter];
    if (f && !f.apodizing && !f.apodizingHalf) {
      alerts.push({
        sev: "warn",
        text: `Apodizing events ×${counters.apod} this track, but ${st.active_filter} is non-apodizing — consider an apodizing filter.`,
      });
    }
  }
  return alerts;
});
