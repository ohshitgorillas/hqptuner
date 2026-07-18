// Signal path bar: source -> filter -> shaper -> rate, updating live. Manual-
// derived order (outline §3): source, then post-process (crossfeed/correction,
// added in later steps), then the active filter, dither/modulator, output rate,
// device. Step 1 shows the core chain from the live Status frame.
import { html } from "../store/dom.js";
import { engineStatus } from "../store/state.js";

function fmtRate(hz) {
  const n = Number(hz);
  if (!n) return "—";
  if (n >= 2822400) return `DSD${Math.round(n / 44100)}`;
  return n >= 1000 ? `${n / 1000}k` : `${n}`;
}

function Chip({ label, value }) {
  return html`<span class="chip"><span class="chip-label">${label}</span><span class="chip-val">${value || "—"}</span></span>`;
}

export function SignalPath() {
  const s = engineStatus.value || {};
  const md = s.metadata || {};
  const source = md.samplerate ? `${fmtRate(md.samplerate)} / ${md.bits || "?"}bit` : s.active_mode || "—";
  return html`
    <div class="signal-path">
      <${Chip} label="Source" value=${source} />
      <span class="arrow">→</span>
      <${Chip} label="Filter" value=${s.active_filter} />
      <span class="arrow">→</span>
      <${Chip} label="Shaper" value=${s.active_shaper} />
      <span class="arrow">→</span>
      <${Chip} label="Rate" value=${fmtRate(s.active_rate)} />
    </div>
  `;
}
