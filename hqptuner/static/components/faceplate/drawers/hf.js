// The HF filter drawer's schema: the high-frequency filter with every option's line under it, live; the auto-pilot
// switch, a field over the backend's own flag that writes at once, shown while the advisor is offered and grayed while
// metering is off; and pre-process
// before metering, which stages for a restart and so carries the drawer's dot.

import { autopilot, metering, setAutopilot } from "../../../store/actions.js";
import { advisor } from "../../../store/signals.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

const AUTOPILOT_NOTE =
  "Automatically engages and disengages the high-frequency filter 20k to 50k settings as needed for hi-res content. Setting the filter manually disables this setting.";
const NO_METERING = "Metering is disabled; HQPTuner can't determine optimal settings.";

/** @type {DrawerSchema} */
export const HF_DRAWER = {
  id: "hf",
  title: "HF filter",
  aria: "HF filter settings",
  tabs: [
    {
      id: "hf",
      label: "HF filter",
      body: [
        { row: { key: "junk_filter", sub: "Playback filter", optMan: true } },
        {
          field: {
            id: "autopilot",
            label: "HF filter auto-pilot",
            man: [AUTOPILOT_NOTE],
            options: [
              { value: "0", label: "Off" },
              { value: "1", label: "On" },
            ],
            value: () => (autopilot.value ? "1" : "0"),
            set: (v) => setAutopilot(v === "1"),
            gray: () => (metering.value ? "" : NO_METERING),
            when: () => advisor.value,
          },
        },
        { row: { key: "pre_before_meter" } },
      ],
    },
  ],
};
