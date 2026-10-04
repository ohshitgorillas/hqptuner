// Drawer schemas read free of the DOM. A schema's tabs hold body items; an item is a lone row ({row}), a backend's
// rows ({group, rows}), or something that holds no row (an intro, a block).

/**
 * @template R
 * @typedef {{ row?: R, group?: string, rows?: R[], [k: string]: unknown }} Item
 */

/**
 * @template R
 * @typedef {{ tabs: { body: Item<R>[] }[] }} Drawer
 */

/**
 * Every row in a drawer, tab by tab in body order, a group's rows in its place.
 *
 * @template R
 * @param {Drawer<R>} drawer
 * @returns {R[]}
 */
export const rowsOf = (drawer) => drawer.tabs.flatMap((t) => t.body.flatMap((it) => (it.row ? [it.row] : (it.rows ?? []))));

/**
 * The first row labelled `label`: inside the rows of `group` when one is named, else among the rows outside every
 * group. Null when there is none.
 *
 * @template {{ label?: string }} R
 * @param {Drawer<R>} drawer
 * @param {string} label
 * @param {string} [group]
 * @returns {R | null}
 */
export function rowOf(drawer, label, group) {
  const items = drawer.tabs.flatMap((t) => t.body);
  const pool = group
    ? items.flatMap((it) => (it.group === group ? (it.rows ?? []) : []))
    : items.flatMap((it) => (it.row ? [it.row] : []));
  return pool.find((r) => r.label === label) ?? null;
}
