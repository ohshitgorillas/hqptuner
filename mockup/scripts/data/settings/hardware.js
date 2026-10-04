// Hardware acceleration: file restore (<engine> element, ~5.6 s restart): cuda, cuda_dev, cuda_cdev, multicore, ecores,
// nblocks. Mock state: CUDA disabled, multicore auto, e-cores default, nblocks 0.

import { OFF_ON } from "./common.js";

const MAN = {
  cuda: 'Utilizes an NVIDIA GPU to partially offload processing from the CPU to the GPU. CUDA offload requires an NVIDIA GPU with a minimum Compute Capability level of 5.2, 2 GB of graphics RAM, and the latest official NVIDIA drivers. When CUDA offload is enabled, Multicore DSP should also be enabled, or left at the automatic setting, to achieve the best performance. With "convolution only", only convolution algorithms are offloaded to the GPU.',
  cudaDevs:
    "Which GPU handles each offload class: one device for filters and general DSP, another for convolution and other large operations. Setting them to different GPUs splits the workload across two cards. −1 selects automatically.",
  multicore:
    'Multicore DSP increases parallelization of various DSP operations. With "auto", automatic detection and configuration is active and can utilize any number of cores. For best performance, it is recommended to use the auto-detection. When disabled, processing is optimized for cases where the number of cores is equal to or less than the number of output channels, such as dual-core CPUs when output is stereo. When enabled, processing is optimized for modern multi-core CPUs with a much higher core count than the number of output channels. Since this parallelization increases processing overhead, it will increase total CPU time consumption. If there are performance problems with the "auto" setting, it is typically useful to try this option.',
  ecores:
    "On newer CPUs that have both performance and efficiency cores, efficiency cores can be allocated as offload processors instead of normal (default) use. These e-cores can be allocated either for processing resampling filters, or for a generic DSP pool for performing other tasks such as convolution.",
  nblocks:
    "Number of blocks to process at once. This setting can be used to fine tune CPU/GPU load to the lowest possible figure. When set to the default (0), the value is auto-configured based on the detected amount of CPU cache etc. Processing more blocks at once reduces overhead, especially when a GPU is used, while processing fewer blocks at once helps keep most of the data in CPU cache. Higher values are better suited for processors with a large cache, such as AMD 3D-series and some Intel Xeon models, or systems with high speed RAM, while smaller values are better suited for CPUs with a small cache, or systems with slower RAM.",
};

// Gray reasons. CUDA devices: v1 disables both boxes while offload is off (no copy: blank reason grays without a line) and
// the DSP box under convolution-only (v1 copy).
const CONV_ONLY = "Convolution-only offload uses the convolution device only.";

// Apply to all stations: v1's `Apply to all presets` (SystemHardware.js, no copy of its own; `presets` →
// `stations`). Not a daemon setting: it widens the next Apply, so it never stages (live). Foot of both tabs, one value
// (MIRROR keeps the two in step).
/**
 * @param {string} id
 * @returns {import('../stages/output.js').Item}
 */
const allStations = (id) => ({
  row: {
    label: "Apply to all stations",
    live: true,
    man: "",
    control: { type: "seg", id, aria: "Apply to all stations", value: "0", options: OFF_ON },
  },
});
export const MIRROR = { hwallcpu: "hwallgpu", hwallgpu: "hwallcpu" };

/** @type {import('../stages/output.js').DrawerSchema} */
export const HARDWARE_DRAWER = {
  id: "hardware",
  title: "Hardware acceleration",
  aria: "Hardware acceleration settings",
  restart: true,
  // Two tabs, CPU | GPU, because one panel does not fit at 1080×810: CPU holds Multicore DSP, E-core allocation and
  // Blocks per cycle; GPU holds CUDA offload and its devices.
  tabs: [
    {
      id: "cpu",
      label: "CPU",
      body: [
        {
          row: {
            label: "Multicore DSP",
            man: MAN.multicore,
            control: {
              type: "seg",
              id: "multicore",
              aria: "Multicore DSP",
              value: "auto",
              options: [
                { v: "auto", label: "Auto" },
                { v: "1", label: "Enabled" },
                { v: "0", label: "Disabled" },
              ],
            },
          },
        },
        {
          row: {
            label: "E-core allocation",
            man: MAN.ecores,
            control: {
              type: "seg",
              id: "ecores",
              aria: "E-core allocation",
              value: "default",
              options: [
                { v: "default", label: "Disabled" },
                { v: "pool", label: "DSP pool" },
                { v: "filter", label: "Resampling" },
              ],
            },
          },
        },
        // v1 BlocksPerCycleField (a slider again): `Set manually` → slider 1–16 (starts at 8);
        // off → 0, the daemon's auto-configuration, with v1's line.
        {
          row: {
            label: "Blocks per cycle",
            man: MAN.nblocks,
            control: {
              type: "slider",
              id: "nblocks",
              value: 0,
              min: 1,
              max: 16,
              step: 1,
              aria: "Blocks per cycle",
              auto: { v: 0, manual: 8, label: "Set manually", note: "Automatic — chosen from CPU cache size" },
            },
          },
        },
        allStations("hwallcpu"),
      ],
    },
    {
      id: "gpu",
      label: "GPU",
      body: [
        {
          row: {
            label: "CUDA offload",
            man: MAN.cuda,
            control: {
              type: "seg",
              id: "cuda",
              aria: "CUDA offload",
              value: "0",
              options: [
                { v: "0", label: "Disabled" },
                { v: "1", label: "Full offload" },
                { v: "convolution", label: "Convolution only" },
              ],
            },
          },
        },
        {
          row: {
            label: "CUDA devices",
            man: MAN.cudaDevs,
            control: {
              type: "group",
              items: [
                {
                  type: "number",
                  id: "cudadev",
                  label: "DSP",
                  value: -1,
                  min: -1,
                  max: 15,
                  aria: "CUDA device for DSP",
                  gray: (v) => (v.cuda === "0" ? " " : v.cuda === "convolution" ? CONV_ONLY : ""),
                },
                {
                  type: "number",
                  id: "cudacdev",
                  label: "Convolution",
                  value: -1,
                  min: -1,
                  max: 15,
                  hint: "−1 = automatic",
                  aria: "CUDA device for convolution",
                  gray: (v) => (v.cuda === "0" ? " " : ""),
                },
              ],
            },
          },
        },
        allStations("hwallgpu"),
      ],
    },
  ],
};
