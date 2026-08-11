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
import { describe, selectionDescription, optionDescription, selectedLabel } from "../store/prose.js";
import { optionsFor, enumOptions, grayShapersByRate } from "../store/options.js";
import { grayRatesByDevice, grayModesByDevice } from "../store/devicecaps.js";
import { narrowOptions, narrowCount } from "../store/narrowing.js";
import { isFavorite, toggleFavorite, favoritesError } from "../store/favorites.js";
import { adviceNote, grayReason } from "../store/graying.js";
import { truthy } from "../lib/coerce.js";
import { notesVisible, descVisible } from "../store/prefs.js";
import { Segment, Dropdown, NumberBox, TextBox, Checkbox, Slider, SliderNumber, RadioGroup } from "./controls/index.js";
import { Combobox } from "./controls/Combobox.js";
import { Knob } from "./Knob.js";
import { Ask } from "./Ask.js";

/**
 * @typedef {SchemaField & { narrow?: string, slider?: boolean }} FieldEntry
 *   One schema catalog entry. `narrow` (which facet family a filter dropdown
 *   narrows on) and `slider` (knob variant switch) are on the catalog entries in
 *   store/schema.js but not on the ambient `SchemaField`, so they are added here.
 *   Two more fields on that declaration disagree with the catalog and are NOT
 *   patched here, because a local override would stop a FieldEntry being a
 *   SchemaField everywhere the stores ask for one: `scale` and `rateGray` are
 *   declared number and boolean while store/schema.js writes "log" and
 *   "pcm"/"sdm". Those belong in types/shared.d.ts.
 * @typedef {{ label: string, tooltip: string }} FieldMeta
 *   What store/prose.js describe() resolves for a key: the manual's name for the
 *   control and its prose.
 * @typedef {{ n: number, total: number }} NarrowBadge
 * @typedef {OptionItem[] | SchemaOption[] | undefined} FieldOptions
 *   A control's option list — the stores' enriched form, the schema's bare
 *   value+label form, or nothing at all for the non-list widgets.
 */

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
const tipped = (/** @type {FieldEntry} */ entry) => entry.desc && entry.widget === "dropdown";
/** Picks the widget component a schema entry renders through: Combobox for a desc-carrying dropdown, else the entry's `widget` kind. */
export const widgetFor = (/** @type {FieldEntry} */ entry) =>
  tipped(entry) ? Combobox : WIDGETS[/** @type {keyof typeof WIDGETS} */ (entry.widget)];
/** Builds the combobox's per-row tip resolver for a desc-carrying dropdown; undefined for every native widget. */
export const tipsFor = (/** @type {FieldEntry} */ entry, /** @type {FieldMeta} */ meta) =>
  tipped(entry) ? (/** @type {OptionItem} */ o) => optionDescription(entry, o, meta) : undefined;
/**
 * Builds the favorite-star wiring for the filter dropdowns (`narrow`-carrying
 * entries), keyed by option label = filter name (store/favorites.js); undefined
 * everywhere else, so dither/modulator comboboxes render starless. Shared with
 * the LIVE page's binder, same as widgetFor/tipsFor.
 */
export const favFor = (/** @type {FieldEntry} */ entry) =>
  entry.narrow
    ? {
        fav: (/** @type {OptionItem} */ o) => isFavorite(o.label),
        onFav: (/** @type {OptionItem} */ o) => toggleFavorite(o.label),
      }
    : undefined;

/**
 * A refused favorites write, under the dropdown whose star did not stick. Only
 * the star-carrying (`narrow`) dropdowns render it, for the same reason only
 * they render stars — there is one set and one error, and repeating it under a
 * dither combobox would put it beside a control that cannot cause it. Shared
 * with the LIVE page's binder, same as widgetFor/tipsFor/favFor.
 * @param {{ entry: FieldEntry }} props
 */
export function FavoriteError({ entry }) {
  if (!entry.narrow || !favoritesError.value) return null;
  return html`<div class="field-error">${favoritesError.value}</div>`;
}

