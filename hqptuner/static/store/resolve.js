// Three-tree resolution: given a schema key, what does a control render, what is
// its baseline, and is it dirty? Reads the source signals (store/signals.js) and
// nothing else — no `api` import, no writes. The write side is store/actions.js.

import { computed } from "@preact/signals";
import { schema } from "./schema.js";
import { truthy } from "../lib/coerce.js";
import { config, engineState, matrixConfig, staged, liveOverride, previewConfig, pendingPreset } from "./signals.js";

// A form's fields keyed by name — the baseline/constraint source a control
// reads from. Empty until that form has been polled at least once.
/**
 * @typedef {object} FormField
 *   One field of a daemon form as conf/httpconf.py parses it — /config and
 *   /matrix alike. `value` carries the widget's own domain: a real boolean for a
 *   checkbox, a number for a number input, the selected option's string for a
 *   select and a plain text input.
 * @property {string} name
 * @property {string} type checkbox | number | select | text | …
 * @property {string | number | boolean} value
 * @property {SchemaOption[]} [options] select only
 * @property {number} [min] number only
 * @property {number} [max]
 * @property {number} [step]
 * @property {string} [on_value] checkbox only: what the daemon expects on submit
 * @property {string} [section]
 * @property {string} [label]
 *
 * @typedef {Record<string, string | number | undefined>} PipelineRow
 *   One matrix pipeline row, in the loose shape the editor and the /matrix form
 *   hand around; canonRow is what narrows it to the all-string canonical form.
 */

/**
 * @param {{ value: { fields?: FormField[] } }} form
 */
const byName = (form) =>
  computed(() => {
    /** @type {Record<string, FormField>} */
    const map = {};
    for (const f of (form.value && form.value.fields) || []) map[f.name] = f;
    return map;
  });

export const configByName = byName(config);
// /matrix fields — the source for the crossfeed/DAC-correction controls
// (endpoint "matrix" in the schema).
export const matrixByName = byName(matrixConfig);

// SchemaField's lane-specific keys are declared optional because a live-lane entry
// carries stateField/liveKey and an http-lane one carries field — each lane's
// entries always have their own, but the type has no discriminator to say so.
// These read a key for a lane; the "" an absent key falls back to misses every
// lookup exactly as the undefined key it stands in for already did.
const fieldKey = (/** @type {SchemaField} */ e) => e.field || "";
const stateKey = (/** @type {SchemaField} */ e) => e.stateField || "";

// http-lane field source: /matrix for endpoint "matrix", /config otherwise.
/**
 * The form-field map an entry reads from: /matrix for endpoint "matrix",
 * /config otherwise.
 *
 * @param {SchemaField} entry
 * @returns {Record<string, FormField>}
 */
export function httpFieldMap(entry) {
  return entry.endpoint === "matrix" ? matrixByName.value : configByName.value;
}

// The form field a control READS its baseline/options/constraints from. Usually
// entry.field (also the staged key), but the matrix globals stage under prefixed
// names (matrix_engine — the write lane's namespace) while the daemon's form
// field is bare (engine): entry.formField carries the read-side name.
/**
 * The daemon form-field name an entry reads its baseline under, which differs
 * from its staged key where the schema declares `formField`.
 *
 * @param {SchemaField} entry
 * @returns {string}
 */
export function formFieldName(entry) {
  return entry.formField || fieldKey(entry);
}

// Matrix tab read model: the pipeline rows as the backend parser grouped them.
// The saved-profile half of this model lives in store/profiles.js.
const matrixRows = computed(() => (matrixConfig.value && matrixConfig.value.rows) || []);

// --- pipeline set (matrix-spec.md "Pipeline flow rows"): staged as ONE atomic canonical-JSON
// field, matching the backend's read_pipelines serialization byte-for-byte
// (alphabetical keys, compact, all-string values) so dirty-compare and the
// apply's verify diff both reduce to string equality.
const canonRow = (/** @type {PipelineRow} */ r) => ({
  gain: String(r.gain ?? "0"),
  gainunit: r.gainunit || "dB",
  mixdown: String(r.mixdown ?? "0"),
  process: r.process || "",
  source: String(r.source ?? "0"),
});
/** Serialize pipeline rows to the backend's canonical JSON, so compares reduce to string equality. */
export const canonPipelines = (/** @type {PipelineRow[]} */ rows) => JSON.stringify(rows.map(canonRow));

// Whether a matrix profile is switched live right now. The switch is memory-only
// (4321 MatrixSetProfile), so the config file keeps its own rows while the engine
// runs the profile's — the one case where file truth is not running truth.
const liveProfileActive = computed(() => {
  const name = (matrixConfig.value && matrixConfig.value.live_active) || "";
  return name !== "" && name !== "[Default]";
});

