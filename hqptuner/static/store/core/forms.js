// One draft for an engine form: the form as read, the user's edits, and the apply that writes them.

import { computed, signal } from "@preact/signals";

/** @typedef {import("./ops.js").Area} Area */

/**
 * @typedef {object} FormDraft
 * @property {{ readonly value: Record<string, unknown> | null }} base
 * @property {{ readonly value: Record<string, unknown> }} values
 * @property {(key: string, v: unknown) => void} set
 * @property {{ readonly value: string[] }} differs
 * @property {() => Promise<void>} apply
 * @property {() => void} discard
 * @property {{ readonly value: boolean }} busy
 * @property {{ readonly value: unknown }} error
 */

/**
 * A draft for one engine form, loaded and written through the given functions.
 *
 * @param {{ load: () => Promise<Record<string, unknown>>, write: (values: Record<string, unknown>) => Promise<unknown>, keys: string[], area: Area }} _spec
 * @returns {FormDraft}
 */
export const formDraft = (_spec) => ({
  base: signal(null),
  values: signal({}),
  set: () => {},
  differs: computed(() => []),
  apply: async () => {},
  discard: () => {},
  busy: signal(false),
  error: signal(null),
});
