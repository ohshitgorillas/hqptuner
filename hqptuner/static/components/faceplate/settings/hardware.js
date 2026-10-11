// The Hardware acceleration drawer's schema and its Settings rail readouts. Multicore DSP, E-core allocation and CUDA
// offload are the catalog's rows (`multicore`, `ecores`, `cuda`, store/schema/hardware.js), and their readouts name and
// list what each entry does. The settings are engine attributes held by store/faceplate/settings/hardware.js, never in
// the staged set: the engine's own POST restarts the daemon, so the apply group runs that form (`own`). The block count
// and the CUDA devices are blocks the caller mounts by name. The all-stations switch sits at the foot of both tabs over
// one value, a local control under each tab's id (store/schema/local.js).

import { applyHardware, discardHardware, hardwareDraft, staged } from "../../../store/faceplate/settings/hardware.js";
import { local } from "../../../store/schema/local.js";
import { schema } from "../../../store/schema.js";
import { seg } from "./readouts.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/settings/rail.js").SettingsReadout} SettingsReadout */
/** @typedef {import("../../../store/faceplate/settings/hardware.js").HardwareKey} HardwareKey */
/** @typedef {import("../../../model/shell/settings.js").Control} Control */

/** @type {DrawerSchema} */
export const HARDWARE_DRAWER = {
  id: "hardware",
  title: "Hardware acceleration",
  aria: "Hardware acceleration settings",
  tabs: [
    {
      id: "cpu",
      label: "CPU",
      body: [
        { row: { key: "multicore" } },
        { row: { key: "ecores" } },
        { block: "nblocks" },
        { field: local.hwallcpu },
      ],
    },
    {
      id: "gpu",
      label: "GPU",
      body: [{ row: { key: "cuda" } }, { block: "cudadevs" }, { field: local.hwallgpu }],
    },
  ],
  own: { staged: () => staged.value, apply: applyHardware, discard: discardHardware },
};

/**
 * A readout of the engine's value for one attribute, as the daemon last reported or verified it.
 *
 * @param {HardwareKey} key
 * @param {string} label
 * @param {Control} control
 * @returns {SettingsReadout}
 */
const readout = (key, label, control) => ({ id: key, label, control, value: () => hardwareDraft().base[key] });

/**
 * A readout of one catalog entry's engine attribute: its label and its options as a seg are the entry's.
 *
 * @param {HardwareKey} key
 * @returns {SettingsReadout}
 */
const catalogReadout = (key) => readout(key, schema[key].label, seg(schema[key].options ?? []));

/** The rail readouts, in the drawer's order. @type {SettingsReadout[]} */
export const HARDWARE_READOUTS = [
  catalogReadout("multicore"),
  catalogReadout("ecores"),
  readout("nblocks", "Blocks per cycle", { type: "slider", auto: { v: 0 } }),
  catalogReadout("cuda"),
];