// Baseline: the file-truth canonical JSON (read_config's matrix_pipelines) when
// credentials allow it; the parsed /matrix form rows otherwise (read-only mode).
// A live-active profile overrides that order — the editor and the matrix graph
// must show the rows the engine is playing, not the ones the file happens to
// hold, and an edit then stages a diff against what is actually running. Falls
// back to the file when the daemon has reported no rows.
export const pipelineBaseline = computed(() => {
  if (liveProfileActive.value && matrixRows.value.length) return matrixRows.value.map(canonRow);
  const file = fileConfig.value.matrix_pipelines;
  if (file) {
    try {
      return JSON.parse(file);
    } catch {
      /* fall through to the form rows */
    }
  }
  return matrixRows.value.map(canonRow);
});

// What the pipeline editor renders: staged set if present, else baseline.
export const effectivePipelines = computed(() => {
  const stagedJson = staged.value.http.matrix_pipelines;
  if (stagedJson !== undefined) {
    try {
      return JSON.parse(stagedJson);
    } catch {
      /* corrupt staged value — render baseline */
    }
  }
  return pipelineBaseline.value;
});

// Running config read from the config XML, in form-field terms (manager.file_config).
// The /config form is lossy where a setting's XML domain is wider than the widget
// the daemon renders for it: volume_fixed is 0/1/2 in the XML (off / −3 dB / −6 dB)
// but a bare checkbox on the form, so the form cannot tell −3 from −6. Schema
// entries flagged `fileTruth` take their baseline from here.
const fileConfig = computed(() => (config.value && config.value.file) || {});

// The truly-loaded preset name (ConfigurationGet), as the daemon reports it.
export const activePreset = computed(() => (config.value && config.value.active) || "");

// --- three-tree resolution ---
// Each source returns a one-element BOX rather than the value itself: a preset
// or a config file may legitimately ground a field to null or undefined, and
// "grounded to nothing" has to stay distinguishable from "not grounded here".

// A previewed preset's values are the baseline for its grounded fields, so the
// editor shows the preset before it's applied and tweaks read as dirty over it.
/**
 * @param {SchemaField} entry
 * @returns {{ value: string | number | boolean } | null}
 */
function previewedValue(entry) {
  const preview = previewConfig.value;
  const key = fieldKey(entry);
  return preview && key in preview ? { value: preview[key] } : null;
}

// The config XML is wider than the form for a few settings — volume_fixed is
// 0/1/2 in the file but a bare checkbox on the form — so fileTruth entries take
// the file when it has an answer.
// appliesLive entries ground here too, for the opposite reason: their edits go
// out over the Control API and never reach the XML, so the daemon's /config form
// keeps reporting the superseded value. `file` carries the running truth (the XML
// overlaid with the live lane's changes), which is what the control must show —
// otherwise the dropdown snaps back after Apply and re-selecting the previous
// filter reads as clean, leaving no way to go back to it.
/**
 * @param {SchemaField} entry
 * @returns {{ value: string | number | boolean } | null}
 */
function fileValue(entry) {
  if (!entry.fileTruth && !entry.appliesLive) return null;
  const fv = fileConfig.value[fieldKey(entry)];
  return fv !== undefined ? { value: fv } : null;
}

// The daemon's own form, last. No file truth available (no credentials, or the
// backup read failed) means falling back to the form's boolean, normalized into
// the field's own domain so a staged "1" doesn't read as dirty against `true`.
/**
 * @param {SchemaField} entry
 * @returns {string | number | boolean | undefined}
 */
function formValue(entry) {
  const f = httpFieldMap(entry)[formFieldName(entry)];
  if (!f) return undefined;
  if (entry.fileTruth && typeof f.value === "boolean") return f.value ? "1" : "0";
  return f.value;
}

/**
 * @param {SchemaField} entry
 * @returns {string | number | boolean | undefined}
 */
function baseline(entry) {
  if (entry.lane === "live") return (engineState.value || {})[stateKey(entry)];
  // Not a form field: with no file truth (read-only mode) formValue finds nothing
  // and it reads permanently dirty against undefined. pipelineBaseline already
  // picks file-truth-or-form-rows; re-canonicalized to keep the compare a string.
  if (entry.field === "matrix_pipelines") return canonPipelines(pipelineBaseline.value);
  const grounded = previewedValue(entry) || fileValue(entry);
  return grounded ? grounded.value : formValue(entry);
}

/**
 * @param {SchemaField} entry
 * @returns {string | undefined}
 */
function stagedValue(entry) {
  const st = staged.value;
  if (entry.lane === "live") {
    const bucket = st.live[entry.liveKey || ""];
    return bucket ? bucket[entry.arg || "value"] : undefined;
  }
  return st.http[fieldKey(entry)];
}

