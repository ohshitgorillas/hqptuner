// Field binder — connects a control key to the three-tree store and renders the
// right primitive. The store contract (effective value, gray/disabled + reason,
// dirty highlight, tooltip, option source) lives HERE, once, instead of being
// copy-pasted into every control. A tab is then just a list of <Field k="..."/>.

import { html } from "./dom.js";
import { schema } from "./schema.js";
import { effective, isDirty, edit, metadata, configByName } from "./state.js";
import { optionsFor } from "./options.js";
import { grayReason } from "./graying.js";
import { Segment, Dropdown, NumberBox, Checkbox, Slider, RadioGroup } from "../components/controls/index.js";

const WIDGETS = { segment: Segment, dropdown: Dropdown, number: NumberBox, checkbox: Checkbox, slider: Slider, radio: RadioGroup };

function describe(entry, key) {
  const g = (metadata.value && metadata.value.settings && metadata.value.settings[entry.group]) || {};
  return g[key] || { label: key, tooltip: "" };
}

// http-lane number fields carry min/max/step parsed from the live GET /config
// form (the daemon is the authority for its own bounds).
function cfgConstraint(entry, name) {
  if (entry.lane !== "http") return undefined;
  const f = configByName.value[entry.field];
  return f ? f[name] : undefined;
}

export function Field({ k }) {
  const entry = schema[k];
  if (!entry) return null;
  const W = WIDGETS[entry.widget];
  const meta = describe(entry, k);
  const label = entry.label || meta.label;
  const reason = grayReason(k);
  const options = entry.optionsFrom ? optionsFor(entry.optionsFrom, entry.field) : entry.options;

  // A grayed control shows disabled state only — no explanatory caption (it would
  // reflow the row on mode change); graying is the whole signal.
  return html`
    <div class="field ${entry.wide ? "wide" : ""} ${isDirty(k) ? "dirty" : ""}" title=${meta.tooltip}>
      <label>${label}</label>
      <div class="control">
        <${W}
          value=${effective(k)}
          options=${options}
          min=${cfgConstraint(entry, "min")}
          max=${cfgConstraint(entry, "max")}
          step=${cfgConstraint(entry, "step")}
          disabled=${!!reason}
          onChange=${(v) => edit(k, v)}
        />
        ${entry.unit ? html`<span class="unit">${entry.unit}</span>` : null}
      </div>
    </div>
  `;
}
