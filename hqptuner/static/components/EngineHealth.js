// Engine-health meter cluster — the System tab's full-width live card. A
// VU-style needle gauge for process speed (the scale is piecewise-linear
// across hand-picked ticks so the 1.00–1.05× danger region gets the angular
// resolution; past 4× the needle just pegs, like a real VU), bar meters for
// the input/output buffer fill, and flat counters for clips / apodizing
// events (per-track deltas from store/health.js, totals muted beside).
// All values are playback-time readings — idle dims the cluster and parks
// the needle. Data is the same 2 s Status poll the alert strip uses; the
// needle's CSS transform transition gives it damped-ballistics sweep
// between polls.
import { html } from "../lib/dom.js";
import { engineStatus } from "../store/state.js";
import { trackCounters } from "../store/health.js";

const TICKS = [0.5, 0.8, 1.0, 1.05, 1.2, 1.5, 2, 4];
const A0 = -60;
const A1 = 60;
const SEG = (A1 - A0) / (TICKS.length - 1);

// value -> needle angle: equal angular spacing per tick interval, linear
// within one, clamped (pegged) at both ends.
function angleFor(v) {
  if (v === null || v <= TICKS[0]) return A0;
  if (v >= TICKS[TICKS.length - 1]) return A1;
  for (let i = 0; i < TICKS.length - 1; i++) {
    if (v <= TICKS[i + 1]) return A0 + SEG * (i + (v - TICKS[i]) / (TICKS[i + 1] - TICKS[i]));
  }
  return A1;
}

const CX = 110;
const CY = 112;
const rad = (deg) => (deg * Math.PI) / 180;
const px = (a, r) => CX + r * Math.sin(rad(a));
const py = (a, r) => CY - r * Math.cos(rad(a));
const arc = (a, b, r) => `M ${px(a, r)} ${py(a, r)} A ${r} ${r} 0 0 1 ${px(b, r)} ${py(b, r)}`;

// zone arcs: red up to 1.00×, amber to 1.05×, neutral above
const ZONES = [
  { from: A0, to: angleFor(1.0), cls: "vu-zone-crit" },
  { from: angleFor(1.0), to: angleFor(1.05), cls: "vu-zone-warn" },
  { from: angleFor(1.05), to: A1, cls: "vu-zone-ok" },
];

const VuGauge = ({ speed }) => html`
  <div class="vu">
    <svg viewBox="0 0 220 132" role="img" aria-label="Process speed gauge">
      ${ZONES.map((z) => html`<path class=${z.cls} d=${arc(z.from, z.to, 92)} />`)}
      ${TICKS.map((t, i) => {
        const a = A0 + SEG * i;
        return html`
          <line class="vu-tick" x1=${px(a, 82)} y1=${py(a, 82)} x2=${px(a, 90)} y2=${py(a, 90)} />
          <text class="vu-label" x=${px(a, 74)} y=${py(a, 74)} text-anchor="middle" dominant-baseline="middle">
            ${t}
          </text>
        `;
      })}
      <line
        class="vu-needle"
        x1=${CX}
        y1=${CY}
        x2=${CX}
        y2=${CY - 84}
        style="transform: rotate(${angleFor(speed)}deg); transform-origin: ${CX}px ${CY}px"
      />
      <circle class="vu-hub" cx=${CX} cy=${CY} r="5" />
    </svg>
    <div class="vu-readout">${speed === null ? "—" : `${speed.toFixed(2)}×`}</div>
    <div class="vu-caption">process speed</div>
  </div>
`;

const Meter = ({ label, frac }) => html`
  <div class="meter-row">
    <span class="meter-label">${label}</span>
    <span class="meter-lg ${frac !== null && frac < 0.15 ? "low" : ""}">
      <span class="meter-fill" style="width: ${frac === null ? 0 : Math.round(frac * 100)}%"></span>
      <span class="meter-tick" style="left: 25%"></span>
      <span class="meter-tick" style="left: 50%"></span>
      <span class="meter-tick" style="left: 75%"></span>
    </span>
    <span class="meter-val">${frac === null ? "—" : `${Math.round(frac * 100)}%`}</span>
  </div>
`;

const Counter = ({ label, delta, total, alert }) => html`
  <div class="eh-counter ${alert ? "alert" : ""}">
    <span class="eh-counter-label">${label}</span>
    <span class="eh-counter-val">${delta === null ? "—" : delta}</span>
    <span class="eh-counter-total">${total === null ? "this track" : `this track · ${total} total`}</span>
  </div>
`;

export function EngineHealth() {
  const st = ((engineStatus.value || {}).status) || {};
  const playing = Number(st.state) === 2;
  const n = (v) => {
    const x = Number(v);
    return playing && v != null && v !== "" && Number.isFinite(x) ? x : null;
  };
  // fills are 0.0–1.0, but the daemon reports -1 when a buffer doesn't apply
  // (observed live: input_fill=-1 during NAA playback) — that's "n/a", not 0%.
  const fill = (v) => {
    const f = n(v);
    return f === null || f < 0 ? null : Math.min(f, 1);
  };
  const c = trackCounters.value;
  const clips = playing ? c.clips : null;
  const apod = playing ? c.apod : null;
  return html`
    <div class="eh-cluster ${playing ? "" : "eh-idle"}">
      <${VuGauge} speed=${n(st.process_speed)} />
      <div class="eh-meters">
        <${Meter} label="Input buffer" frac=${fill(st.input_fill)} />
        <${Meter} label="Output buffer" frac=${fill(st.output_fill)} />
      </div>
      <div class="eh-counters">
        <${Counter} label="Clips" delta=${clips} total=${n(st.clips)} alert=${!!clips} />
        <${Counter} label="Apodizing events" delta=${apod} total=${n(st.apod)} alert=${false} />
      </div>
    </div>
  `;
}
