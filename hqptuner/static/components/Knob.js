// A reusable control for continuous, audible parameters: a KNOB + horizontal
// SLIDER + mono number BOX, all three bidirectionally synced. Used for crossfeed
// frequency/level, loudness bass/treble level, and (knob+box only) playback
// volume. Everything else stays a dropdown or plain number box.
//
// Interaction (fixed contract, on the dial): VERTICAL drag adjusts (never
// circular); Shift = fine; double-click resets to default; arrow keys when
// focused (Shift fine, PageUp/Down coarse, Home/End to bounds). The slider drags
// horizontally; the box is directly editable. All three reflect the same value.
// The wheel is deliberately NOT bound on the dial, and the slider carries the
// wheelGuard: scrolling the page past a knob must never change its value.
//
// onLive(v) fires continuously during a drag (client-only, drives the plot with
// no server hit); onCommit(v) fires on release / key / dbl-click / box edit and
// persists through the store's optimistic edit.

import { useRef, useEffect, useCallback } from "preact/hooks";
import { html, wheelGuard, userEdit } from "../lib/dom.js";
import { clamp, num } from "../lib/coerce.js";

/**
 * @typedef {{ target: HTMLInputElement }} InputEv
 *   The input/change events the slider and the box answer — the handler is
 *   bound to that element, so its target is that element.
 * @typedef {{ clientX: number, clientY: number, pointerId: number, buttons: number, shiftKey: boolean,
 *             currentTarget: Element }} PointerEv
 *   The dial's pointer gestures. `currentTarget` is the dial's <svg>, which is
 *   what pointer capture is taken on.
 * @typedef {{ key: string, shiftKey: boolean, preventDefault: () => void }} KeyEv
 * @typedef {{ current: HTMLInputElement | null }} InputRef
 * @typedef {{ y: number, v: number, last: number }} DragState
 *   A drag in flight: the pointer's grab y, the value at grab, and the last
 *   value reported to onLive.
 * @typedef {(v: number) => void} ValueSink
 * @typedef {(v: number, quantum: number) => number} Snap
 * @typedef {{ onPointerDown: (e: PointerEv) => void, onPointerMove: (e: PointerEv) => void,
 *             onPointerUp: (e: PointerEv) => void, onDblClick: () => void, onKeyDown: (e: KeyEv) => void,
 *             onFocus: () => void, onBlur: () => void }} KnobGestures
 * @typedef {{ size?: string, disabled?: boolean, label?: string, unit?: string, val: number, lo: number,
 *             hi: number, st: number, log: boolean, slider?: boolean, sliderRef: InputRef, boxRef: InputRef,
 *             live: ValueSink, commit: ValueSink, snap: Snap }} KnobView
 *   Everything KnobBody renders from, bundled by the owner in one object.
 */

const decimals = (/** @type {number} */ step) => (String(step).split(".")[1] || "").length;
const fmt = (/** @type {number} */ v, /** @type {number} */ step) => v.toFixed(decimals(step));

// real units <-> track units for `scale="log"` (identity when linear)
const enc = (/** @type {number} */ v, /** @type {boolean} */ log) => (log ? Math.log(v) : v);
const dec = (/** @type {number} */ v, /** @type {boolean} */ log) => (log ? Math.exp(v) : v);

// The horizontal track half of the trio. On a log knob the track itself runs
// in encoded units (step "any" — no real-unit step is even on a log axis);
// both callbacks decode back to real units before leaving.
/**
 * @param {{ sliderRef: InputRef, lo: number, hi: number, val: number, st: number, log: boolean,
 *           disabled?: boolean, live: ValueSink, commit: ValueSink, snap: Snap }} props
 */
function KnobSlider({ sliderRef, lo, hi, val, st, log, disabled, live, commit, snap }) {
  return html`<input
    class="knob-slider"
    type="range"
    ref=${sliderRef}
    min=${enc(lo, log)}
    max=${enc(hi, log)}
    step=${log ? "any" : st}
    disabled=${disabled}
    onWheel=${wheelGuard}
    onInput=${userEdit(enc(val, log), (/** @type {InputEv} */ e) =>
      live(snap(dec(num(e.target.value, enc(val, log)), log), st)),
    )}
    onChange=${userEdit(enc(val, log), (/** @type {InputEv} */ e) =>
      commit(dec(num(e.target.value, enc(val, log)), log)),
    )}
  />`;
}

// value -> indicator angle, sweeping -135°..+135° (270° arc) across min..max.
const FROM = -135;
const TO = 135;
const angleOf = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) =>
  FROM + clamp(hi === lo ? 0.5 : (v - lo) / (hi - lo), 0, 1) * (TO - FROM);

// polar point on the dial (0° up, clockwise positive), radius r about (50,50).
/**
 * @param {number} angle
 * @param {number} r
 * @returns {number[]}
 */
function pol(angle, r) {
  const a = (angle * Math.PI) / 180;
  return [50 + r * Math.sin(a), 50 - r * Math.cos(a)];
}

