// Dumb presentational primitives. Each takes value/options/constraints +
// onChange and renders — no store knowledge. The Field binder wires them to the
// three-tree store by control key. Reusable and independently testable.

import { useRef, useEffect } from "preact/hooks";
import { html } from "../../lib/dom.js";

const s = (v) => (v == null ? "" : String(v));
const truthy = (v) => v === true || v === 1 || v === "1" || v === "on" || v === "true";

export function Segment({ value, options, disabled, onChange }) {
  return html`
    <span class="segment">
      ${(options || []).map(
        (o) => html`
          <button
            type="button"
            class=${s(o.value) === s(value) ? "seg active" : "seg"}
            disabled=${disabled}
            onClick=${() => onChange(o.value)}
          >
            ${o.label}
          </button>
        `,
      )}
    </span>
  `;
}

export function Dropdown({ value, options, disabled, onChange }) {
  return html`
    <select value=${s(value)} disabled=${disabled} onChange=${(e) => onChange(e.target.value)}>
      ${(options || []).map(
        (o) => html`
          <option value=${s(o.value)} disabled=${o.disabled}>
            ${o.label}${o.reason ? ` — ${o.reason}` : ""}
          </option>
        `,
      )}
    </select>
  `;
}

// Typed inputs are UNCONTROLLED while focused. `onChange` is the native change
// event (commit on blur), so a half-typed value lives only in the DOM until then
// — and the 2 s poll re-renders constantly. A controlled `value=` would reset the
// field mid-edit (typing "-1" snapped straight back to "0"). So sync from the
// store by ref, and only when the user isn't in the field. Same rule the live
// volume slider follows.
function useSyncWhenIdle(value) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el) el.value = s(value);
  });
  return ref;
}

export function NumberBox({ value, min, max, step, disabled, onChange }) {
  const ref = useSyncWhenIdle(value);
  return html`
    <input
      type="number"
      ref=${ref}
      min=${min}
      max=${max}
      step=${step == null ? 1 : step}
      disabled=${disabled}
      onChange=${(e) => onChange(e.target.value)}
    />
  `;
}

export function TextBox({ value, disabled, onChange }) {
  const ref = useSyncWhenIdle(value);
  return html`<input type="text" ref=${ref} disabled=${disabled} onChange=${(e) => onChange(e.target.value)} />`;
}

export function Checkbox({ value, disabled, onChange }) {
  return html`
    <input
      type="checkbox"
      checked=${truthy(value)}
      disabled=${disabled}
      onChange=${(e) => onChange(e.target.checked ? "1" : "0")}
    />
  `;
}

export function Slider({ value, min, max, step, disabled, onChange }) {
  return html`
    <span class="slider">
      <input
        type="range"
        value=${s(value)}
        min=${min}
        max=${max}
        step=${step == null ? 1 : step}
        disabled=${disabled}
        onChange=${(e) => onChange(e.target.value)}
      />
      <span class="slider-val">${s(value)}</span>
    </span>
  `;
}

// Slider + number box bound to one value: slider for coarse feel, box for the
// exact figure (a fine step over a wide range is unusable on a slider alone).
// The fill is anchored at the MAX end, so its length reads as the amount moved
// away from max (e.g. attenuation for a −12…0 dB range: 0 = empty, −12 = full),
// not the misleading "full track = maxed" of a default range. Optional `ticks`
// (values) draw reference marks.
const pctOf = (v, lo, hi) => (hi === lo ? 0 : Math.max(0, Math.min(1, (Number(v) - lo) / (hi - lo))) * 100);

export function SliderNumber({ value, min, max, step, ticks, disabled, onChange }) {
  const st = step == null ? 1 : step;
  const lo = Number(min);
  const hi = Number(max);
  const pct = pctOf(value, lo, hi);
  const fill = `background:linear-gradient(to right, var(--bg-3) 0%, var(--bg-3) ${pct}%, var(--accent) ${pct}%, var(--accent) 100%)`;
  return html`
    <span class="slidernum">
      <span class="range-wrap">
        <input
          type="range"
          value=${s(value)}
          min=${min}
          max=${max}
          step=${st}
          disabled=${disabled}
          style=${fill}
          onInput=${(e) => onChange(e.target.value)}
        />
        ${(ticks || []).map((t) => html`<span class="tick" style=${`left:${pctOf(t, lo, hi)}%`}></span>`)}
      </span>
      <input
        type="number"
        class="slidernum-box"
        value=${s(value)}
        min=${min}
        max=${max}
        step=${st}
        disabled=${disabled}
        onChange=${(e) => onChange(e.target.value)}
      />
    </span>
  `;
}

export function RadioGroup({ value, options, disabled, onChange }) {
  return html`
    <span class="radio-group">
      ${(options || []).map(
        (o) => html`
          <label>
            <input
              type="radio"
              checked=${s(o.value) === s(value)}
              disabled=${disabled}
              onChange=${() => onChange(o.value)}
            />${o.label}
          </label>
        `,
      )}
    </span>
  `;
}
