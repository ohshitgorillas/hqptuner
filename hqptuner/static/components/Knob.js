// A reusable control for continuous, audible parameters: a KNOB + horizontal
// SLIDER + mono number BOX, all three bidirectionally synced. Used for crossfeed
// frequency/level, loudness bass/treble level, and (knob+box only) playback
// volume. Everything else stays a dropdown or plain number box.
//
// Interaction (fixed contract, on the dial): VERTICAL drag adjusts (never
// circular); Shift = fine; double-click resets to default; arrow keys when
// focused (Shift fine, PageUp/Down coarse, Home/End to bounds). The slider drags
// horizontally; the box is directly editable. All three reflect the same value.
// The wheel is deliberately NOT bound (nor on the slider): scrolling the page
// past a knob must never change its value.
//
// onLive(v) fires continuously during a drag (client-only, drives the plot with
// no server hit); onCommit(v) fires on release / key / dbl-click / box edit and
// persists through the store's optimistic edit.

import { useRef, useEffect, useCallback } from "preact/hooks";
import { html, wheelGuard } from "../lib/dom.js";
import { clamp, num } from "../lib/coerce.js";

const decimals = (step) => (String(step).split(".")[1] || "").length;
const fmt = (v, step) => v.toFixed(decimals(step));

// value -> indicator angle, sweeping -135°..+135° (270° arc) across min..max.
const FROM = -135;
const TO = 135;
const angleOf = (v, lo, hi) => FROM + clamp(hi === lo ? 0.5 : (v - lo) / (hi - lo), 0, 1) * (TO - FROM);

// polar point on the dial (0° up, clockwise positive), radius r about (50,50).
function pol(angle, r) {
  const a = (angle * Math.PI) / 180;
  return [50 + r * Math.sin(a), 50 - r * Math.cos(a)];
}

function arcPath(a0, a1, r) {
  const [x0, y0] = pol(a0, r);
  const [x1, y1] = pol(a1, r);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

// Dial gradations for the large variant, drawn on the face between the inner
// ring (r=22) and the face edge (r=40) — outside the face there is no room, the
// value track already occupies r=44 with a 7-wide stroke.
const DIAL_TICKS = [-135, -90, -45, 0, 45, 90, 135].map((a) => {
  const [x1, y1] = pol(a, 33);
  const [x2, y2] = pol(a, 37);
  return [x1.toFixed(2), y1.toFixed(2), x2.toFixed(2), y2.toFixed(2)];
});

export function Knob({ value, min, max, step, def, size, slider, disabled, unit, label, onLive, onCommit }) {
  const lo = num(min, 0);
  const hi = num(max, 100);
  const st = num(step, 1) || 1;
  const fine = st / 5;
  const val = clamp(num(value, lo), lo, hi);
  const drag = useRef(null);
  const boxRef = useRef(null);
  const sliderRef = useRef(null);

  // keep box + slider synced to the live value, but never while being interacted with
  useEffect(() => {
    const b = boxRef.current;
    if (b && document.activeElement !== b) b.value = fmt(val, st);
    const s = sliderRef.current;
    if (s && document.activeElement !== s) s.value = String(val);
  });

  const snap = useCallback((v, quantum) => clamp(Math.round(v / quantum) * quantum, lo, hi), [lo, hi]);
  const commit = useCallback((v) => onCommit && onCommit(snap(v, fine)), [onCommit, snap, fine]);
  const live = useCallback((v) => onLive && onLive(v), [onLive]);

  const onPointerDown = useCallback(
    (e) => {
      if (disabled) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { y: e.clientY, v: val, last: val };
    },
    [disabled, val],
  );
  const onPointerMove = useCallback(
    (e) => {
      const d = drag.current;
      if (!d) return;
      const quantum = e.shiftKey ? fine : st;
      const dv = ((d.y - e.clientY) / 200) * (hi - lo) * (e.shiftKey ? 0.25 : 1); // 200px ≈ full range
      d.last = snap(d.v + dv, quantum);
      live(d.last);
    },
    [live, snap, st, fine, hi, lo],
  );
  const onPointerUp = useCallback(
    (e) => {
      const d = drag.current;
      if (!d) return;
      e.currentTarget.releasePointerCapture(e.pointerId);
      drag.current = null;
      commit(d.last);
    },
    [commit],
  );
  const onKeyDown = useCallback(
    (e) => {
      if (disabled) return;
      const q = e.shiftKey ? fine : st;
      const moves = {
        ArrowUp: val + q,
        ArrowRight: val + q,
        ArrowDown: val - q,
        ArrowLeft: val - q,
        PageUp: val + st * 10,
        PageDown: val - st * 10,
        Home: lo,
        End: hi,
      };
      if (!(e.key in moves)) return;
      e.preventDefault();
      commit(moves[e.key]);
    },
    [disabled, commit, val, st, fine, lo, hi],
  );
  const onDblClick = useCallback(() => {
    if (disabled) return;
    commit(num(def, val));
  }, [disabled, commit, def, val]);

  const angle = angleOf(val, lo, hi);
  const [nx1, ny1] = pol(angle, 6); // notch runs from inside the inner disc...
  const [nx2, ny2] = pol(angle, 30); // ...out through its edge (r=22)
  return html`
    <div class="knob ${size === "lg" ? "knob-lg" : ""} ${disabled ? "off" : ""}">
      <svg
        class="knob-dial"
        viewBox="0 0 100 100"
        role="slider"
        tabindex=${disabled ? -1 : 0}
        aria-label=${label || ""}
        aria-valuemin=${lo}
        aria-valuemax=${hi}
        aria-valuenow=${val}
        aria-valuetext=${`${fmt(val, st)}${unit ? ` ${unit}` : ""}`}
        onPointerDown=${onPointerDown}
        onPointerMove=${onPointerMove}
        onPointerUp=${onPointerUp}
        onKeyDown=${onKeyDown}
        onDblClick=${onDblClick}
      >
        <path class="knob-track" d=${arcPath(FROM, TO, 44)} />
        <path class="knob-value" d=${arcPath(FROM, angle, 44)} />
        <circle class="knob-face" cx="50" cy="50" r="40" />
        ${size === "lg" ? DIAL_TICKS.map((t) => html`<line class="knob-tick" x1=${t[0]} y1=${t[1]} x2=${t[2]} y2=${t[3]} />`) : null}
        <circle class="knob-inner" cx="50" cy="50" r="22" />
        <line class="knob-notch" x1=${nx1.toFixed(2)} y1=${ny1.toFixed(2)} x2=${nx2.toFixed(2)} y2=${ny2.toFixed(2)} />
      </svg>
      ${
        slider === false
          ? null
          : html`<input
              class="knob-slider"
              type="range"
              ref=${sliderRef}
              min=${lo}
              max=${hi}
              step=${st}
              disabled=${disabled}
              onWheel=${wheelGuard}
              onInput=${(e) => live(snap(num(e.target.value, val), st))}
              onChange=${(e) => commit(num(e.target.value, val))}
            />`
      }
      <span class="knob-readout">
        <input
          class="knob-box mono"
          type="text"
          inputmode="decimal"
          ref=${boxRef}
          disabled=${disabled}
          onChange=${(e) => commit(num(e.target.value, val))}
        />
        ${unit ? html`<span class="knob-unit">${unit}</span>` : null}
      </span>
    </div>
  `;
}
