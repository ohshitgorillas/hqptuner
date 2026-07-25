// Live playback volume — the Volume tab's dominant control and the app's only
// real-time-write control. Deliberately NOT a schema/Field control: it reads
// engine-reported volume + VolumeRange and writes immediately over the Control
// API, never touching the staged-diff/Apply flow (no dirty flag, no pending
// count). Grays when volume control is disabled (VolumeRange enabled=0 — fixed
// volume, direct SDM, no active stream).
//
// Rendered as the large knob variant. onLive fires continuously while dragging
// (throttled live writes so playback tracks the knob); onCommit lands the final
// value and optimistically adopts it so the next 2 s poll doesn't snap the dial
// back. Double-click resets to a moderate -20 dB (a deliberate safe default, not
// a daemon value, so a reset never jumps to full volume).
import { signal } from "@preact/signals";
import { html } from "../lib/dom.js";
import { volume, volumeRange, setVolume, effective, runningValue } from "../store/state.js";
import { fastVolumeUpdates, setFastVolumeUpdates } from "../store/prefs.js";
import { Knob } from "./Knob.js";
import { Checkbox } from "./controls/index.js";
import { truthy } from "../lib/coerce.js";

// The engine reports volume control disabled (VolumeRange enabled=0), but not
// *why*. Name the actual cause from the RUNNING config — the engine is what is
// holding the knob, so a staged-but-unapplied disable must not change the
// message (it used to fall through to "no active stream" mid-playback). When
// the user HAS staged the disable, say the missing step is Apply.
function disabledReason() {
  // running-on but edited-off = the user already staged the disable; the
  // missing step is Apply, so say that instead of repeating the toggle advice
  const pendingOff = (k) => truthy(runningValue(k)) && !truthy(effective(k));
  const hint = (staged) => (staged ? " Apply the staged change to free the volume control." : "");
  if (truthy(runningValue("direct_sdm")))
    return `Direct SDM bypasses the volume control.${hint(pendingOff("direct_sdm"))}`;
  if (truthy(runningValue("fixed_volume_enabled")) || truthy(runningValue("optimal_iso"))) {
    const staged = pendingOff("fixed_volume_enabled") || pendingOff("optimal_iso");
    return `Fixed volume in effect — turn off Fixed volume / Auto headroom to adjust live.${hint(staged)}`;
  }
  // volume min = max = 0 bypasses volume control completely (manual §4.2)
  if (Number(runningValue("volume_min")) === 0 && Number(runningValue("volume_max")) === 0) {
    const staged = !(Number(effective("volume_min")) === 0 && Number(effective("volume_max")) === 0);
    return `Volume min and max are both 0 — volume control is bypassed.${hint(staged)}`;
  }
  return "No active stream — volume adjusts live during playback.";
}

// The engine-reported VolumeRange, normalized into what the knob needs. The
// enabled test is deliberately NARROWER than the module's truthy() above:
// VolumeRange reports the flag as 1 / "1" / true and nothing else, and widening
// it here would let an unrelated string un-gray a knob the engine is holding.
// Defaults are the daemon's own (-60..0 dBFS) for a range it did not report.
function knobRange() {
  const vr = volumeRange.value || {};
  return {
    enabled: vr.enabled === "1" || vr.enabled === 1 || vr.enabled === true,
    min: Number(vr.min != null ? vr.min : -60),
    max: Number(vr.max != null ? vr.max : 0),
  };
}

const dragging = signal(false); // ignore engine syncs while true
const display = signal(0); // live value shown while dragging

// throttle: send the first move immediately, then at most once per 100 ms, with
// a trailing send so the released value always lands.
let pending = null;
let timer = null;
function flush() {
  if (pending == null) {
    timer = null;
    return;
  }
  const v = pending;
  pending = null;
  setVolume(v).catch(() => {}); // grayed knob means this shouldn't fire; ignore races
  timer = setTimeout(flush, 100);
}
function throttleSend(v) {
  pending = v;
  if (timer == null) flush();
}

export function PlaybackVolume() {
  const { enabled, min, max } = knobRange();
  const engine = volume.value != null ? Number(volume.value) : min;
  const val = dragging.value ? display.value : engine;

  const onLive = (v) => {
    dragging.value = true;
    display.value = Number(v);
    throttleSend(String(v));
  };
  const onCommit = (v) => {
    display.value = Number(v);
    throttleSend(String(v));
    volume.value = String(v); // optimistic adopt so the next poll doesn't snap
    dragging.value = false;
  };

  return html`
    <section class="card playback ${enabled ? "" : "off"}">
      <div class="card-head">Playback volume</div>
      <div class="card-body playback-knob">
        <${Knob}
          value=${val}
          min=${min}
          max=${max}
          step=${0.5}
          def=${-20}
          unit="dB"
          size="lg"
          label="Playback volume"
          disabled=${!enabled}
          onLive=${onLive}
          onCommit=${onCommit}
        />
      </div>
      <label class="poll-quick inline-check">
        <${Checkbox} value=${fastVolumeUpdates.value ? "1" : "0"} onChange=${(v) => setFastVolumeUpdates(v === "1")} />
        Faster volume updates
        <span class="poll-quick-note">refresh twice a second while this page is open</span>
      </label>
      ${enabled ? null : html`<div class="playback-hint">Volume control disabled — ${disabledReason()}</div>`}
    </section>
  `;
}
