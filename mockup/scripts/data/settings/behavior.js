import { OFF_ON } from "./common.js";

const MAN = {
  pinRates:
    "Adds the capacity to pin a specific output rate without restarting the engine. Note: this will cause certain filters (integer- or 2x-upsampling only) to produce no output when mixing rate families! That is, certain filters cannot produce output with, e.g., a pinned 44.1k-family output rate and 48k-family source material.", // owner copy
};

// Behavior: HQPTuner prefs, apply at once, never stage. No Auto-save and no Live / Stage: Apply writes the station and
// restarts, as the daemon's own config write does, so there is no applied-but-unsaved state to close, and live settings
// never touch the station (snapshots keep a live state), so there is nothing to hold.
/** @type {import('../stages/output.js').DrawerSchema} */
export const BEHAVIOR_DRAWER = {
  id: "behavior",
  title: "Behavior",
  aria: "Behavior settings",
  restart: false,
  tabs: [
    {
      id: "behavior",
      label: "Behavior",
      body: [
        // Opt-in for the page's rate pins: the Output section exists only while On. HQPTuner pref, live.
        {
          row: {
            label: "Allow pinned rates",
            live: true,
            man: MAN.pinRates,
            control: { type: "seg", id: "pinallow", aria: "Allow pinned rates", value: "0", options: OFF_ON },
          },
        },
      ],
    },
  ],
};
