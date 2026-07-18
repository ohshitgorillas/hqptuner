// Live playback volume — the Volume tab's dominant control and the app's only
// real-time-write control. It is deliberately NOT a schema/Field control: it
// reads engine-reported volume + VolumeRange and writes immediately over the
// Control API, never touching the staged-diff/Apply flow (no dirty flag, no
// pending count). Grays when volume control is disabled (VolumeRange enabled=0
// — fixed volume, direct SDM, no active stream).
//
// The <input type=range> is UNCONTROLLED (driven by ref), not value-bound: a
// controlled range re-applies its value on every render, and the 2 s poll would
// re-render mid-drag and yank the thumb (reset-then-snap). Instead an effect
// syncs the DOM value from the engine ONLY when the user isn't dragging, so a
// poll never disturbs an in-progress drag; when idle the slider tracks changes
// from other clients (Roon, HQPlayer Client). Writes are throttled (~100 ms).
import { signal } from "@preact/signals";
import { useRef, useEffect } from "preact/hooks";
import { html } from "../store/dom.js";
import { volume, volumeRange, setVolume } from "../store/state.js";

const dragging = signal(false); // ignore engine syncs while true
const display = signal(0); // drives the dB readout (the input itself is uncontrolled)

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
  setVolume(v).catch(() => {}); // grayed slider means this shouldn't fire; ignore races
  timer = setTimeout(flush, 100);
}
function throttleSend(v) {
  pending = v;
  if (timer == null) flush();
}

export function PlaybackVolume() {
  const ref = useRef(null);
  const vr = volumeRange.value || {};
  const enabled = vr.enabled === "1" || vr.enabled === 1 || vr.enabled === true;
  const min = Number(vr.min != null ? vr.min : -60);
  const max = Number(vr.max != null ? vr.max : 0);
  const engine = volume.value != null ? Number(volume.value) : min;
  const isDragging = dragging.value;

  // Sync the uncontrolled input + readout from the engine, but never mid-drag.
  useEffect(() => {
    if (!isDragging && ref.current) {
      ref.current.value = String(engine);
      display.value = engine;
    }
  }, [engine, enabled, isDragging]);

  const onInput = (e) => {
    dragging.value = true;
    display.value = Number(e.target.value);
    throttleSend(e.target.value);
  };
  // Commit: stop ignoring polls; optimistically adopt the local value so the
  // next poll doesn't snap. Fires on pointer release and on keyboard commit.
  const commit = () => {
    if (!dragging.value) return;
    volume.value = String(display.value);
    dragging.value = false;
  };

  return html`
    <section class="playback ${enabled ? "" : "off"}">
      <div class="playback-head">Playback volume</div>
      <div class="playback-row">
        <input
          type="range"
          class="playback-slider"
          ref=${ref}
          min=${min}
          max=${max}
          step="0.5"
          disabled=${!enabled}
          onInput=${onInput}
          onChange=${commit}
          onPointerUp=${commit}
          onPointerCancel=${commit}
        />
        <span class="playback-readout">${enabled ? `${display.value.toFixed(1)} dB` : "—"}</span>
      </div>
      ${enabled
        ? null
        : html`<div class="playback-hint">Volume control disabled — fixed volume in effect (turn off Optimal ISO / fixed volume to adjust live)</div>`}
    </section>
  `;
}