// http-lane number fields carry min/max/step parsed from the live GET /config
// form (the daemon is the authority for its own bounds). A schema entry may
// carry fallback min/max/step for fields whose form gives none (loudness
// steepness) — the form's value wins whenever it exists.
/**
 * @param {FieldEntry} entry
 * @param {"min" | "max" | "step"} name
 */
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
/**
 * @param {FieldEntry} entry
 * @param {string} key
 */
function controlValue(entry, key) {
  const v = effective(key);
  return entry.bool ? (truthy(v) ? "1" : "0") : v;
}

// Widget kind + the layout opt-ins + the dirty highlight, in that order.
/**
 * @param {FieldEntry} entry
 * @param {string} key
 * @param {string} label
 * @returns {string}
 */
function fieldClasses(entry, key, label) {
  return `field field-${entry.widget} ${label ? "" : "field-nolabel"} ${entry.wide ? "wide" : ""} ${entry.span ? "span" : ""} ${isDirty(key) ? "dirty" : ""}`;
}

// Option source: the schema's own list or the daemon form's, then the two
// client-side transforms — filter selects narrow their (large) option list by
// the active facets; shaper selects gray what the output rate can't reach.
// The field key threads into narrowOptions so a 1x dropdown reads its OWN
// apodizing state (per-chain, store/narrowing.js).
/**
 * @param {FieldEntry} entry
 * @returns {FieldOptions}
 */
function rawOptions(entry) {
  if (entry.optionsFrom === "enum") return enumOptions(entry.enumKey || "");
  if (entry.optionsFrom) return optionsFor(entry.optionsFrom, formFieldName(entry));
  return entry.options;
}
/**
 * @param {FieldEntry} entry
 * @param {string} key
 * @param {FieldOptions} raw
 * @returns {FieldOptions}
 */
