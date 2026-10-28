// Control catalog, the engine's hardware attributes. Assembled into `schema` by
// store/schema.js.
//
// The hardware catalog uses the engine's own form,
// never the config staging buffer: each key is the engine attribute of the same
// name, its value is the Hardware drawer's draft over what the engine reported,
// and the engine's own POST writes it.

import { CUDA, ECORES, MULTICORE } from "./options.js";

/** @type {Record<string, SchemaField>} */
export const hardware = {
  multicore: {
    label: "Multicore DSP",
    group: "system",
    note: "multicore_dsp",
    widget: "segment",
    options: MULTICORE,
  },
  ecores: {
    label: "E-core allocation",
    group: "system",
    note: "ecore_allocation",
    widget: "segment",
    options: ECORES,
  },
  cuda: {
    label: "CUDA offload",
    group: "system",
    note: "cuda_offload",
    widget: "segment",
    options: CUDA,
  },
};
