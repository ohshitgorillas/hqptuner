// One binding for a drawer control: what it shows, whether it is staged, and what a drag or pick writes.

/** @typedef {import("../../../model/store/drag.js").DragMode} DragMode */
/** @typedef {import("../../../model/store/reading.js").Bounds} Bounds */

/**
 * @typedef {object} Session
 * @property {(name: string, init: unknown) => unknown} get
 * @property {() => void} reset
 */

/**
 * @typedef {object} Control
 * @property {unknown} value
 * @property {boolean} dirty
 * @property {boolean} gray
 * @property {boolean} restart
 * @property {Bounds} bounds
 * @property {(v: unknown) => void} move
 * @property {(v: unknown) => void} drop
 * @property {(v: unknown) => void} pick
 */

/**
 * The binding of one drawer control to its field.
 *
 * @param {string} _key
 * @param {{ drag?: DragMode, session?: Session }} [_opts]
 * @returns {Control}
 */
export const control = (_key, _opts) => ({
  value: null,
  dirty: false,
  gray: false,
  restart: false,
  bounds: null,
  move: () => {},
  drop: () => {},
  pick: () => {},
});

/**
 * State scoped to one opening of one drawer stage.
 *
 * @param {string} _stage
 * @returns {Session}
 */
export const drawerSession = (_stage) => ({ get: () => null, reset: () => {} });