// runningValue(key) — the ACTIVE engine/daemon value only: live state or the
// running config forms, ignoring staged edits AND preset preview. For surfaces
// that must reflect what is actually processing right now (signal path, the
// live-volume banner), never the editor's pending picture.
/**
 * The value the engine or daemon is actually running for a key, ignoring staged
 * edits and preset preview alike.
 *
 * @param {string} key
 * @returns {string | number | boolean | undefined}
 */
export function runningValue(key) {
  const e = schema[key];
  if (!e) return undefined;
  if (e.lane === "live") return (engineState.value || {})[stateKey(e)];
  if (e.fileTruth || e.appliesLive) {
    const fv = fileConfig.value[fieldKey(e)];
    if (fv !== undefined) return fv;
  }
  const f = httpFieldMap(e)[formFieldName(e)];
  return f ? f.value : undefined;
}

// effective(key) — what a control renders: staged edit if present, else baseline.
/**
 * The value a control renders: an active knob drag, else the staged edit, else
 * the baseline.
 *
 * @param {string} key
 * @returns {string | number | boolean | undefined}
 */
export function effective(key) {
  const e = schema[key];
  if (!e) return undefined;
  const lo = liveOverride.value[key];
  if (lo !== undefined) return lo; // active knob drag wins
  const sv = stagedValue(e);
  return sv !== undefined ? sv : baseline(e);
}

// Boolean values cross domains: config baseline is a bool, staged is "1"/"0".
// Compare in the control's own domain so a control toggled back to its original
// stops reading as dirty (else it stays highlighted until Discard). That is every
// checkbox plus every `bool` entry — the enable gates render as two-button
// segments but their value is a truth, not a token (see Field.js controlValue).
/**
 * Whether a key's staged value differs from its baseline, compared in the
 * control's own domain.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isDirty(key) {
  const e = schema[key];
  if (!e) return false;
  const sv = stagedValue(e);
  if (sv === undefined) return false;
  const base = baseline(e);
  if (e.widget === "checkbox" || e.bool) return truthy(sv) !== truthy(base);
  return String(sv) !== String(base);
}

// Every staged entry that no longer reads as a change, named the way the stage
// endpoint's `drop` member names them. The server's buffer must never keep one:
// it counts as nothing on screen, but it still rides the next apply and restarts
// the daemon to write a value the daemon already has. Two ways an entry gets
// here — the user returned a control to its baseline, or the baseline moved out
// from under a staged value that now matches it.
//
// An entry no schema key claims is never reported. The store cannot judge what
// it cannot ground, and silently dropping a field some other surface staged is
// worse than carrying it.
/** Staged entries that no longer read as a change, named as the stage endpoint's `drop` member names them. */
export function cleanStagedKeys() {
  const st = staged.value;
  const keys = Object.keys(schema);
  const httpKeys = (/** @type {string} */ field) =>
    keys.filter((k) => schema[k].lane !== "live" && schema[k].field === field);
  const liveKeys = (/** @type {string} */ liveKey, /** @type {string} */ arg) =>
    keys.filter(
      (k) => schema[k].lane === "live" && schema[k].liveKey === liveKey && (schema[k].arg || "value") === arg,
    );
  // grounded AND unanimous: a field two controls share is a change while either
  // of them still reads dirty against it
  const clean = (/** @type {string[]} */ matches) => matches.length > 0 && !matches.some(isDirty);
  /** @type {Record<string, string[]>} */
  const live = {};
  for (const [liveKey, bucket] of Object.entries(st.live)) {
    const args = Object.keys(bucket).filter((arg) => clean(liveKeys(liveKey, arg)));
    if (args.length) live[liveKey] = args;
  }
  return { live, http: Object.keys(st.http).filter((field) => clean(httpKeys(field))) };
}

// --- derived: the pending-changes bar ---
const dirtyKeys = computed(() => Object.keys(schema).filter(isDirty));
export const stagedCount = computed(() => dirtyKeys.value.length);
// Apply is warranted by staged tweaks OR a previewed preset waiting to commit.
export const hasPending = computed(() => stagedCount.value > 0 || pendingPreset.value !== null);
export const split = computed(() => {
  let live = 0;
  let restart = 0;
  let routable = 0;
  for (const k of dirtyKeys.value) {
    // lane 'live' goes out over the Control API whatever else is staged. An
    // http-lane field the write path CAN route to a Control API setter (schema
    // appliesLive) only goes live when the whole staged batch does: one
    // restart-required field sends the entire batch down the restore lane
    // (lanes/live/routing.split_live), so it restarts with the rest.
    if (schema[k].lane === "live") live += 1;
    else if (schema[k].appliesLive) routable += 1;
    else restart += 1;
  }
  if (restart > 0) restart += routable;
  else live += routable;
  return { live, restart };
});
