import { computed } from "@preact/signals";
import { field, readings } from "./core/readings.js";
import { config, matrixConfig } from "./signals.js";

/** @typedef {{ gain: string, gainunit: string, mixdown: string, process: string, source: string }} PipelineRow */
/** @typedef {{ name: string, value?: unknown, min?: string | number, max?: string | number, step?: string | number, options?: { value: string, label: string }[] }} FormField */

/**
 * The control's shared reading, including its held edit.
 * @param {string} key
 * @returns {*}
 */
export function effective(key) {
  return field(key).value.value;
}

/**
 * The shown store's reading before staged or held edits.
 * @param {string} key
 * @returns {*}
 */
export function runningValue(key) {
  return field(key).value.running;
}

/**
 * Whether the server reports a staged edit for the field.
 * @param {string} key
 * @returns {boolean}
 */
export function isDirty(key) {
  return field(key).value.dirty;
}

/**
 * Serialize the editable pipeline columns as form text.
 * @param {unknown} rows
 * @returns {string}
 */
export function canonPipelines(rows) {
  return JSON.stringify(
    (Array.isArray(rows) ? rows : []).map((row) => ({
      gain: String(row.gain ?? "0"),
      gainunit: String(row.gainunit ?? "dB"),
      mixdown: String(row.mixdown ?? "0"),
      process: String(row.process ?? ""),
      source: String(row.source ?? "0"),
    })),
  );
}

/**
 * The form constraint name for a catalog entry.
 * @param {SchemaField} entry
 * @returns {string}
 */
export function formFieldName(entry) {
  return entry.formField ?? entry.field ?? "";
}

/**
 * The constraint map supplied by the entry's form.
 * @param {SchemaField} entry
 * @returns {Record<string, FormField>}
 */
export function httpFieldMap(entry) {
  return entry.endpoint === "matrix" ? matrixByName.value : configByName.value;
}

export const stagedCount = computed(() => Object.keys(readings.value?.fields ?? {}).filter(isDirty).length);

/** @type {{ readonly value: PipelineRow[] }} */
export const effectivePipelines = computed(() => {
  const value = effective("matrix_pipelines");
  const rows = typeof value === "string" ? JSON.parse(value) : value;
  return JSON.parse(canonPipelines(rows));
});

export const activePreset = computed(() => {
  const reading = readings.value?.fields.active_preset;
  return reading && "readonly" in reading && typeof reading.value === "string" ? reading.value : null;
});

/** @param {FormField[] | undefined} fields @returns {Record<string, FormField>} */
const byName = (fields) => Object.fromEntries((fields ?? []).map((item) => [item.name, item]));

export const configByName = computed(() => byName(config.value?.fields));
export const matrixByName = computed(() => byName(matrixConfig.value?.fields));
