// Field binder — connects a control key to the three-tree store and renders the
// right primitive. The store contract (effective value, gray/disabled + reason,
// dirty highlight, tooltip, option source) lives HERE, once, instead of being
// copy-pasted into every control. A tab is then just a list of <Field k="..."/>.

import { signal } from "@preact/signals";
import { html } from "./dom.js";
import { schema } from "./schema.js";
import { effective, isDirty, edit, setLive, metadata, httpFieldMap, formFieldName, refreshDevices } from "./state.js";
import { optionsFor, grayShapersByRate } from "./options.js";
import { narrowOptions } from "./narrowing.js";
import { grayReason } from "./graying.js";
import { notesVisible, descVisible } from "./prefs.js";
import { Segment, Dropdown, NumberBox, TextBox, Checkbox, Slider, SliderNumber, RadioGroup } from "../components/controls/index.js";
import { Knob } from "../components/Knob.js";

const WIDGETS = { segment: Segment, dropdown: Dropdown, number: NumberBox, text: TextBox, checkbox: Checkbox, slider: Slider, slidernum: SliderNumber, radio: RadioGroup, knob: Knob };

// Static per-control prose from settings.json (Phase 1 manual/readme extraction),
// keyed by tab group. `entry.note` names the settings.json key when it differs
// from the control key (e.g. alsa_bits + net_bits both -> "dac_bits", the rate
// split -> "rate"); it defaults to the control key.
function describe(entry, key) {
  const g = (metadata.value && metadata.value.settings && metadata.value.settings[entry.group]) || {};
  return g[entry.note || key] || { label: key, tooltip: "" };
}

// Inline manual description for the current selection.
//   desc = filter|dither|modulator -> name-keyed prose from the metadata overlay
//     (filters.json / shapers.json), joined by the selected option's label.
//   desc = config -> per-value prose from this control's settings.json `options`
//     map, keyed by the selected form value (integrator, noise filter, SDM/PCM
//     conversion — enums whose meaning is per-value, not per-control).
function selectionDescription(entry, value, options, meta) {
  if (!entry.desc) return "";
  if (entry.desc === "config") {
    return (meta && meta.options && meta.options[String(value)]) || "";
  }
  const opt = (options || []).find((o) => String(o.value) === String(value));
  const name = opt && opt.label;
  if (!name) return "";
  const md = metadata.value || {};
  if (entry.desc === "filter") {
    // Join rules (data/filters.json _join_rules): exact -> alias -> strip a
    // '-2s' suffix and append the two-stage note to the base description.
    const fdb = (md.filters && md.filters.filters) || {};
    const aliases = (md.filters && md.filters.aliases) || {};
    let n = name;
    let twoStage = false;
    for (;;) {
      const e = fdb[n] || fdb[aliases[n]];
      if (e) {
        const desc = e.description || "";
        return twoStage ? `${desc} ${md.filters.two_stage_note || ""}`.trim() : desc;
      }
      if (!n.endsWith("-2s")) return "";
      n = n.slice(0, -3);
      twoStage = true;
    }
  }
  const shapers = md.shapers || {};
  const db = entry.desc === "modulator" ? shapers.sdm_modulators : shapers.pcm_dithers;
  return (db && db[name] && db[name].description) || "";
}

// http-lane number fields carry min/max/step parsed from the live GET /config
// form (the daemon is the authority for its own bounds). A schema entry may
// carry fallback min/max/step for fields whose form gives none (loudness
// steepness) — the form's value wins whenever it exists.
function cfgConstraint(entry, name) {
  if (entry.lane !== "http") return entry[name];
  const f = httpFieldMap(entry)[formFieldName(entry)];
  const v = f ? f[name] : undefined;
  return v == null ? entry[name] : v;
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
  let options = entry.optionsFrom ? optionsFor(entry.optionsFrom, formFieldName(entry)) : entry.options;
  // filter selects narrow their (large) option list by the active facets
  if (entry.narrow) options = narrowOptions(options, effective(k), entry.narrow);
  // shaper selects gray options the current output rate can't use
  if (entry.rateGray) options = grayShapersByRate(options, entry.rateGray);

  // A grayed control shows disabled state only — no explanatory caption (it would
  // reflow the row on mode change); graying is the whole signal.
  // Hover title: desc-carrying fields (filters, DSD sources) render the
  // per-selection prose inline, so their hover always carries the OVERALL
  // feature description; hoverNote fields never render an inline note, so
  // hover is their only surface; other fields hover the tooltip only when the
  // inline note is hidden (visible note + identical hover would be duplication).
  const hoverTip = entry.desc || entry.hoverNote || !notesVisible.value ? meta.tooltip : "";
  // hoverNote fields (the rate pair): hover is their ONLY prose surface, so the
  // tooltip outranks the gray reason; everywhere else the reason explains the
  // disabled control and wins.
  const title = entry.hoverNote ? hoverTip || reason : reason || hoverTip;
  return html`
    <div class="field field-${entry.widget} ${entry.wide ? "wide" : ""} ${entry.span ? "span" : ""} ${isDirty(k) ? "dirty" : ""}" title=${title}>
      <label>${label}</label>
      <div class="control">
        <${W}
          value=${effective(k)}
          options=${options}
          min=${cfgConstraint(entry, "min")}
          max=${cfgConstraint(entry, "max")}
          step=${cfgConstraint(entry, "step")}
          ticks=${entry.ticks}
          def=${entry.def}
          slider=${entry.slider}
          unit=${entry.unit}
          label=${label}
          disabled=${!!reason}
          onChange=${(v) => edit(k, v)}
          onLive=${(v) => setLive(k, v)}
          onCommit=${(v) => edit(k, v)}
        />
        ${entry.unit && entry.widget !== "knob" ? html`<span class="unit">${entry.unit}</span>` : null}
        ${entry.hint ? html`<span class="field-hint">${entry.hint}</span>` : null}
      </div>
      ${entry.rescan ? html`<${RescanButton} />` : null}
      ${entry.desc && descVisible.value ? html`<div class="field-desc">${selectionDescription(entry, effective(k), options, meta)}</div>` : null}
      ${!entry.desc && !entry.hoverNote && meta.tooltip && notesVisible.value ? html`<div class="field-note">${meta.tooltip}</div>` : null}
    </div>
  `;
}
