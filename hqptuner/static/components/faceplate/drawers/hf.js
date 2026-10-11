// The HF filter drawer's schema: the high-frequency filter with every option's line under it, live; the auto-pilot
// switch, a local control over the backend's own flag that writes at once, shown while the advisor is offered and
// grayed while metering is off (store/schema/local.js); and pre-process
// before metering, which stages for a restart and so carries the drawer's dot.

import { local } from "../../../store/schema/local.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

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
        { field: local.autopilot },
        { row: { key: "pre_before_meter" } },
      ],
    },
  ],
};
