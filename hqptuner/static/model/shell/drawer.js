// What a stage drawer decides, free of the DOM: the apply group's state, and whether the drawer or its family holds
// staged edits.

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
