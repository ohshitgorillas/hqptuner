// What a stage drawer decides, free of the DOM: staged against applied values, gray reasons and their links, the
// apply group's state, what Apply commits across a drawer family and what Discard puts back. components/drawer.js
// executes these decisions on its elements.

/** @typedef {Record<string, unknown>} Values */
/** @typedef {{ gray: (vals: Values) => string }} Grayable */
/** @typedef {{ text: string, link: boolean }} Reason */
/** @typedef {{ off: boolean[], reasons: Reason[] }} RowGray */
/** @typedef {{ restart?: unknown }} Restartable */
/** @typedef {{ row?: Restartable, rows?: Restartable[], [k: string]: unknown }} Item */

/**
 * The start values a mount adds to the applied store: each current value the store does not hold yet (a family: each
 * member adds its own).
 *
 * @param {Values} vals
 * @param {Values} base
 * @returns {Values}
 */
export const startValues = (vals, base) => Object.fromEntries(Object.entries(vals).filter(([k]) => !(k in base)));

/**
 * One control's edit: the value it records, the applied value it writes (a live row applies at once, so nothing is left
 * to discard) and whether it stages (marks its row dirty).
 *
 * @param {string} id
 * @param {unknown} v
 * @param {unknown} live
 * @returns {{ vals: Values, base: Values, dirty: boolean }}
 */
export const editOf = (id, v, live) => ({ vals: { [id]: v }, base: live ? { [id]: v } : {}, dirty: !live });

/**
 * The ids, in order, whose current value differs from the applied one (a value with no applied one differs).
 *
 * @param {Iterable<string>} ids
 * @param {Values} vals
 * @param {Values} base
 * @returns {string[]}
 */
export const dirtyIds = (ids, vals, base) => [...ids].filter((id) => vals[id] !== base[id]);

/**
 * One row's reason lines from its controls' reasons: each non-blank one once, in control order.
 *
 * @param {string[]} whys
 * @returns {string[]}
 */
function distinctReasons(whys) {
  /** @type {string[]} */
  const out = [];
  for (const why of whys) if (why.trim() && !out.includes(why)) out.push(why);
  return out;
}

/**
 * Every gray-able row read against the current values: which controls are off (any reason, a blank one included) and
 * which reason lines print. A reason that names its fix elsewhere links there once per drawer, on the first row showing
 * it; with `linkable` false (a second mount) nothing links.
 *
 * @param {Grayable[][]} rows  each row's gray-able controls
 * @param {Values} vals
 * @param {boolean} linkable
 * @param {(text: string) => boolean} hasXref
 * @returns {RowGray[]}
 */
export function regray(rows, vals, linkable, hasXref) {
  /** @type {Set<string>} */
  const linked = new Set();
  return rows.map((ctls) => {
    const whys = ctls.map((c) => c.gray(vals));
    const reasons = distinctReasons(whys).map((text) => {
      const link = linkable && !linked.has(text);
      if (link && hasXref(text)) linked.add(text);
      return { text, link };
    });
    return { off: whys.map((why) => !!why), reasons };
  });
}

/**
 * Does this tab hold a restart-lane setting: every tab of a restart schema, a restart tab, or a tab with a restart row,
 * lone or in a group.
 *
 * @param {Restartable} schema
 * @param {Restartable & { body: Item[] }} tab
 * @returns {boolean}
 */
export const restarts = (schema, tab) =>
  !!(schema.restart || tab.restart || tab.body.some((it) => it.row?.restart || it.rows?.some((r) => r.restart)));

/**
 * The apply group's state: it shows on a restart tab or with staged edits; its buttons are live only with staged edits.
 *
 * @param {boolean} restart
 * @param {boolean} staged
 * @returns {{ shown: boolean, live: boolean }}
 */
export const applyPaint = (restart, staged) => ({ shown: restart || staged, live: staged });

/**
 * Does the drawer hold staged edits: its own, or any family member's.
 *
 * @param {boolean} own
 * @param {{ hasDirty: () => boolean }[]} members
 * @returns {boolean}
 */
export const isStaged = (own, members) => own || members.some((d) => d.hasDirty());

/**
 * The drawers one Apply or Discard reaches: every member of the family, else the drawer alone.
 *
 * @template T
 * @param {{ members: T[] } | null} fam
 * @param {T} self
 * @returns {T[]}
 */
export const applyTargets = (fam, self) => (fam ? fam.members : [self]);

/**
 * The applied values after Apply: every staged value takes effect over the last applied ones.
 *
 * @param {Values} vals
 * @param {Values} base
 * @returns {Values}
 */
export const commit = (vals, base) => ({ ...base, ...vals });

/**
 * What Discard puts a control back to: {id: its applied value}, or nothing when it already holds it or has none.
 *
 * @param {string} id
 * @param {Values} vals
 * @param {Values} base
 * @returns {Values}
 */
export const restoreOf = (id, vals, base) => (vals[id] === base[id] || !(id in base) ? {} : { [id]: base[id] });

/**
 * The values Discard puts back for a block's own ids: each one that has an applied value.
 *
 * @param {Iterable<string>} ids
 * @param {Values} base
 * @returns {Values}
 */
export const blockRestore = (ids, base) => Object.fromEntries([...ids].filter((id) => id in base).map((id) => [id, base[id]]));
