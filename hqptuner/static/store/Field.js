// Field binder — connects a control key to the three-tree store and renders the
// right primitive. The store contract (effective value, gray/disabled + reason,
// dirty highlight, tooltip, option source) lives HERE, once, instead of being
// copy-pasted into every control. A tab is then just a list of <Field k="..."/>.

import { signal } from "@preact/signals";
import { html } from "./dom.js";
import { schema } from "./schema.js";
import { effective, isDirty, edit, metadata, httpFieldMap, refreshDevices } from "./state.js";
import { optionsFor, grayShapersByRate } from "./options.js";
import { narrowOptions } from "./narrowing.js";
import { grayReason } from "./graying.js";
import { Segment, Dropdown, NumberBox, TextBox, Checkbox, Slider, SliderNumber, RadioGroup } from "../components/controls/index.js";

const WIDGETS = { segment: Segment, dropdown: Dropdown, number: NumberBox, text: TextBox, checkbox: Checkbox, slider: Slider, slidernum: SliderNumber, radio: RadioGroup };

function describe(entry, key) {
  const g = (metadata.value && metadata.value.settings && metadata.value.settings[entry.group]) || {};
  return g[key] || { label: key, tooltip: "" };
}

// Inline manual description for the current selection — the name-keyed prose from
// the metadata overlay (filters.json / shapers.json). desc = filter|dither|modulator.
function selectionDescription(entry, value, options) {
  if (!entry.desc) return "";
  const opt = (options || []).find((o) => String(o.value) === String(value));
  const name = opt && opt.label;
  if (!name) return "";
  const md = metadata.value || {};
  if (entry.desc === "filter") {
    const fdb = (md.filters && md.filters.filters) || {};
    const aliases = (md.filters && md.filters.aliases) || {};
    const e = fdb[name] || fdb[aliases[name]];
    return (e && e.description) || "";
  }
  const shapers = md.shapers || {};
  const db = entry.desc === "modulator" ? shapers.sdm_modulators : shapers.pcm_dithers;
  return (db && db[name] && db[name].description) || "";
}

// http-lane number fields carry min/max/step parsed from the live GET /config
// form (the daemon is the authority for its own bounds).
function cfgConstraint(entry, name) {
  if (entry.lane !== "http") return undefined;
  const f = httpFieldMap(entry)[entry.field];
  return f ? f[name] : undefined;
}

// Rescan-devices affordance for the output-device dropdowns (schema `rescan`).
// Sits in the field's grid column 2, directly under the device list.
const rescanning = signal(false);
async function doRescan() {
  rescanning.value = true;
  try {
    await refreshDevices();
  } finally {
    rescanning.value = false;
  }
}
function RescanButton() {
  return html`<button type="button" class="rescan-btn" disabled=${rescanning.value} onClick=${doRescan}>
    ${rescanning.value ? "Rescanning…" : "⟳ Rescan devices"}
  </button>`;
}

export function Field({ k }) {
  const entry = schema[k];
  if (!entry) return null;
  const W = WIDGETS[entry.widget];
  const meta = describe(entry, k);
  const label = entry.label || meta.label;
  const reason = grayReason(k);
  let options = entry.optionsFrom ? optionsFor(entry.optionsFrom, entry.field) : entry.options;
  // filter selects narrow their (large) option list by the active facets
  if (entry.narrow) options = narrowOptions(options, effective(k), entry.narrow);
  // shaper selects gray options the current output rate can't use
  if (entry.rateGray) options = grayShapersByRate(options, entry.rateGray);

  // A grayed control shows disabled state only — no explanatory caption (it would
  // reflow the row on mode change); graying is the whole signal.
  return html`
    <div class="field ${entry.wide ? "wide" : ""} ${isDirty(k) ? "dirty" : ""}" title=${reason || meta.tooltip}>
      <label>${label}</label>
      <div class="control">
        <${W}
          value=${effective(k)}
          options=${options}
          min=${cfgConstraint(entry, "min")}
          max=${cfgConstraint(entry, "max")}
          step=${cfgConstraint(entry, "step")}
          ticks=${entry.ticks}
          disabled=${!!reason}
          onChange=${(v) => edit(k, v)}
        />
        ${entry.unit ? html`<span class="unit">${entry.unit}</span>` : null}
        ${entry.hint ? html`<span class="field-hint">${entry.hint}</span>` : null}
      </div>
      ${entry.rescan ? html`<${RescanButton} />` : null}
      ${entry.desc ? html`<div class="field-desc">${selectionDescription(entry, effective(k), options)}</div>` : null}
    </div>
  `;
}
