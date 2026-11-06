// Served field readings for tests, and the one place a test sets a field's value.
import { readings } from "../../../hqptuner/static/store/core/readings.js";
import { generation } from "../../../hqptuner/static/store/signals.js";

/** @typedef {import("../../../hqptuner/static/model/store/reading.js").FieldReading} FieldReading */

/**
 * One served field reading (`model/store/reading.js` FieldReading) showing `value`: `engine` carries it unless `over.show` is "file", then `file` does; `lane` "form", `restarts` and `diverges` false, `staged` null, `bounds` null unless `over` sets them; stamped with `over.generation`, else the current `generation` of `store/signals.js`.
 *
 * @param {unknown} value
 * @param {Partial<FieldReading> & { generation?: number, name?: string }} [over]
 * @returns {FieldReading}
 */
export function fieldReading(value, over = {}) {
  const { generation: stamp = generation.value, name = String(value), ...rest } = over;
  const fromFile = rest.show === "file";
  return /** @type {FieldReading} */ ({
    engine: fromFile ? null : { value, name, generation: stamp },
    file: fromFile ? { value, generation: stamp } : null,
    staged: null,
    lane: "form",
    show: fromFile ? "file" : "engine",
    restarts: false,
    diverges: false,
    bounds: null,
    ...rest,
  });
}

/**
 * Whether `entry` is already a served reading: a FieldReading, or a read-only field's `{ value, readonly: true }`.
 *
 * @param {unknown} entry
 */
function served(entry) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
  return ("show" in entry && "lane" in entry) || ("readonly" in entry && entry.readonly === true);
}

/**
 * Set `readings.value` to `{ generation, fields }`; a plain value in `fields` becomes `fieldReading(value)`, a FieldReading is kept as given; `generation` defaults to the current `generation` of `store/signals.js`. The returned promise resolves once the readings are seeded.
 *
 * @param {Record<string, unknown>} fields
 * @param {number} [stamp]
 */
export async function seedReadings(fields, stamp = generation.value) {
  /** @type {Record<string, unknown>} */
  const entries = {};
  for (const [key, entry] of Object.entries(fields)) entries[key] = served(entry) ? entry : fieldReading(entry);
  readings.value = /** @type {typeof readings.value} */ ({ generation: stamp, fields: entries });
}
