// Field binder — connects a control key to the three-tree store and renders the
// right primitive. The store contract (effective value, gray/disabled + reason,
// dirty highlight, tooltip, option source) lives HERE, once, instead of being
// copy-pasted into every control. A tab is then just a list of <Field k="..."/>.

import { signal } from "@preact/signals";
import { html } from "../lib/dom.js";
import { schema } from "../store/schema.js";
import { effective, isDirty, edit, setLive, httpFieldMap, formFieldName, refreshDevices } from "../store/state.js";
import { describe, selectionDescription } from "../store/prose.js";
import { optionsFor, enumOptions, grayShapersByRate } from "../store/options.js";
import { narrowOptions, narrowCount } from "../store/narrowing.js";
import { grayReason } from "../store/graying.js";
import { notesVisible, descVisible } from "../store/prefs.js";
import { Segment, Dropdown, NumberBox, TextBox, Checkbox, Slider, SliderNumber, RadioGroup } from "./controls/index.js";
import { Knob } from "./Knob.js";
import { ApodNarrow, HiresNarrow } from "./ApodNarrow.js";

const WIDGETS = {
  segment: Segment,
  dropdown: Dropdown,
  number: NumberBox,
  text: TextBox,
  checkbox: Checkbox,
  slider: Slider,
  slidernum: SliderNumber,
  radio: RadioGroup,
  knob: Knob,
};

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

// Widget kind + the layout opt-ins + the dirty highlight, in that order.
function fieldClasses(entry, key) {
  return `field field-${entry.widget} ${entry.size === "lg" ? "field-lg" : ""} ${entry.wide ? "wide" : ""} ${entry.span ? "span" : ""} ${isDirty(key) ? "dirty" : ""}`;
}

// Option source: the schema's own list or the daemon form's, then the two
// client-side transforms — filter selects narrow their (large) option list by
// the active facets; shaper selects gray what the output rate can't reach.
// The field key threads into narrowOptions so a 1x dropdown reads its OWN
// apodizing state (per-chain, store/narrowing.js).
function rawOptions(entry) {
  if (entry.optionsFrom === "enum") return enumOptions(entry.enumKey);
  if (entry.optionsFrom) return optionsFor(entry.optionsFrom, formFieldName(entry));
  return entry.options;
}
function fieldOptions(entry, key) {
  let options = rawOptions(entry);
  if (entry.narrow) options = narrowOptions(options, effective(key), entry.narrow, key);
  if (entry.rateGray) options = grayShapersByRate(options, entry.rateGray);
  return options;
}

// Live result badge for a narrowable dropdown: "n/total" of how many options
// survive the active facets, counted off the RAW (pre-narrow) list. `on` when
// the list is actually reduced, so the field can flag itself accent.
function narrowBadge(entry, key) {
  if (!entry.narrow) return null;
  const { n, total } = narrowCount(rawOptions(entry), entry.narrow, key);
  return { n, total, on: n < total };
}

// A grayed control names WHY, visibly — the reason renders as a caption
// appended after the manual note (user decision 2026-07-21; hover-only reasons
// proved undiscoverable) unless the schema suppresses it (quietGray).
const captionVisible = (entry, reason) => !!reason && !entry.quietGray;

// Hover title. desc-carrying fields (filters, DSD sources) render the
// per-selection prose inline, so their hover always carries the OVERALL feature
// description; hoverNote fields never render an inline note, so hover is their
// only surface; other fields hover the tooltip only when the inline note is
// hidden (visible note + identical hover would be duplication).
//
// hoverNote fields (the rate pair): hover is their ONLY prose surface, so the
// tooltip outranks the gray reason. Elsewhere the reason takes the hover only
// when its visible caption is suppressed — a visible caption plus the same text
// on hover is duplication.
function hoverTitle(entry, meta, reason) {
  const tip = entry.desc || entry.hoverNote || !notesVisible.value ? meta.tooltip : "";
  if (entry.hoverNote) return tip || reason;
  return captionVisible(entry, reason) ? tip : reason || tip;
}

// The prose under the control, in reading order: per-selection manual text,
// static feature note, gray reason.
function fieldProse(entry, key, meta, reason, options) {
  const showDesc = entry.desc && descVisible.value;
  const showNote = !entry.desc && !entry.hoverNote && meta.tooltip && notesVisible.value;
  return html`
    ${showDesc ? html`<div class="field-desc">${selectionDescription(entry, effective(key), options, meta)}</div>` : null}
    ${showNote ? html`<div class="field-note">${meta.tooltip}</div>` : null}
    ${captionVisible(entry, reason) ? html`<div class="field-gray-reason">${reason}</div>` : null}
  `;
}

// Label row: the field name, optional sub-label, and the live narrow-result
// badge ("14/68", accent once the list is actually reduced).
function FieldLabel({ entry, label, badge }) {
  return html`
    <label>
      ${label}${entry.sublabel ? html`<span class="label-alt">${entry.sublabel}</span>` : null}
      ${badge ? html`<span class="narrow-count ${badge.on ? "on" : ""}">${badge.n}/${badge.total}</span>` : null}
    </label>
  `;
}

// The per-dropdown narrow controls that hang under a filter field: apodizing +
// hide-hi-res on the 1x dropdowns, show-only-hi-res on the Nx dropdowns.
function FieldNarrowControls({ entry, k }) {
  return html`
    ${entry.apodNarrow ? html`<${ApodNarrow} field=${k} />` : null}
    ${entry.hiresNarrow ? html`<${HiresNarrow} field=${k} />` : null}
  `;
}

export function Field({ k }) {
  const entry = schema[k];
  if (!entry) return null;
  const W = WIDGETS[entry.widget];
  const meta = describe(entry, k);
  const label = entry.label || meta.label;
  const reason = grayReason(k);
  const options = fieldOptions(entry, k);
  const badge = narrowBadge(entry, k);
  const classes = `${fieldClasses(entry, k)}${badge && badge.on ? " narrowed" : ""}`;
  return html`
    <div class=${classes} title=${hoverTitle(entry, meta, reason)}>
      <${FieldLabel} entry=${entry} label=${label} badge=${badge} />
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
      ${fieldProse(entry, k, meta, reason, options)}
      <${FieldNarrowControls} entry=${entry} k=${k} />
    </div>
  `;
}
