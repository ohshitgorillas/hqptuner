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
import { html } from "../../lib/dom.js";
import { volume, volumeRange, volumeDrag } from "../../store/signals.js";
import { effective, runningValue } from "../../store/resolve.js";
import { setVolume } from "../../store/actions.js";
import { Knob } from "../Knob.js";
import { Card } from "../common.js";
import { truthy, num } from "../../lib/coerce.js";

// The engine reports volume control disabled (VolumeRange enabled=0), but not
// *why*. Name the actual cause from the RUNNING config — the engine is what is
// holding the knob, so a staged-but-unapplied disable must not change the
// message (otherwise it falls through to "no active stream" mid-playback). When
// the user HAS staged the disable, say the missing step is Apply.
function disabledReason() {
  // running-on but edited-off = the user already staged the disable; the
  // missing step is Apply, so say that instead of repeating the toggle advice
  const pendingOff = (/** @type {string} */ k) => truthy(runningValue(k)) && !truthy(effective(k));
  const hint = (/** @type {boolean} */ staged) =>
    staged ? " Apply the staged change to free the volume control." : "";
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

// The axis a grayed dial is drawn on. While the engine holds the volume control
// it still reports a VolumeRange, but that range is the engine's own and not the
// configured one (measured under fixed volume: enabled="0" min="-12" max="0"
// against a config of volume_min=-60 / volume_max=-3), so a dial drawn on it
// sits at an arbitrary fraction of a range the user never set. The running
// config's own range is what the reported level means something against.
//
// Returns null when the running config has no usable range — no credentials, no
// /config form — so the caller keeps the engine's report rather than inventing
// an axis.
/** @returns {{ min: number, max: number, pin: number | null } | null} */
function configRange() {
  const rmin = runningValue("volume_min");
  const rmax = runningValue("volume_max");
  if (rmin == null || rmax == null || rmin === "" || rmax === "") return null;
  const min = num(rmin, NaN);
  const max = num(rmax, NaN);
  if (Number.isNaN(min) || Number.isNaN(max)) return null;
  // min = max = 0 bypasses the volume control completely (manual §4.2), and a
  // degenerate axis has no position to draw on at all. Nothing is being
  // attenuated, so the dial reads full up on a normal axis rather than parking
  // at the midpoint an empty range would produce.
  if (min >= max) return { min: -60, max: 0, pin: 0 };
  return { min, max, pin: null };
}

// The range the knob is drawn on. The enabled test is deliberately NARROWER than
// the module's truthy() above: VolumeRange reports the flag as 1 / "1" / true
// and nothing else, and widening it here would let an unrelated string un-gray a
// knob the engine is holding. Defaults are the daemon's own (-60..0 dBFS) for a
// range it did not report.
//
// `pin`, when set, is the level the dial shows instead of the engine's report.
function knobRange() {
  const vr = volumeRange.value || {};
  const enabled = vr.enabled === "1" || vr.enabled === 1 || vr.enabled === true;
  const engine = {
    min: Number(vr.min != null ? vr.min : -60),
    max: Number(vr.max != null ? vr.max : 0),
    pin: /** @type {number | null} */ (null),
  };
  // While the engine owns the control its report IS the axis the writes land on
  if (enabled) return { enabled, ...engine };
  return { enabled, ...(configRange() || engine) };
}

// throttle: send the first move immediately, then at most once per 100 ms, with
// a trailing send so the released value always lands.
/** @type {string | null} the newest value not yet sent */
let pending = null;
// `ReturnType` rather than `number`: this file is checked under both configs,
// and the browser's `setTimeout` answers a number where node's answers a
// `Timeout`. The handle is only ever passed back to `clearTimeout`, so which
// one it is never matters here.
/** @type {ReturnType<typeof setTimeout> | null} the open trailing-send timer, or null when idle */
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
/** @param {string} v */
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
// `showName`: the dial's own name under it, in the micro-caps role the page
// gives a named readout (PROCESS SPEED under the Engine health gauge). On the
// Volume tab the card head says it already, so only a body sharing a card with
// other controls asks for it.
/** Renders the volume dial and, when the engine holds the control, the grayed-out reason. */
export function PlaybackVolumeBody({ showName = false }) {
  const { enabled, min, max, pin } = knobRange();
  const engine = volume.value != null ? Number(volume.value) : min;
  // a pinned level owns the dial: under bypass there is no reported level that
  // means anything on this axis
  const val = pin != null ? pin : volumeDrag.value != null ? volumeDrag.value : engine;

  const onLive = (/** @type {string | number} */ v) => {
    volumeDrag.value = Number(v);
    throttleSend(String(v));
  };
  const onCommit = (/** @type {string | number} */ v) => {
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
      ${enabled ? null : html`<div class="playback-hint">Volume control disabled — ${disabledReason()}</div>`}
    </div>
  `;
}

// The Volume tab's card: the same body in a frame of its own. LIVE renders the
// body directly instead, as one column of its Playback card.
/** Renders the Volume tab's Playback volume card — the same body in a card frame of its own. */
export function PlaybackVolume() {
  return html`
    <${Card} title="Playback volume" cardClass="playback">
      <${PlaybackVolumeBody} />
    <//>
  `;
}
