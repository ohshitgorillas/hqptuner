// The Hardware acceleration drawer's two blocks over the hardware draft. Blocks per cycle: a `Set manually` box gating
// the slider, automatic (0, the daemon's own configuration) until ticked, which seeds 8. CUDA devices: the DSP and
// convolution device boxes, both grayed while CUDA offload is off and the DSP box alone under convolution-only. Copy
// verbatim from the mockup's hardware drawer (mockup/scripts/data/settings/hardware.js).

import { html } from "../../../lib/dom.js";
import { hardwareDraft, setHardware } from "../../../store/faceplate/settings/hardware.js";
import { grayLine, labelHead } from "../drawer/controls.js";
import { Slider } from "../drawers/crossfeed/Slider.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/xref.js").XrefHere} XrefHere */
/** @typedef {import("../../../store/faceplate/settings/hardware.js").HardwareKey} HardwareKey */
/** @typedef {{ currentTarget: { checked: boolean } }} CheckEv */
/** @typedef {{ currentTarget: { value: string } }} ChangeEv */
/** @typedef {{ schema: DrawerSchema, here: XrefHere }} BlockProps */

const MAN = {
  cudaDevs:
    "Which GPU handles each offload class: one device for filters and general DSP, another for convolution and other large operations. Setting them to different GPUs splits the workload across two cards. −1 selects automatically.",
  nblocks:
    "Number of blocks to process at once. This setting can be used to fine tune CPU/GPU load to the lowest possible figure. When set to the default (0), the value is auto-configured based on the detected amount of CPU cache etc. Processing more blocks at once reduces overhead, especially when a GPU is used, while processing fewer blocks at once helps keep most of the data in CPU cache. Higher values are better suited for processors with a large cache, such as AMD 3D-series and some Intel Xeon models, or systems with high speed RAM, while smaller values are better suited for CPUs with a small cache, or systems with slower RAM.",
};

const CONV_ONLY = "Convolution-only offload uses the convolution device only.";

const AUTO = "0";
const MANUAL_SEED = "8";

/** @param {number} v */
const setBlocks = (v) => setHardware("nblocks", String(v));

/** Blocks per cycle: the `Set manually` box, the slider it gates, and the automatic note while unticked. */
export function NblocksBlock() {
  const nblocks = hardwareDraft().values.nblocks;
  const auto = nblocks === AUTO;
  return html`
    <div class="drow" data-field="nblocks">
      <div class="ctl">
        <div class="slctl">
          <label class="chk">
            <input
              type="checkbox"
              checked=${!auto}
              onChange=${(/** @type {CheckEv} */ e) => setHardware("nblocks", e.currentTarget.checked ? MANUAL_SEED : AUTO)}
            />
            Set manually
          </label>
          <div class=${auto ? "grayed" : undefined}>
            <${Slider}
              label="Blocks per cycle"
              min=${1}
              max=${16}
              step=${1}
              unit=""
              dp=${0}
              value=${Number(auto ? MANUAL_SEED : nblocks)}
              disabled=${auto}
              onDrag=${setBlocks}
              onCommit=${setBlocks}
            />
          </div>
          ${auto ? html`<span class="gr">Automatic — chosen from CPU cache size</span>` : null}
        </div>
      </div>
      <div class="man"><p>${MAN.nblocks}</p></div>
    </div>
  `;
}

/**
 * One device box under its sublabel.
 *
 * @param {{ k: HardwareKey, sub: string, aria: string, off: boolean, hint?: string }} props
 */
function DeviceBox({ k, sub, aria, off, hint }) {
  return html`
    <label class="ci">
      <span class="cl">${sub}</span>
      <div class="num">
        <input
          type="number"
          class=${off ? "vfd grayed" : "vfd"}
          data-k=${k}
          aria-label=${aria}
          value=${hardwareDraft().values[k]}
          min=${-1}
          max=${15}
          step=${1}
          disabled=${off}
          onChange=${(/** @type {ChangeEv} */ e) => setHardware(k, e.currentTarget.value)}
        />
        ${hint ? html`<span class="h">${hint}</span>` : null}
      </div>
    </label>
  `;
}

/**
 * CUDA devices: the DSP and convolution boxes, and why the DSP box is gray under convolution-only.
 *
 * @param {BlockProps} props
 */
export function CudaDevicesBlock({ here }) {
  const cuda = hardwareDraft().values.cuda;
  const off = cuda === "0";
  const convOnly = cuda === "convolution";
  return html`
    <div class="drow" data-field="cudadevs">
      <div class="ctl">
        ${labelHead("CUDA devices")}
        <div class="cgrp">
          <${DeviceBox} k="cuda_dev" sub="DSP" aria="CUDA device for DSP" off=${off || convOnly} />
          <${DeviceBox}
            k="cuda_cdev"
            sub="Convolution"
            aria="CUDA device for convolution"
            off=${off}
            hint="−1 = automatic"
          />
        </div>
        ${grayLine(convOnly ? CONV_ONLY : "", here)}
      </div>
      <div class="man"><p>${MAN.cudaDevs}</p></div>
    </div>
  `;
}

/** The components the hardware drawer's block items mount, by name. */
export const HARDWARE_BLOCKS = { nblocks: NblocksBlock, cudadevs: CudaDevicesBlock };
