// The widget pick and the shared wiring both binders draw from: Field.js binds
// the settings tabs, live/View.js binds the LIVE page, and each renders the
// identical control for a schema entry — same widget, same per-option tip,
// same favorite star, same prose block. That decision set lives HERE, once.

import { html } from "../lib/dom.js";
import { optionDescription, selectionDescription, selectedLabel } from "../store/prose.js";
import { plainTrueName } from "../store/plainnames.js";
import { collapsedGroups, toggleCollapsedGroup } from "../store/prefs.js";
import { filterFacets } from "../store/narrow/facets.js";
import { isFavorite, toggleFavorite, favoritesError } from "../store/narrow/favorites.js";
import { Segment, Dropdown, NumberBox, TextBox, Checkbox, Slider, SliderNumber, RadioGroup } from "./controls/index.js";
import { Combobox } from "./controls/Combobox.js";
import { filterTipFacets } from "./narrowbar/facettip.js";
import { Knob } from "./Knob.js";

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
 * @typedef {import("./controls/Combobox.js").TipContent} TipContent
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
// rows the page owns. Every other dropdown keeps the native control.
const tipped = (/** @type {FieldEntry} */ entry) => entry.desc && entry.widget === "dropdown";
/** Picks the widget component a schema entry renders through: Combobox for a desc-carrying dropdown, else the entry's `widget` kind. */
export const widgetFor = (/** @type {FieldEntry} */ entry) =>
  tipped(entry) ? Combobox : WIDGETS[/** @type {keyof typeof WIDGETS} */ (entry.widget)];
/**
 * Builds the combobox's per-row tip resolver for a desc-carrying dropdown;
 * undefined for every native widget. Filter dropdowns carry the facet rows and
 * chips beside the prose; every other desc source ships text alone. The
 * resolver asks value+label only, so it takes the bare SchemaOption shape —
 * a schema literal's rows reach the combobox unenriched.
 * @type {(entry: FieldEntry, meta: FieldMeta) => ((o: SchemaOption) => TipContent) | undefined}
 */
export const tipsFor = (entry, meta) =>
  tipped(entry)
    ? (/** @type {SchemaOption} */ o) => ({
        // The raw engine name heads the tip only where Simplified display has
        // replaced it in the row (store/plainnames.js plainTrueName).
        name: entry.plainNames ? plainTrueName(entry.plainNames, o.label) : "",
        text: optionDescription(entry, o, meta),
        ...(entry.desc === "filter" ? filterTipFacets(o.label) : { rows: [], chips: [] }),
      })
    : undefined;
/**
 * Builds the favorite-star wiring for the filter dropdowns (`narrow`-carrying
 * entries), keyed by option label = filter name (store/narrow/favorites.js); undefined
 * everywhere else, so dither/modulator comboboxes render starless.
 */
export const favFor = (/** @type {FieldEntry} */ entry) =>
  entry.narrow
    ? {
        fav: (/** @type {OptionItem} */ o) => isFavorite(o.label),
        onFav: (/** @type {OptionItem} */ o) => toggleFavorite(o.label),
      }
    : undefined;

/**
 * Builds the apodizing-badge resolver for the filter dropdowns (`narrow`-carrying
 * entries), keyed by option label = filter name — the same join the tip facets
 * use; undefined everywhere else, so dither and modulator comboboxes render
 * badge-free rows. Built in both display styles — a raw engine name says no
 * more about apodizing than a plain one, so Standard rows wear the badge too.
 * @type {(entry: FieldEntry) => ((o: SchemaOption) => "full" | "half" | null) | undefined}
 */
export const badgeFor = (entry) =>
  entry.narrow
    ? (/** @type {SchemaOption} */ o) => {
        const f = filterFacets.value[o.label];
        if (!f) return null;
        return f.apodizingHalf ? "half" : f.apodizing ? "full" : null;
      }
    : undefined;

/**
 * Builds the quality-stars resolver for the filter dropdowns (`narrow`-carrying
 * entries), the same name join as badgeFor but in both display styles — a raw
 * name says nothing about quality, so Standard rows need the stars as much as
 * Simplified ones. Null hides the span for a filter whose facet record
 * carries no rating.
 * @type {(entry: FieldEntry) => ((o: SchemaOption) => number | null) | undefined}
 */
export const starsFor = (entry) =>
  entry.narrow
    ? (/** @type {SchemaOption} */ o) => {
        const f = filterFacets.value[o.label];
        return f && f.quality != null ? f.quality : null;
      }
    : undefined;

/**
 * Builds the group-disclosure wiring for the plain-names dropdowns: collapse
 * state lives in prefs, persisted, keyed per kind so the two chains' filter
 * dropdowns share one fold. Undefined for dropdowns with no grouped mode.
 * @type {(entry: FieldEntry) => import("./controls/Combobox.js").CollapseCtl | undefined}
 */
export const collapseFor = (entry) => {
  const kind = entry.plainNames;
  if (!kind) return undefined;
  return {
    collapsed: (/** @type {string} */ key) => !!collapsedGroups.value[`${kind}|${key}`],
    onToggle: (/** @type {string} */ key) => toggleCollapsedGroup(`${kind}|${key}`),
  };
};

/**
 * A refused favorites write, under the dropdown whose star did not stick. Only
 * the star-carrying (`narrow`) dropdowns render it, for the same reason only
 * they render stars — there is one set and one error, and repeating it under a
 * dither combobox would put it beside a control that cannot cause it.
 * @param {{ entry: FieldEntry }} props
 */
export function FavoriteError({ entry }) {
  if (!entry.narrow || !favoritesError.value) return null;
  return html`<div class="field-error">${favoritesError.value}</div>`;
}

/**
 * The per-selection description block under a desc-carrying control: the raw
 * engine name first, where Simplified display has hidden it from the control
 * itself (store/plainnames.js plainTrueName), then the manual prose.
 * @param {{ entry: FieldEntry, value: string | number | undefined,
 *   options: FieldOptions, meta: FieldMeta }} props
 */
export function DescBlock({ entry, value, options, meta }) {
  const name = entry.plainNames ? plainTrueName(entry.plainNames, selectedLabel(options, value)) : "";
  return html`<div class="field-desc">
    ${name ? html`<div class="field-desc-name">${name}</div>` : null}
    ${selectionDescription(entry, value, options, meta)}
  </div>`;
}
