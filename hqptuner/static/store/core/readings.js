// The one read surface: the served field readings, the playback summary and the engine status accessor.

import { computed, effect, signal, untracked } from "@preact/signals";
import { api } from "../../lib/api.js";
import { isBlank, num } from "../../lib/coerce.js";
import { fieldOf } from "../../model/store/reading.js";
import { engineState, engineStatus, generation } from "../signals.js";
import { playbackPath, transportNow } from "../faceplate/path.js";
import { latest, op, STALE } from "./ops.js";

/** @typedef {import("../../model/store/reading.js").FieldReading} FieldReading */
/** @typedef {import("../../model/store/reading.js").FieldView} FieldView */
/** @typedef {{ value: unknown, readonly: true }} MetadataReading */
/** @typedef {{ generation: number, fields: Record<string, FieldReading | MetadataReading> }} ConfigReading */

export const readings = signal(/** @type {ConfigReading | null} */ (null));

/** @type {Map<string, { readonly value: FieldView }>} */
const fields = new Map();
/** @typedef {{ value: unknown } | null} HeldDrag */
/** @type {Map<string, { value: HeldDrag }>} */
const drags = new Map();

/** @param {string} key @returns {{ value: HeldDrag }} */
function dragFor(key) {
  const cached = drags.get(key);
  if (cached) return cached;
  const drag = signal(/** @type {HeldDrag} */ (null));
  drags.set(key, drag);
  return drag;
}

/**
 * The view of one field by key.
 *
 * @param {string} key
 * @returns {{ readonly value: FieldView }}
 */
export function field(key) {
  const cached = fields.get(key);
  if (cached) return cached;
  const drag = dragFor(key);
  const view = computed(() => {
    const reading = readings.value?.fields[key];
    return fieldOf(reading && "show" in reading ? reading : undefined, { drag: drag.value?.value }, generation.value);
  });
  fields.set(key, view);
  return view;
}

/**
 * Hold the page's own in-flight drag value and return its ownership-checked release.
 *
 * @param {string} key
 * @param {unknown} v
 * @returns {() => void}
 */
export const holdDrag = (key, v) => {
  const drag = dragFor(key);
  const held = { value: v };
  drag.value = held;
  return () => {
    if (drag.value === held) drag.value = null;
  };
};

/**
 * Release a field's held drag value.
 *
 * @param {string} key
 * @returns {void}
 */
export const dropDrag = (key) => {
  const drag = drags.get(key);
  if (drag) drag.value = null;
};

/** @param {unknown} value @returns {number | null} */
const rate = (value) => (isBlank(value) ? null : num(value, null));

/** @type {{ readonly value: { state: string | null, playing: boolean, path: string | null, chain: unknown, srcRate: number | null, outRate: number | null } }} */
export const playback = computed(() => {
  const state = transportNow();
  return {
    state,
    playing: state === "playing",
    path: playbackPath(),
    chain: engineState.value?.active_chain ?? null,
    srcRate: rate(engineStatus.value?.metadata?.samplerate),
    outRate: rate(status("active_rate")),
  };
});

/**
 * One named field of the engine's status.
 *
 * @param {string} name
 * @returns {unknown}
 */
export const status = (name) => engineStatus.value?.status?.[name] ?? null;

/** Create a refresher whose superseded callers wait for the adopted reading. */
function readingsRefresher() {
  const newest = latest();
  let current = Promise.resolve();
  return () => {
    const request = api.config().then(
      (body) => ({ body }),
      (error) => ({ error }),
    );
    const settled = newest(request).then(async (result) => {
      if (result === STALE) {
        await current;
        return;
      }
      if ("error" in result) throw result.error;
      readings.value = result.body;
    });
    current = settled;
    return settled;
  };
}

/** Refetch the served readings, adopting only the latest request. */
export const refreshReadings = readingsRefresher();

const refresh = op("readings", { alert: null });
let observedGeneration = generation.peek();
effect(() => {
  const next = generation.value;
  if (next === observedGeneration) return;
  observedGeneration = next;
  untracked(() => void refresh.run(refreshReadings));
});
