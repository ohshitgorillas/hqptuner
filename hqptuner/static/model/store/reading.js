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
 * A store as served while its own stamp is at or after the generation, else null.
 *
 * @template {EngineReading | FileReading} S
 * @param {S | undefined} store
 * @param {number} generation
 * @returns {S | null}
 */
const current = (store, generation) => (store && store.generation >= generation ? store : null);

/**
 * What a control shows: the held drag, else the staged edit, else the value of the store the reading names.
 *
 * @param {FieldReading | undefined} reading
 * @param {LocalValues} local
 * @returns {unknown}
 */
export const shownOf = (reading, local) => local.drag ?? local.staged ?? reading?.[reading.show]?.value ?? null;

/**
 * Whether the reading was taken at or after a generation, by the stamp of the store it shows.
 *
 * @param {FieldReading | undefined} reading
 * @param {number} generation
 * @returns {boolean}
 */
export const freshAt = (reading, generation) => current(reading?.[reading.show], generation) !== null;

/** @type {Pick<FieldView, "diverges" | "restart" | "bounds" | "lane">} */
const NO_MARKS = { diverges: false, restart: false, bounds: null, lane: null };

/**
 * The divergence, restart mark, bounds and lane the reading carries as served.
 *
 * @param {FieldReading | undefined} reading
 * @returns {Pick<FieldView, "diverges" | "restart" | "bounds" | "lane">}
 */
const servedMarks = (reading) =>
  reading
    ? { diverges: reading.diverges, restart: reading.restarts, bounds: reading.bounds, lane: reading.lane }
    : NO_MARKS;

/**
 * The view of one field: its reading composed with the page's own held values.
 *
 * @param {FieldReading | undefined} reading
 * @param {LocalValues} local
 * @param {number} generation
 * @returns {FieldView}
 */
export const fieldOf = (reading, local, generation) => {
  const engine = current(reading?.engine, generation);
  const file = current(reading?.file, generation);
  const staged = local.staged ?? reading?.staged ?? null;
  const stores = reading && { ...reading, engine, file };
  return {
    value: shownOf(stores, { drag: local.drag, staged }),
    running: shownOf(stores, {}),
    engine,
    file,
    staged,
    dirty: staged !== null,
    ...servedMarks(reading),
    unread: !freshAt(reading, generation),
  };
};
