// Live playback volume — the Volume tab's dominant control and the app's only
// real-time-write control. Deliberately NOT a schema/Field control: it reads
// engine-reported volume + VolumeRange and writes immediately over the Control
// API, never touching the staged-diff/Apply flow (no dirty flag, no pending
// count). Grays when volume control is disabled (VolumeRange enabled=0 — fixed
// volume, direct SDM, no active stream).
//
// Rendered as the large knob variant. onLive fires continuously while dragging
// (throttled live writes so playback tracks the knob) and publishes the value to
// `volumeDrag`, which is what the Loudness plot and the Range bar needle read;
// onCommit lands the final value and optimistically adopts it so the next 2 s
// poll doesn't snap the dial back. Double-click resets to a moderate -20 dB (a
// deliberate safe default, not a daemon value, so a reset never jumps to full
// volume).
import { html } from "../lib/dom.js";
import { volume, volumeRange, volumeDrag } from "../store/signals.js";
import { effective, runningValue } from "../store/resolve.js";
import { setVolume } from "../store/actions.js";
import { fastVolumeUpdates, setFastVolumeUpdates } from "../store/prefs.js";
import { Knob } from "./Knob.js";
import { Checkbox } from "./controls/index.js";
import { Card } from "./tabs/common.js";
import { truthy } from "../lib/coerce.js";

// The engine reports volume control disabled (VolumeRange enabled=0), but not
// *why*. Name the actual cause from the RUNNING config — the engine is what is
// holding the knob, so a staged-but-unapplied disable must not change the
// message (otherwise it falls through to "no active stream" mid-playback). When
// the user HAS staged the disable, say the missing step is Apply.
function disabledReason() {
  // running-on but edited-off = the user already staged the disable; the
  // missing step is Apply, so say that instead of repeating the toggle advice
  const pendingOff = (k) => truthy(runningValue(k)) && !truthy(effective(k));
  const hint = (staged) => (staged ? " Apply the staged change to free the volume control." : "");
  if (truthy(runningValue("direct_sdm")))
    return `Direct SDM bypasses the volume control and sets PCM volume to a fixed -3 dBFS value.${hint(pendingOff("direct_sdm"))}`;
  if (truthy(runningValue("fixed_volume_enabled")) || truthy(runningValue("optimal_iso"))) {
    const staged = pendingOff("fixed_volume_enabled") || pendingOff("optimal_iso");
    return `Fixed volume in effect — turn off Fixed volume / Auto headroom to adjust live.${hint(staged)}`;
  }
  // volume min = max = 0 bypasses volume control completely (manual §4.2)
  if (Number(runningValue("volume_min")) === 0 && Number(runningValue("volume_max")) === 0) {
    const staged = !(Number(effective("volume_min")) === 0 && Number(effective("volume_max")) === 0);
    return `Volume min and max are both 0 — volume control is bypassed. Not suitable for normal cases, since it will cause inter-sample overs and thus limiting either at HQPlayer side or at the DAC side.${hint(staged)}`;
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

// The card's contents without the card frame: the dial, the opt-in and the
// reason it is dead. Its own element rather than a fragment because the
// volume-disabled state belongs HERE and not on the card — on LIVE this body is
// one column of a card whose other column is Adaptive volume and the
// high-frequency filter, and neither of those grays when the engine is holding
// the volume control.
//
// `showQuick`: see EngineHealth.js. LIVE renders it off because that page's
// readback is already at 500 ms; the Volume tab's copy is untouched.
//
// `showName`: the dial's own name under it, in the micro-caps role the page
// gives a named readout (PROCESS SPEED under the Engine health gauge). On the
// Volume tab the card head says it already, so only a body sharing a card with
// other controls asks for it.
export function PlaybackVolumeBody({ showQuick = true, showName = false }) {
  const { enabled, min, max } = knobRange();
  const engine = volume.value != null ? Number(volume.value) : min;
  const val = volumeDrag.value != null ? volumeDrag.value : engine;

  const onLive = (v) => {
    volumeDrag.value = Number(v);
    throttleSend(String(v));
  };
  const onCommit = (v) => {
    throttleSend(String(v));
    // adopt before clearing the drag: the other way round leaves one render
    // reading the last polled level, and the plot and needle flick back to it
    volume.value = String(v); // optimistic adopt so the next poll doesn't snap
    volumeDrag.value = null;
  };

  return html`
    <!-- Everything lives INSIDE this one element, so its own gap is what spaces
         the knob, the opt-in and the hint. They used to sit as children of
         .card, which has no gap — the space between them was each one's own
         margin-top, and there was nothing to inherit when those margins went. -->
    <div class="playback-col ${enabled ? "" : "off"}">
      <div class="playback-knob">
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
          ${showName ? html`<div class="t-eyebrow">Playback volume</div>` : null}
        </div>
        ${
          showQuick
            ? html`
              <label class="poll-quick inline-check">
                <${Checkbox} value=${fastVolumeUpdates.value ? "1" : "0"} onChange=${(v) => setFastVolumeUpdates(v === "1")} />
                Faster volume updates
                <span class="poll-quick-note">refresh twice a second while this page is open</span>
              </label>
            `
            : null
        }
      ${enabled ? null : html`<div class="playback-hint">Volume control disabled — ${disabledReason()}</div>`}
    </div>
  `;
}

// The Volume tab's card: the same body in a frame of its own. LIVE renders the
// body directly instead, as one column of its Playback card.
export function PlaybackVolume({ showQuick = true }) {
  return html`
    <${Card} title="Playback volume" cardClass="playback">
      <${PlaybackVolumeBody} showQuick=${showQuick} />
    <//>
  `;
}
