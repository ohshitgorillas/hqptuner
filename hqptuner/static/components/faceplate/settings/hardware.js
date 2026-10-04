// The Hardware acceleration drawer's schema and its Settings rail readouts. The settings are engine attributes held by
// store/faceplate/settings/hardware.js, never in the staged set: the engine's own POST restarts the daemon, so the
// apply group runs that form (`own`). The block count and the CUDA devices are blocks the caller mounts by name. The
// all-stations switch sits at the foot of both tabs over one value. Strings verbatim from
// mockup/scripts/data/settings/hardware.js.

import {
  allStations,
  applyHardware,
  discardHardware,
  hardwareDraft,
  setAllStations,
  setHardware,
  staged,
} from "../../../store/faceplate/settings/hardware.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/drawer.js").FieldOption} FieldOption */
/** @typedef {import("../../../store/faceplate/drawer.js").FieldSpec} FieldSpec */
/** @typedef {import("../../../store/faceplate/settings/rail.js").SettingsReadout} SettingsReadout */
/** @typedef {import("../../../store/faceplate/settings/hardware.js").HardwareKey} HardwareKey */
/** @typedef {import("../../../model/shell/settings.js").Control} Control */

/** The settings' paragraphs (mockup hardware.js MAN). */
const MAN = {
  cuda: 'Utilizes an NVIDIA GPU to partially offload processing from the CPU to the GPU. CUDA offload requires an NVIDIA GPU with a minimum Compute Capability level of 5.2, 2 GB of graphics RAM, and the latest official NVIDIA drivers. When CUDA offload is enabled, Multicore DSP should also be enabled, or left at the automatic setting, to achieve the best performance. With "convolution only", only convolution algorithms are offloaded to the GPU.',
  multicore:
    'Multicore DSP increases parallelization of various DSP operations. With "auto", automatic detection and configuration is active and can utilize any number of cores. For best performance, it is recommended to use the auto-detection. When disabled, processing is optimized for cases where the number of cores is equal to or less than the number of output channels, such as dual-core CPUs when output is stereo. When enabled, processing is optimized for modern multi-core CPUs with a much higher core count than the number of output channels. Since this parallelization increases processing overhead, it will increase total CPU time consumption. If there are performance problems with the "auto" setting, it is typically useful to try this option.',
  ecores:
    "On newer CPUs that have both performance and efficiency cores, efficiency cores can be allocated as offload processors instead of normal (default) use. These e-cores can be allocated either for processing resampling filters, or for a generic DSP pool for performing other tasks such as convolution.",
};

/** @type {FieldOption[]} */
const MULTICORE = [
  { value: "auto", label: "Auto" },
  { value: "1", label: "Enabled" },
  { value: "0", label: "Disabled" },
];

/** @type {FieldOption[]} */
const ECORES = [
  { value: "default", label: "Disabled" },
  { value: "pool", label: "DSP pool" },
  { value: "filter", label: "Resampling" },
];

/** @type {FieldOption[]} */
const CUDA = [
  { value: "0", label: "Disabled" },
  { value: "1", label: "Full offload" },
  { value: "convolution", label: "Convolution only" },
];

/** @type {FieldOption[]} */
const OFF_ON = [
  { value: "0", label: "Off" },
  { value: "1", label: "On" },
];

/**
 * A field over one drafted engine attribute.
 *
 * @param {HardwareKey} key
 * @param {string} label
 * @param {string} man
 * @param {FieldOption[]} options
 * @returns {{ field: FieldSpec }}
 */
const draftField = (key, label, man, options) => ({
  field: {
    id: key,
    label,
    man: [man],
    options,
    value: () => hardwareDraft().values[key],
    set: (v) => setHardware(key, v),
  },
});

/**
 * The all-stations switch under its tab's id: where the next apply lands, never an edit.
 *
 * @param {string} id
 * @returns {{ field: FieldSpec }}
 */
const allStationsField = (id) => ({
  field: {
    id,
    label: "Apply to all stations",
    man: [],
    options: OFF_ON,
    value: () => (allStations.value ? "1" : "0"),
    set: (v) => setAllStations(v === "1"),
  },
});

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
        draftField("multicore", "Multicore DSP", MAN.multicore, MULTICORE),
        draftField("ecores", "E-core allocation", MAN.ecores, ECORES),
        { block: "nblocks" },
        allStationsField("hwallcpu"),
      ],
    },
    {
      id: "gpu",
      label: "GPU",
      body: [draftField("cuda", "CUDA offload", MAN.cuda, CUDA), { block: "cudadevs" }, allStationsField("hwallgpu")],
    },
  ],
  own: { staged: () => staged.value, apply: applyHardware, discard: discardHardware },
};

/**
 * A seg readout's control over a field's options.
 *
 * @param {FieldOption[]} options
 * @returns {Control}
 */
const seg = (options) => ({ type: "seg", options: options.map((o) => ({ v: o.value, label: o.label })) });

/**
 * A readout of the engine's value for one attribute, as the daemon last reported or verified it.
 *
 * @param {HardwareKey} key
 * @param {string} label
 * @param {Control} control
 * @returns {SettingsReadout}
 */
const readout = (key, label, control) => ({ id: key, label, control, value: () => hardwareDraft().base[key] });

/** The rail readouts, in the drawer's order (mockup settings/rail.js `show`). @type {SettingsReadout[]} */
export const HARDWARE_READOUTS = [
  readout("multicore", "Multicore DSP", seg(MULTICORE)),
  readout("ecores", "E-core allocation", seg(ECORES)),
  readout("nblocks", "Blocks per cycle", { type: "slider", auto: { v: 0 } }),
  readout("cuda", "CUDA offload", seg(CUDA)),
];