function fieldOptions(entry, key, raw) {
  let options = raw;
  // The non-list widgets have no options at all, and none of the transforms
  // below has anything to do to them.
  if (!options) return undefined;
  if (entry.narrow) options = narrowOptions(options, entry.narrow, key);
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
/**
 * @param {FieldEntry} entry
 * @param {string} key
 * @param {FieldOptions} raw
 * @returns {NarrowBadge | null}
 */
function narrowBadge(entry, key, raw) {
  if (!entry.narrow) return null;
  return raw ? narrowCount(raw, entry.narrow, key) : null;
}

// The label the closed control wears, read off the RAW list: narrowing can drop
// the current selection off the list the widget renders, and the control still
// has to name what is selected rather than fall back to the raw value.
/**
 * @param {string} key
 * @param {FieldOptions} raw
 * @returns {string}
 */
const valueLabel = (key, raw) => selectedLabel(raw, effective(key));

// A grayed control names WHY, visibly — the reason renders as a caption
// appended after the manual note (user decision; hover-only reasons
// proved undiscoverable) unless the schema suppresses it (quietGray).
// quietGray silences a reason whose cause is on the card itself ("Enable
// crossfeed to adjust" — the gate is one row up). The matrix-bypass reason is
// suppressed too, on every field: its card already carries BypassNote saying
// the same sentence once, so a per-field caption would repeat it under every
// control on the card. The reason still grays and still reaches the hover title.
const captionVisible = (/** @type {FieldEntry} */ entry, /** @type {string} */ reason) =>
  !!reason && !entry.quietGray && reason !== MATRIX_BYPASS_REASON;
// `inlineGray` moves that caption off the stack and into the control row, to
// the right of the widget itself, for short reasons on narrow controls where a
// line of its own under the manual note reads as unrelated prose.
const inlineCaption = (/** @type {FieldEntry} */ entry, /** @type {string} */ reason) =>
  captionVisible(entry, reason) && !!entry.inlineGray;
const stackedCaption = (/** @type {FieldEntry} */ entry, /** @type {string} */ reason) =>
  captionVisible(entry, reason) && !entry.inlineGray;

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
/**
 * @param {FieldEntry} entry
 * @param {FieldMeta} meta
 * @param {string} reason
 * @returns {string}
 */
function hoverTitle(entry, meta, reason) {
  const tip = entry.desc || entry.hoverNote || !notesVisible.value ? meta.tooltip : "";
  if (entry.hoverNote) return tip || reason;
  return captionVisible(entry, reason) ? tip : reason || tip;
}

// The prose under the control, in reading order: per-selection manual text,
// static feature note, gray reason, refused favorites write. The per-selection
// text is looked up in the RAW option list, not the narrowed one: a selection
// the facets narrowed off the menu still has prose, and it still describes what
// is selected.
/**
 * @param {FieldEntry} entry
 * @param {string} key
 * @param {FieldMeta} meta
 * @param {{ reason: string, options: FieldOptions }} state
 */
function fieldProse(entry, key, meta, { reason, options }) {
  const showDesc = entry.desc && descVisible.value;
  const showNote = !entry.desc && !entry.hoverNote && meta.tooltip && notesVisible.value;
  return html`
    ${showDesc ? html`<div class="field-desc">${selectionDescription(entry, effective(key), options, meta)}</div>` : null}
    ${showNote ? html`<div class="field-note">${meta.tooltip}</div>` : null}
    ${stackedCaption(entry, reason) ? html`<div class="field-gray-reason">${reason}</div>` : null}
    <${FavoriteError} entry=${entry} />
  `;
}

// Label row: the field name, optional sub-label, and the live narrow-result
// badge ("14/68", always muted).
/**
 * @param {{ entry: FieldEntry, label: string, badge: NarrowBadge | null }} props
 */
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
/**
 * @param {{ entry: FieldEntry, reason: string, advice: string }} props
 */
function ControlCaptions({ entry, reason, advice }) {
  return html`
    ${inlineCaption(entry, reason) ? html`<span class="field-gray-reason">${reason}</span>` : null}
    ${advice ? html`<span class="field-advice">${advice}</span>` : null}
  `;
}

/**
 * Renders one settings row for schema key `k`: its label, the widget the schema
 * asks for wired to the store, and the prose and captions under it. Renders
 * nothing for a key the schema does not carry.
 * @param {{ k: string }} props
 */
export function Field({ k }) {
  const entry = /** @type {Record<string, FieldEntry>} */ (schema)[k];
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
  const raw = rawOptions(entry);
  const options = fieldOptions(entry, k, raw);
  const badge = narrowBadge(entry, k, raw);
  const { fav, onFav } = favFor(entry) || {};
  const classes = fieldClasses(entry, k, label);
  return html`
    <div class=${classes} title=${hoverTitle(entry, meta, reason)}>
      ${label ? html`<${FieldLabel} entry=${entry} label=${label} badge=${badge} />` : null}
      <div class="control">
        <${W}
          value=${controlValue(entry, k)}
          options=${options}
          valueLabel=${valueLabel(k, raw)}
          tips=${tipsFor(entry, meta)}
          fav=${fav}
          onFav=${onFav}
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
          onChange=${(/** @type {string | number} */ v) => edit(k, v)}
          onLive=${(/** @type {string | number} */ v) => setLive(k, v)}
          onCommit=${(/** @type {string | number} */ v) => edit(k, v)}
        />
        ${entry.unit && entry.widget !== "knob" ? html`<span class="unit">${entry.unit}</span>` : null}
        ${entry.hint ? html`<span class="field-hint">${entry.hint}</span>` : null}
        <${Ask} owner=${k} />
        <${ControlCaptions} entry=${entry} reason=${reason} advice=${advice} />
      </div>
      ${entry.rescan ? html`<${RescanButton} />` : null}
      ${fieldProse(entry, k, meta, { reason, options: raw })}
    </div>
  `;
}
