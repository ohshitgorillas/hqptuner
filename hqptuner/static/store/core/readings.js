// The one read surface: the served field readings, the playback summary and the engine status accessor.

import { computed, signal } from "@preact/signals";

/** @typedef {import("../../model/store/reading.js").FieldReading} FieldReading */
/** @typedef {import("../../model/store/reading.js").FieldView} FieldView */

/** The last GET /api/config body, replaced whole. @type {{ readonly value: { generation: number, fields: Record<string, FieldReading> } | null }} */
export const readings = signal(null);

/**
 * The view of one field by key.
 *
 * @param {string} _key
 * @returns {{ readonly value: FieldView }}
 */
export const field = (_key) =>
  computed(() => ({
    value: null,
    running: null,
    engine: null,
    file: null,
    staged: null,
    dirty: false,
    diverges: false,
    restart: false,
    bounds: null,
    unread: false,
    lane: null,
  }));

/**
 * Hold the page's own in-flight drag value for a field.
 *
 * @param {string} _key
 * @param {unknown} _v
 * @returns {void}
 */
export const holdDrag = (_key, _v) => {};

/**
 * Release a field's held drag value.
 *
 * @param {string} _key
 * @returns {void}
 */
export const dropDrag = (_key) => {};

/** @type {{ readonly value: { state: string | null, playing: boolean, path: string | null, chain: unknown, srcRate: number | null, outRate: number | null } }} */
export const playback = computed(() => ({
  state: null,
  playing: false,
  path: null,
  chain: null,
  srcRate: null,
  outRate: null,
}));

/**
 * One named field of the engine's status.
 *
 * @param {string} _name
 * @returns {unknown}
 */
export const status = (_name) => null;

/**
 * Refetch the served readings.
 *
 * @returns {Promise<void>}
 */
export const refreshReadings = async () => {};
