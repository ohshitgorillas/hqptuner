// Dumb presentational primitives. Each takes value/options/constraints +
// onChange and renders — no store knowledge. The Field binder wires them to the
// three-tree store by control key. Reusable and independently testable.

import { html } from "../../store/dom.js";

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

export function NumberBox({ value, min, max, step, disabled, onChange }) {
  return html`
    <input
      type="number"
      value=${s(value)}
      min=${min}
      max=${max}
      step=${step == null ? 1 : step}
      disabled=${disabled}
      onChange=${(e) => onChange(e.target.value)}
    />
  `;
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
