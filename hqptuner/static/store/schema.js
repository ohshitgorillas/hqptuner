// Control catalog — the single map tying a UI control key to its wire truth.
// This is the glue between the controls and the integration lanes.
//
// Per entry:
//   label        UI label (explicit; http fields don't live in settings.json)
//   group        settings.json group (output|dsp|volume|system) — tooltip source
//   widget       dumb primitive (segment|dropdown|number|checkbox|slider|radio)
//   lane         'live' (4321 setter) | 'http' (POST /config form field)
//                | 'speakers' (the /speakers form's own POST, never staged)
//                | 'hardware' (the engine's own POST, never staged)
//   stateField   live only: the /api/state attribute holding its current index
//   liveKey      live only: writer.py setting key (mode|filter|shaper|rate|…)
//   arg          live only: setter arg written (default 'value'; 'value1x' = 1x filter)
//   field        http only: the POST /config form field name
//   optionsFrom  dropdown source: live enum ('filters'|'shapers'|'rates'|'modes')
//                or 'config' (the form field's own <option> set)
//   grayWhen     optional fn(ctx) -> reason string | ''; ctx.effective(key) reads
//                the *staged* value, so graying reacts before Apply
//   adviseWhen   optional fn(ctx) -> note string | ''; same shape as grayWhen
//                but advisory only — the control stays editable and the note
//                renders in the control row. For settings that belong to the
//                other output mode: the user may want them right BEFORE
//                switching, so graying them forces a stage/unstage dance
//   deviceGray   'pcm' | 'sdm' | 'mode': narrow this control's options against
//                what the selected output device announced (store/narrow/devicecaps.js)
//   quietGray    suppress the visible gray caption (hover title only) — for
//                controls whose graying is already explained by context (the
//                rate pair, dimmed post-process card bodies)
//   inlineGray   render the gray caption in the control row, right of the
//                widget, instead of stacked under the manual note — for short
//                reasons on narrow controls, where a line of its own reads as
//                unrelated prose rather than as this control's state
//
// Mode graying uses the live mode index (0=[source]/Auto, 1=PCM,
// 2=SDM). auto_family/samplerate/bitrate are forced by the apply layer, not
// exposed here (friendly rate always assumes auto-family follow).
//
// The entries live in store/schema/ by group; the graying predicates are in
// store/schema/gray.js and the option lists in store/schema/options.js.

import { dsp } from "./schema/dsp.js";
import { hardware } from "./schema/hardware.js";
import { output } from "./schema/output.js";
import { postprocess } from "./schema/postprocess.js";
import { speakers } from "./schema/speakers.js";
import { volume } from "./schema/volume.js";

/** @type {Record<string, SchemaField>} */
export const schema = { ...output, ...dsp, ...postprocess, ...speakers, ...volume, ...hardware };

/**
 * The form constraint name for a catalog entry, which is also the name the server serves its reading under.
 *
 * @param {SchemaField | undefined} entry
 * @returns {string}
 */
export function formFieldName(entry) {
  return entry?.formField ?? entry?.field ?? "";
}

/** @type {Record<string, string>} */
const keyByServedName = Object.fromEntries(
  Object.entries(schema).flatMap(([key, entry]) => (entry.field && entry.field !== key ? [[entry.field, key]] : [])),
);

/**
 * The catalog key of a field named by its key or by the name the server serves it under; a name the catalog does not hold comes back as given.
 *
 * @param {string} name
 * @returns {string}
 */
export const keyOf = (name) => (schema[name] ? name : (keyByServedName[name] ?? name));

/**
 * Where the pending buffer holds an entry's edit: the live buffer under its liveKey and arg, else the http buffer under its served field name.
 *
 * @param {SchemaField} entry
 * @param {string | null | undefined} lane the lane the entry's reading names, else the entry's own
 * @returns {{ live: true, name: string, arg: string } | { live: false, name: string }}
 */
export function stagedSlot(entry, lane) {
  if ((lane ?? (entry.liveKey ? "live" : "form")) === "live") {
    return { live: true, name: entry.liveKey ?? "", arg: entry.arg ?? "value" };
  }
  return { live: false, name: entry.field ?? "" };
}
