// Field binder — connects a control key to the three-tree store and renders the
// right primitive. The store contract (effective value, gray/disabled + reason,
// dirty highlight, tooltip, option source) lives HERE, once, instead of being
// copy-pasted into every control. A tab is then just a list of <Field k="..."/>.

import { signal } from "@preact/signals";
import { html } from "../lib/dom.js";
import { schema, MATRIX_BYPASS_REASON } from "../store/schema.js";
import { effective, isDirty, httpFieldMap, formFieldName } from "../store/resolve.js";
import { edit, setLive } from "../store/actions.js";
import { refreshDevices } from "../store/sync.js";
import { describe, selectionDescription, optionDescription } from "../store/prose.js";
import { optionsFor, enumOptions, grayShapersByRate } from "../store/options.js";
import { grayRatesByDevice, grayModesByDevice } from "../store/devicecaps.js";
import { narrowOptions, narrowCount } from "../store/narrowing.js";
import { adviceNote, grayReason } from "../store/graying.js";
import { truthy } from "../lib/coerce.js";
import { notesVisible, descVisible } from "../store/prefs.js";
import { Segment, Dropdown, NumberBox, TextBox, Checkbox, Slider, SliderNumber, RadioGroup } from "./controls/index.js";
import { Combobox } from "./controls/Combobox.js";
import { Knob } from "./Knob.js";

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

// A desc-carrying dropdown renders the custom combobox instead of a native
// <select>: macOS never surfaces option tooltips, so per-option prose needs
// rows the page owns. Every other dropdown keeps the native control. Exported
// so the LIVE page's hand-rolled binder makes the identical pick — this
// decision exists here and nowhere else.
const tipped = (entry) => entry.desc && entry.widget === "dropdown";
export const widgetFor = (entry) => (tipped(entry) ? Combobox : WIDGETS[entry.widget]);
// The combobox's per-row tip resolver; undefined for every native widget.
export const tipsFor = (entry, meta) => (tipped(entry) ? (o) => optionDescription(entry, o, meta) : undefined);

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

// A boolean field's value reaches us in two shapes: the daemon's form parses a
// checkbox to a real `false`/`true`, while a staged edit is the string "1"/"0"
// the control wrote. A checkbox reads both through truthy() and never noticed.
// A segment does not — it matches its option values by string, so a `false`
// baseline matched neither "1" nor "0" and the switch rendered with NO active
// button at all. `bool` on the entry says "this control's value is a truth, not
// a token": normalise it to the pair the options are written in.
function controlValue(entry, key) {
  const v = effective(key);
  return entry.bool ? (truthy(v) ? "1" : "0") : v;
}

// Widget kind + the layout opt-ins + the dirty highlight, in that order.
function fieldClasses(entry, key, label) {
  return `field field-${entry.widget} ${label ? "" : "field-nolabel"} ${entry.wide ? "wide" : ""} ${entry.span ? "span" : ""} ${isDirty(key) ? "dirty" : ""}`;
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
  // Last, because it is about the hardware rather than the settings: what the
  // selected output device announced it can carry (store/devicecaps.js).
  if (entry.deviceGray === "mode") options = grayModesByDevice(options);
  else if (entry.deviceGray) options = grayRatesByDevice(options, entry.deviceGray);
  return options;
}

// Live result badge for a narrowable dropdown: "n/total" of how many options
// survive the active facets, counted off the RAW (pre-narrow) list. Always
// muted — accent on a control means staged edit, nothing else.
function narrowBadge(entry, key) {
  if (!entry.narrow) return null;
  return narrowCount(rawOptions(entry), entry.narrow, key);
}

// A grayed control names WHY, visibly — the reason renders as a caption
// appended after the manual note (user decision; hover-only reasons
// proved undiscoverable) unless the schema suppresses it (quietGray).
// quietGray silences a reason whose cause is on the card itself ("Enable
// crossfeed to adjust" — the gate is one row up). A bypassed matrix is not that:
// its switch is on the Matrix tab, so the reason renders whatever the field says.
const captionVisible = (entry, reason) => !!reason && (!entry.quietGray || reason === MATRIX_BYPASS_REASON);
// `inlineGray` moves that caption off the stack and into the control row, to
// the right of the widget itself, for short reasons on narrow controls where a
// line of its own under the manual note reads as unrelated prose.
const inlineCaption = (entry, reason) => captionVisible(entry, reason) && !!entry.inlineGray;
const stackedCaption = (entry, reason) => captionVisible(entry, reason) && !entry.inlineGray;

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
    ${stackedCaption(entry, reason) ? html`<div class="field-gray-reason">${reason}</div>` : null}
  `;
}

// Label row: the field name, optional sub-label, and the live narrow-result
// badge ("14/68", always muted).
function FieldLabel({ entry, label, badge }) {
  return html`
    <label>
      ${label}${entry.sublabel ? html`<span class="label-alt">${entry.sublabel}</span>` : null}
      ${badge ? html`<span class="narrow-count">${badge.n}/${badge.total}</span>` : null}
    </label>
  `;
}

// The two captions that ride in the control row beside the widget: a gray
// reason placed inline by schema `inlineGray`, and an advisory note (`adviseWhen`)
// on a control that stays live.
function ControlCaptions({ entry, reason, advice }) {
  return html`
    ${inlineCaption(entry, reason) ? html`<span class="field-gray-reason">${reason}</span>` : null}
    ${advice ? html`<span class="field-advice">${advice}</span>` : null}
  `;
}

export function Field({ k }) {
  const entry = schema[k];
  if (!entry) return null;
  const W = widgetFor(entry);
  const meta = describe(entry, k);
  // An explicit empty label means the row has NO name column: the card's own
  // head already names the thing the control switches, and a word repeating it
  // beside the switch is noise. Distinct from a missing label, which still falls
  // back to the manual's name for the control.
  const label = entry.label === "" ? "" : entry.label || meta.label;
  const reason = grayReason(k);
  // Advisory note (schema adviseWhen): always inline, never disables, never
  // touches the hover title — it is already visible beside the control.
  const advice = adviceNote(k);
  const options = fieldOptions(entry, k);
  const badge = narrowBadge(entry, k);
  const classes = fieldClasses(entry, k, label);
  return html`
    <div class=${classes} title=${hoverTitle(entry, meta, reason)}>
      ${label ? html`<${FieldLabel} entry=${entry} label=${label} badge=${badge} />` : null}
      <div class="control">
        <${W}
          value=${controlValue(entry, k)}
          options=${options}
          tips=${tipsFor(entry, meta)}
          min=${cfgConstraint(entry, "min")}
          max=${cfgConstraint(entry, "max")}
          step=${cfgConstraint(entry, "step")}
          ticks=${entry.ticks}
          anchor=${entry.anchor}
          def=${entry.def}
          slider=${entry.slider}
          scale=${entry.scale}
          unit=${entry.unit}
          label=${label}
          disabled=${!!reason}
          onChange=${(v) => edit(k, v)}
          onLive=${(v) => setLive(k, v)}
          onCommit=${(v) => edit(k, v)}
        />
        ${entry.unit && entry.widget !== "knob" ? html`<span class="unit">${entry.unit}</span>` : null}
        ${entry.hint ? html`<span class="field-hint">${entry.hint}</span>` : null}
        <${ControlCaptions} entry=${entry} reason=${reason} advice=${advice} />
      </div>
      ${entry.rescan ? html`<${RescanButton} />` : null}
      ${fieldProse(entry, k, meta, reason, options)}
    </div>
  `;
}
