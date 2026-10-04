// Settings: the gear swaps the body (rail + page + drawers) for this. Header, engine row and Setting Switcher stay.
// Rail = the categories, in the signal chain's stage grammar (engraved name, readouts, left selection bar) but no wire and no
// lamps: settings aren't signal flow, and lamps mean "engaged" on the chain. Each entry opens its drawer (drawers open
// only from the rail); the page under them is About + About HQPTuner (read-only, so a page, not a drawer).
//
// Strings: v1 data/settings.json (manual §4 / §4.2 / §4.7, readme §1.2 / §1.15, verbatim), v1 store/schema labels,
// v1 SystemTab.js / SystemHardware.js / LogTail.js / gray.js (owner copy), 6.0.4 config-form options.
// Lanes (v1 docs/settings-classification.md): one file per category in this directory names its own.

import { TIMING_DRAWER } from "./timing.js";
import { HARDWARE_DRAWER } from "./hardware.js";
import { UPNP_DRAWER } from "./upnp.js";
import { LOGGING_DRAWER } from "./logging.js";
import { BEHAVIOR_DRAWER } from "./behavior.js";
import { VISUAL_DRAWER } from "./visual.js";
import { SIGPATH_DRAWER } from "./sigpath.js";

// Rail: one entry per drawer, its settings as readouts (label | value), named as in the drawer. `wide` = value on its own
// line (a path). Values print the control's own option label.
export const SETTINGS_RAIL = [
  { id: "timing", name: "Timing", drawer: TIMING_DRAWER, show: ["idle", "qpause", "sbuf"] },
  {
    id: "hardware",
    name: "Hardware acceleration",
    drawer: HARDWARE_DRAWER,
    show: ["multicore", "ecores", "nblocks", "cuda"],
  },
  { id: "upnp", name: "UPnP", drawer: UPNP_DRAWER, show: ["freewheel"] },
  { id: "logging", name: "Logging", drawer: LOGGING_DRAWER, show: ["logon", "logpath"] },
  { id: "behavior", name: "Behavior", drawer: BEHAVIOR_DRAWER, show: ["pinallow"] },
  {
    id: "visual",
    name: "Visual settings",
    drawer: VISUAL_DRAWER,
    show: ["vdesc", "vopt", "vstyle", "vapod", "vdys", "vacc", "vfill", "vbottom", "vhide"],
  },
  // Readout: the path playing now (main.js `sigpath`), not a setting.
  { id: "sigpath", name: "Signal path", drawer: SIGPATH_DRAWER, show: [], live: "Playing" },
];

// Rail readout labels where the drawer row label is long (same words, the drawer's own).
export const READOUT_LABEL = { vhide: "Hidden", logpath: "Log path", cudadev: "DSP", cudacdev: "Convolution" };