/**
 * @param {number} a0
 * @param {number} a1
 * @param {number} r
 * @returns {string}
 */
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

// A log axis needs min > 0 — enc(0) is -Infinity and every downstream geometry
// computation would go NaN — so a missing or non-positive min is floored to a
// positive value (a daemon form may ship no bounds at all).
const loOf = (/** @type {unknown} */ min, /** @type {boolean} */ log) =>
  log ? Math.max(num(min, 1), 1e-3) : num(min, 0);

// `scale="log"`: the dial arc, slider track, and drag gesture work in log space
// (equal travel per octave — what a 20 Hz–20 kHz or 0.1–16 Q axis needs) while
// value, box, aria, and both callbacks stay in real units.
/**
 * @param {{ value?: unknown, min?: unknown, max?: unknown, step?: unknown, def?: unknown, size?: string,
 *           slider?: boolean, disabled?: boolean, unit?: string, label?: string, scale?: string,
 *           onLive?: ValueSink | null, onCommit?: ValueSink | null }} props
 */
export function Knob({ value, min, max, step, def, size, slider, disabled, unit, label, scale, onLive, onCommit }) {
  const log = scale === "log";
  const lo = loOf(min, log);
  const hi = num(max, 100);
  const st = num(step, 1) || 1;
  const fine = st / 5;
  const val = clamp(num(value, lo), lo, hi);
  /** @type {{ current: DragState | null }} */
  const drag = useRef(null);
  /** @type {InputRef} */
  const boxRef = useRef(null);
  /** @type {InputRef} */
  const sliderRef = useRef(null);
  // Whether the dial actually holds keyboard focus, tracked from its own focus
  // and blur rather than read from `document.activeElement` — see onKeyDown.
  /** @type {{ current: boolean }} */
  const focused = useRef(false);

  // keep box + slider synced to the live value, but never while being interacted with
  useEffect(() => {
    const b = boxRef.current;
    if (b && document.activeElement !== b) b.value = fmt(val, st);
    const s = sliderRef.current;
    if (s && document.activeElement !== s) s.value = String(enc(val, log));
  });

  const snap = useCallback(
    (/** @type {number} */ v, /** @type {number} */ quantum) => clamp(Math.round(v / quantum) * quantum, lo, hi),
    [lo, hi],
  );
  const commit = useCallback((/** @type {number} */ v) => onCommit && onCommit(snap(v, fine)), [onCommit, snap, fine]);
  const live = useCallback((/** @type {number} */ v) => onLive && onLive(v), [onLive]);

  const g = useKnobGestures({ disabled, val, st, fine, lo, hi, log, def, snap, live, commit, drag, focused });
  const angle = angleOf(enc(val, log), enc(lo, log), enc(hi, log));
  const view = { size, disabled, label, unit, val, lo, hi, st, log, slider, sliderRef, boxRef, live, commit, snap };
  return html`<${KnobBody} view=${view} g=${g} angle=${angle} />`;
}

// Every gesture the dial answers: vertical drag (through encoded space, so a log
// dial sweeps octaves evenly), arrow/page/home/end keys, and double-click to the
// default. `drag` and `focused` are the owner's refs.
/**
 * @param {{ disabled?: boolean, val: number, st: number, fine: number, lo: number, hi: number, log: boolean,
 *           def?: unknown, snap: Snap, live: ValueSink, commit: ValueSink,
 *           drag: { current: DragState | null }, focused: { current: boolean } }} ctx
 * @returns {KnobGestures}
 */
function useKnobGestures({ disabled, val, st, fine, lo, hi, log, def, snap, live, commit, drag, focused }) {
  const onPointerDown = useCallback(
    (/** @type {PointerEv} */ e) => {
      if (disabled) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { y: e.clientY, v: val, last: val };
    },
    [disabled, val],
  );
  const onPointerMove = useCallback(
    (/** @type {PointerEv} */ e) => {
      const d = drag.current;
      if (!d) return;
      // A context menu opened mid-drag eats the pointerup, and pointer capture
      // then feeds this handler a buttonless drag forever — the dial sticks to
      // the mouse. No button, no drag: end it where the last live report left it,
      // exactly as a real release would. Dropping it uncommitted instead leaves
      // every surface fed by onLive parked on a value nothing will ever land.
      if (!(e.buttons & 1)) {
        drag.current = null;
        commit(d.last);
        return;
      }
      const quantum = e.shiftKey ? fine : st;
      // drag moves through encoded space, so a log dial sweeps octaves evenly
      const dv = ((d.y - e.clientY) / 200) * (enc(hi, log) - enc(lo, log)) * (e.shiftKey ? 0.25 : 1); // 200px ≈ full range
      d.last = snap(dec(enc(d.v, log) + dv, log), quantum);
      live(d.last);
    },
    [live, commit, snap, st, fine, hi, lo, log],
  );
  const onPointerUp = useCallback(
    (/** @type {PointerEv} */ e) => {
      const d = drag.current;
      if (!d) return;
      e.currentTarget.releasePointerCapture(e.pointerId);
      drag.current = null;
      commit(d.last);
    },
    [commit],
  );
  const onDblClick = useCallback(() => {
    if (disabled) return;
    commit(num(def, val));
  }, [disabled, commit, def, val]);
  const keys = useKnobKeys({ disabled, val, st, fine, lo, hi, log, commit, focused });
  return { onPointerDown, onPointerMove, onPointerUp, onDblClick, ...keys };
}

