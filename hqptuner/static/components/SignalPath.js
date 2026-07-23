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
// crossfeed/loudness/matrix from the RUNNING config forms (runningValue — never
// effective: the front panel reflects the active state, so a previewed preset
// or a staged-but-unapplied edit must not move these chips).
import { html } from "../lib/dom.js";
import { engineStatus, engineState, runningValue, matrixActiveProfile } from "../store/state.js";

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

// Source describes the incoming stream, so it only means anything while one
// exists — a bare dash otherwise (not "N/A", not the engine's remembered rate).
function sourceLabel(md) {
  if (!md.samplerate) return "—";
  return `${fmtRate(md.samplerate)} / ${md.bits || "?"}bit`;
}

// A DSD bitstream is always 1-bit, so pair the MHz with "/ 1bit".
function outputLabel(rate) {
  if (Number(rate) >= DSD_FLOOR) return `${fmtRate(rate)} / 1bit`;
  return fmtRate(rate);
}

// The matrix chip carries the ACTIVE profile name so A/B switches read straight
// off the front panel; the unnamed default and over-long names fall back.
function matrixLabel(prof) {
  if (prof === "[Default]") return "On";
  return prof.length > 20 ? `${prof.slice(0, 19)}…` : prof;
}

// Crossfeed and loudness share ONE post-process slot — both active collapses to
// "DSP" rather than a chip each, which would crowd the panel.
function postProcessStage(cf, loud) {
  if (cf && loud) return { label: "DSP", value: "On" };
  if (cf) return { label: "Crossfeed", value: "On" };
  if (loud) return { label: "Loudness", value: "On" };
  return null;
}

// The chain in processing order, omitting disabled post-process stages: matrix
// and crossfeed are input-side and precede the filter; DAC correction is
// output-rate-dependent and follows the shaper.
function chainStages(st, md, playing) {
  const stages = [{ label: "Source", value: playing ? sourceLabel(md) : "—" }];
  if (on(runningValue("matrix_enabled"))) {
    stages.push({ label: "Matrix", value: matrixLabel(matrixActiveProfile.value) });
  }
  const post = postProcessStage(on(runningValue("crossfeed_enabled")), on(runningValue("loudness_enabled")));
  if (post) stages.push(post);
  stages.push({ label: "Filter", value: st.active_filter });
  stages.push({ label: "Shaper", value: st.active_shaper });
  if (st.correction === "1") stages.push({ label: "Correction", value: "On" });
  stages.push({ label: "Output", value: playing ? outputLabel(st.active_rate) : "—", hero: true });
  return stages;
}

export function SignalPath() {
  // /api/status payload is { status: {active_*...}, metadata: {track tags} } —
  // the active chain lives on the Status root (status.*), the track info on the
  // metadata child.
  const s = engineStatus.value || {};
  const st = s.status || {};
  const md = s.metadata || {};
  const playing = Number((engineState.value || {}).state) === PLAYING;

  const nodes = [];
  chainStages(st, md, playing).forEach((stage, i) => {
    if (i) nodes.push(html`<span class="link"></span>`);
    nodes.push(html`<${Chip} label=${stage.label} value=${stage.value} hero=${stage.hero} />`);
  });

  return html`<div class="signal-path ${playing ? "live" : "idle"}">${nodes}</div>`;
}
