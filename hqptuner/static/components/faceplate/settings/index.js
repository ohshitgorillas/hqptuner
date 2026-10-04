// The Settings categories in rail order: each category's drawer schema, the components its blocks mount, and the
// readouts its rail entry prints.

import { registerDrawer } from "../../../store/faceplate/drawer.js";
import {
  BEHAVIOR_DRAWER,
  BEHAVIOR_READOUTS,
  TIMING_DRAWER,
  TIMING_READOUTS,
  UPNP_DRAWER,
  UPNP_READOUTS,
} from "./engine-rows.js";
import { HARDWARE_DRAWER, HARDWARE_READOUTS } from "./hardware.js";
import { HARDWARE_BLOCKS } from "./HardwareBlocks.js";
import { LOGGING_DRAWER, LOGGING_READOUTS } from "./logging.js";
import { LOGTAIL_BLOCKS } from "./LogTail.js";
import { VISUAL_DRAWER, VISUAL_READOUTS } from "./visual.js";
import { VISUAL_BLOCKS } from "./VisualBlocks.js";
import { SIGPATH_BLOCKS, SIGPATH_DRAWER, SIGPATH_LIVE } from "./SignalPath.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../drawer/Rows.js").Blocks} Blocks */
/** @typedef {import("../../../store/faceplate/settings/rail.js").SettingsCategory} SettingsCategory */
/** @typedef {SettingsCategory & { schema: DrawerSchema, blocks: Blocks }} SettingsDrawer */

/** @type {readonly SettingsDrawer[]} */
export const CATEGORIES = [
  { id: "timing", name: "Timing", schema: TIMING_DRAWER, blocks: {}, readouts: TIMING_READOUTS },
  {
    id: "hardware",
    name: "Hardware acceleration",
    schema: HARDWARE_DRAWER,
    blocks: HARDWARE_BLOCKS,
    readouts: HARDWARE_READOUTS,
  },
  { id: "upnp", name: "UPnP", schema: UPNP_DRAWER, blocks: {}, readouts: UPNP_READOUTS },
  { id: "logging", name: "Logging", schema: LOGGING_DRAWER, blocks: LOGTAIL_BLOCKS, readouts: LOGGING_READOUTS },
  { id: "behavior", name: "Behavior", schema: BEHAVIOR_DRAWER, blocks: {}, readouts: BEHAVIOR_READOUTS },
  { id: "visual", name: "Visual settings", schema: VISUAL_DRAWER, blocks: VISUAL_BLOCKS, readouts: VISUAL_READOUTS },
  {
    id: "sigpath",
    name: "Signal path",
    schema: SIGPATH_DRAWER,
    blocks: SIGPATH_BLOCKS,
    readouts: [],
    live: SIGPATH_LIVE,
  },
];

for (const c of CATEGORIES) registerDrawer(c.schema);
