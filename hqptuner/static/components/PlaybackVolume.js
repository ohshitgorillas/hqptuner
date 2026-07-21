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
import { html } from "../store/dom.js";
import { volume, volumeRange, setVolume, effective, runningValue } from "../store/state.js";
import { Knob } from "./Knob.js";

const truthy = (v) => v === true || v === 1 || v === "1" || v === "on" || v === "true";

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
    return `Fixed volume in effect — turn off Fixed volume / Optimal ISO to adjust live.${hint(staged)}`;
  }
  return "No active stream — volume adjusts live during playback.";
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
  const vr = volumeRange.value || {};
  const enabled = vr.enabled === "1" || vr.enabled === 1 || vr.enabled === true;
  const min = Number(vr.min != null ? vr.min : -60);
  const max = Number(vr.max != null ? vr.max : 0);
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
      ${enabled ? null : html`<div class="playback-hint">Volume control disabled — ${disabledReason()}</div>`}
    </section>
  `;
}
