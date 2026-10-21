/**
 * @typedef {{ value: unknown, name?: string, generation: number } | null} EngineReading
 * @typedef {{ value: unknown, generation: number } | null} FileReading
 * @typedef {{ min: number, max: number, step: number } | null} Bounds
 * @typedef {object} FieldReading
 * @property {EngineReading} engine
 * @property {FileReading} file
 * @property {unknown} staged
 * @property {"live" | "restore" | "form" | "matrix" | "volume"} lane
 * @property {"engine" | "file"} show
 * @property {boolean} restarts
 * @property {boolean} diverges
 * @property {Bounds} bounds
 * @typedef {{ drag?: unknown, staged?: unknown }} LocalValues
 * @typedef {object} FieldView
 * @property {unknown} value
 * @property {unknown} running
 * @property {EngineReading} engine
 * @property {FileReading} file
 * @property {unknown} staged
 * @property {boolean} dirty
 * @property {boolean} diverges
 * @property {boolean} restart
 * @property {Bounds} bounds
 * @property {boolean} unread
 * @property {FieldReading["lane"] | null} lane
 */

/**
 * What a control shows: the held drag, else the staged edit, else the value of the store the reading names.
 *
 * @param {FieldReading | undefined} _reading
 * @param {LocalValues} _local
 * @returns {unknown}
 */
export const shownOf = (_reading, _local) => null;

/**
 * Whether the reading was taken at or after a generation.
 *
 * @param {FieldReading | undefined} _reading
 * @param {number} _generation
 * @returns {boolean}
 */
export const freshAt = (_reading, _generation) => false;

/**
 * The view of one field: its reading composed with the page's own held values.
 *
 * @param {FieldReading | undefined} _reading
 * @param {LocalValues} _local
 * @param {number} _generation
 * @returns {FieldView}
 */
export const fieldOf = (_reading, _local, _generation) => ({
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
});
