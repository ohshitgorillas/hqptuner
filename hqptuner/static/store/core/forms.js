// One draft for an engine form: the form as read, the user's edits, and the apply that writes them.

import { computed, effect, signal, untracked } from "@preact/signals";
import { draftDiffers, retainDraftEdits } from "../../model/store/draft.js";
import { generation } from "../signals.js";
import { op } from "./ops.js";

/** @typedef {import("./ops.js").Area} Area */

/**
 * @typedef {object} FormDraft
 * @property {{ readonly value: Record<string, unknown> | null }} base
 * @property {{ readonly value: Record<string, unknown> }} values
 * @property {(key: string, v: unknown) => void} set
 * @property {(key: string) => void} remove
 * @property {{ readonly value: string[] }} differs
 * @property {() => Promise<void>} apply
 * @property {() => Promise<void>} reload
 * @property {() => void} discard
 * @property {{ readonly value: boolean }} busy
 * @property {{ readonly value: unknown }} error
 */

/**
 * A draft for one engine form, loaded and written through the given functions.
 *
 * @param {{ load: () => Promise<Record<string, unknown>>, write: (values: Record<string, unknown>) => Promise<unknown>, keys: string[], area: Area }} spec
 * @returns {FormDraft}
 */
export function formDraft({ load, write, keys, area }) {
  const base = signal(/** @type {Record<string, unknown> | null} */ (null));
  const values = signal(/** @type {Record<string, unknown>} */ ({}));
  const operation = op(area, { engine: true });
  const differs = computed(() => (base.value === null ? [] : draftDiffers(base.value, values.value, keys)));
  const reload = async () => {
    base.value = await load();
  };
  effect(() => {
    generation.value;
    untracked(() => void operation.run(reload, { engine: false }));
  });
  const apply = async () => {
    if (base.peek() === null) return;
    const submitted = structuredClone(values.peek());
    await operation.run(
      async () => {
        await write(submitted);
        base.value = null;
        await reload();
        values.value = retainDraftEdits(submitted, values.peek());
      },
      { engine: true },
    );
  };
  return {
    base,
    values,
    set: (key, value) => {
      values.value = { ...values.peek(), [key]: value };
    },
    remove: (key) => {
      const next = { ...values.peek() };
      delete next[key];
      values.value = next;
    },
    differs,
    apply,
    reload: async () => {
      await operation.run(reload, { engine: false });
    },
    discard: () => {
      values.value = {};
    },
    busy: operation.busy,
    error: operation.error,
  };
}