// A key gesture is honored only on a dial that actually holds focus. WebKit
// turns a scroll over any element carrying `role="slider"` into TRUSTED
// ArrowLeft/ArrowRight keydowns aimed at that element, focused or not, so a
// page scrolled past a knob silently retunes it (measured on Safari 26.5:
// isTrusted true, activeElement BODY, one arrow per few wheel ticks). The
// wheel guard cannot help — those wheel events are non-cancelable, and the
// edit rides the key, not the wheel.
//
// Focus is tracked from the dial's own focus/blur, NOT read from
// `document.activeElement`: on the engine with the bug activeElement reports
// BODY throughout, so the one signal that would be simplest to write is the
// one that cannot see the difference. A keyboard user tabs or clicks to the
// dial, gets focus, and keeps every gesture below unchanged.
/**
 * @param {{ disabled?: boolean, val: number, st: number, fine: number, lo: number, hi: number, log: boolean,
 *           commit: ValueSink, focused: { current: boolean } }} ctx
 * @returns {{ onKeyDown: (e: KeyEv) => void, onFocus: () => void, onBlur: () => void }}
 */
function useKnobKeys({ disabled, val, st, fine, lo, hi, log, commit, focused }) {
  const onFocus = useCallback(() => (focused.current = true), []);
  const onBlur = useCallback(() => (focused.current = false), []);
  const onKeyDown = useCallback(
    (/** @type {KeyEv} */ e) => {
      if (disabled || !focused.current) return;
      const q = e.shiftKey ? fine : st;
      // linear keys step by `step`; log keys sweep 1% of the track per arrow —
      // a fixed real-unit step is useless across a decades-wide range
      const bump = (/** @type {number} */ n) =>
        log ? dec(enc(val, log) + (n * (enc(hi, log) - enc(lo, log))) / 100, log) : val + n * q;
      /** @type {Record<string, number>} */
      const moves = {
        ArrowUp: bump(1),
        ArrowRight: bump(1),
        ArrowDown: bump(-1),
        ArrowLeft: bump(-1),
        PageUp: log ? bump(10) : val + st * 10,
        PageDown: log ? bump(-10) : val - st * 10,
        Home: lo,
        End: hi,
      };
      if (!(e.key in moves)) return;
      e.preventDefault();
      commit(moves[e.key]);
    },
    [disabled, commit, val, st, fine, lo, hi, log],
  );
  return { onKeyDown, onFocus, onBlur };
}

// The typed value box and its unit. The box is uncontrolled — the owner's effect
// keeps it in step with the live value except while it holds focus.
/**
 * @param {{ boxRef: InputRef, disabled?: boolean, unit?: string, val: number, commit: ValueSink }} props
 */
function KnobReadout({ boxRef, disabled, unit, val, commit }) {
  return html`
    <span class="knob-readout">
      <input
        class="knob-box mono"
        type="text"
        inputmode="decimal"
        ref=${boxRef}
        disabled=${disabled}
        onChange=${(/** @type {InputEv} */ e) => commit(num(e.target.value, val))}
      />
      ${unit ? html`<span class="knob-unit">${unit}</span>` : null}
    </span>
  `;
}

// The dial, its optional slider, and the numeric readout. `g` is the gesture set
// the dial's svg wires up; `angle` is where the notch points.
/**
 * @param {{ view: KnobView, g: KnobGestures, angle: number }} props
 */
function KnobBody({ view, g, angle }) {
  const { size, disabled, label, unit, val, lo, hi, st, log, slider, sliderRef, boxRef, live, commit, snap } = view;
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
        onPointerDown=${g.onPointerDown}
        onPointerMove=${g.onPointerMove}
        onPointerUp=${g.onPointerUp}
        onKeyDown=${g.onKeyDown}
        onFocus=${g.onFocus}
        onBlur=${g.onBlur}
        onDblClick=${g.onDblClick}
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
          : html`<${KnobSlider}
              sliderRef=${sliderRef}
              lo=${lo}
              hi=${hi}
              val=${val}
              st=${st}
              log=${log}
              disabled=${disabled}
              live=${live}
              commit=${commit}
              snap=${snap}
            />`
      }
      <${KnobReadout} boxRef=${boxRef} disabled=${disabled} unit=${unit} val=${val} commit=${commit} />
    </div>
  `;
}
