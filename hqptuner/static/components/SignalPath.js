// Signal path bar — the front panel. The live chain in physical processing order:
// source → Bauer crossfeed (input-side, pre-oversampling) → oversampling filter →
// dither/modulator → DAC correction → output rate. Crossfeed operates on the
// source-rate signal; DAC correction is a per-DAC response correction and so runs
// at the OUTPUT rate, after oversampling+modulation — it is output-rate-dependent
// and cannot precede the filter (this corrects outline §3, which grouped both
// post-process stages "before oversampling"; §3's order was flagged unverified).
// A disabled post-process stage is omitted entirely, so the chain only ever shows
// what's actually in the path. Stages read as one continuous chain (connector
// thread, not floating arrows); playing carries the accent through the thread and
// glows the output Rate chip; idle dims the bar.
//
// Data sources differ by stage: the active filter/shaper/rate come off the live
// Status frame (st.*), DAC correction from its live `correction` 0/1 flag, and
// crossfeed — which has no live readback (no live setter) — from the config lane.
import { html } from "../store/dom.js";
import { engineStatus, engineState, effective } from "../store/state.js";

const PLAYING = 2; // State: 0 Stopped, 1 Paused, 2 Playing, 3 Stopping
const DSD_FLOOR = 2822400; // DSD64 (44.1k × 64) — the lowest 1-bit bitstream rate

// The front panel shows the actual frequency, not a DSD multiplier: a DSD
// bitstream is a 1-bit stream at this rate, so "24.576 MHz" reads truer than
// "DSD512" (and sidesteps the 44.1k-vs-48k base ambiguity that mislabeled it).
function fmtRate(hz) {
  const n = Number(hz);
  if (!n) return "—";
  if (n >= DSD_FLOOR) return `${(n / 1e6).toFixed(3)} MHz`;
  return n >= 1000 ? `${n / 1000} kHz` : `${n} Hz`;
}

const on = (v) => v === true || v === 1 || v === "1" || v === "on" || v === "true";

function Chip({ label, value, hero }) {
  return html`
    <span class="chip ${hero ? "chip-hero" : ""}">
      <span class="chip-label">${label}</span>
      <span class="chip-val">${value || "—"}</span>
    </span>
  `;
}

export function SignalPath() {
  // /api/status payload is { status: {active_*...}, metadata: {track tags} } —
  // the active chain lives on the Status root (status.*), the track info on the
  // metadata child.
  const s = engineStatus.value || {};
  const st = s.status || {};
  const md = s.metadata || {};
  const playing = Number((engineState.value || {}).state) === PLAYING;

  const source = md.samplerate ? `${fmtRate(md.samplerate)} / ${md.bits || "?"}bit` : st.active_mode || "—";
  // output stage: a DSD bitstream is always 1-bit, so pair the MHz with "/ 1bit"
  const outRate = Number(st.active_rate) >= DSD_FLOOR ? `${fmtRate(st.active_rate)} / 1bit` : fmtRate(st.active_rate);

  // build the chain in processing order, omitting disabled post-process stages:
  // crossfeed sits before the filter (input-side), DAC correction after the
  // shaper (output-rate-dependent).
  const stages = [{ label: "Source", value: source }];
  // one combined post-process indicator instead of a chip per feature (avoids
  // crowding the front panel): both on -> "DSP", else the single active one.
  const cf = on(effective("crossfeed_enabled"));
  const loud = on(effective("loudness_enabled"));
  if (cf && loud) stages.push({ label: "DSP", value: "On" });
  else if (cf) stages.push({ label: "Crossfeed", value: "On" });
  else if (loud) stages.push({ label: "Loudness", value: "On" });
  stages.push({ label: "Filter", value: st.active_filter });
  stages.push({ label: "Shaper", value: st.active_shaper });
  if (st.correction === "1") stages.push({ label: "Correction", value: "On" });
  stages.push({ label: "Rate", value: outRate, hero: true });

  const nodes = [];
  stages.forEach((stage, i) => {
    if (i) nodes.push(html`<span class="link"></span>`);
    nodes.push(html`<${Chip} label=${stage.label} value=${stage.value} hero=${stage.hero} />`);
  });

  return html`<div class="signal-path ${playing ? "live" : "idle"}">${nodes}</div>`;
}
