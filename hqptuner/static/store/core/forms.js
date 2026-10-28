// One draft for an engine form: the form as read, the user's edits, and the apply that writes them.

import { batch, computed, effect, signal, untracked } from "@preact/signals";
import { draftDiffers, retainDraftEdits } from "../../model/store/draft.js";
import { duringEngineWrite } from "../enginewrite.js";
import { generation } from "../signals.js";
import { FAILED, STALE, latest, op } from "./ops.js";

/** @typedef {import("./ops.js").Area} Area */

/**
 * @typedef {object} FormDraft
 * @property {{ readonly value: Record<string, unknown> | null }} base
 * @property {{ readonly value: Record<string, unknown> }} values
 * @property {(key: string, v: unknown) => void} set
 * @property {(key: string) => void} remove
 * @property {{ readonly value: string[] }} differs
 * @property {() => Promise<boolean>} apply  resolves to whether the write landed, whatever its readback did
 * @property {() => Promise<void>} reload
 * @property {() => void} discard
 * @property {{ readonly value: boolean }} busy
 * @property {{ readonly value: unknown }} error
 * @property {{ readonly value: boolean }} stale
 */

/**
 * The form as last read. A read reports only through `stale`: it never touches the draft's error or its alert area,
 * and a failed one leaves the last reading in place. Only the newest read started speaks: one a later read
 * superseded leaves `base` and `stale` alone, however it ends. `landed` runs in the same batch as each reading that
 * lands.
 *
 * @param {() => Promise<Record<string, unknown>>} load
 * @param {Area} area
 * @param {() => void} landed
 */
function formReading(load, area, landed) {
  const base = signal(/** @type {Record<string, unknown> | null} */ (null));
  const stale = signal(false);
  const reads = op(area, { alert: null });
  const newest = latest();
  const read = async () => {
    const reading = await newest(reads.run(load));
    if (reading === STALE) return;
    if (reading === FAILED) {
      stale.value = true;
      return;
    }
    batch(() => {
      base.value = reading;
      stale.value = false;
      landed();
    });
  };
  return { base, stale, read };
}

/** The failure an engine form's write reports when the daemon does not confirm the apply. */
export const UNCONFIRMED = "applied, but the daemon did not confirm the new values";

/**
 * A draft for one engine form, loaded and written through the given functions. It reads once as it is made, unless `eager` is false: then its first read waits for a `reload` or a generation bump.
 *
 * @param {{ load: () => Promise<Record<string, unknown>>, write: (values: Record<string, unknown>) => Promise<unknown>, keys: string[], area: Area, eager?: boolean }} spec
 * @returns {FormDraft}
 */
export function formDraft({ load, write, keys, area, eager = true }) {
  const values = signal(/** @type {Record<string, unknown>} */ ({}));
  /** The edits a landed write sent, until the first reading after it lands. @type {Record<string, unknown> | null} */
  let sent = null;
  const { base, stale, read } = formReading(load, area, () => {
    if (sent === null) return;
    values.value = retainDraftEdits(sent, values.peek());
    sent = null;
  });
  const operation = op(area, { engine: true });
  const differs = computed(() => (base.value === null ? [] : draftDiffers(base.value, values.value, keys)));
  let reading = eager;
  effect(() => {
    generation.value;
    if (reading) untracked(() => void read());
    reading = true;
  });
  const apply = async () => {
    if (base.peek() === null) return false;
    const submitted = structuredClone(values.peek());
    const outcome = await operation.run(async () => {
      await duringEngineWrite(async () => {
        await write(submitted);
        stale.value = true;
        sent = submitted;
      });
      await read();
    });
    return outcome !== FAILED;
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
    reload: read,
    discard: () => {
      values.value = {};
    },
    busy: operation.busy,
    error: operation.error,
    stale,
  };
}
