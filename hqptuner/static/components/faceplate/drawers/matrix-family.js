// The Crossfeed and Loudness drawers' schemas, two members of the matrix family: an edit in either lights every
// member's apply group, and Apply in any member applies all. Crossfeed is one block (components/faceplate/drawers/
// Crossfeed.js); Loudness is its gate row, then its block (Loudness.js). Each block names the catalog keys it stages,
// so the tab takes the dot and the apply group follows. The gate's label and paragraph come from the settings metadata.

import { CrossfeedBody } from "./Crossfeed.js";
import { LoudnessBody } from "./Loudness.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

/** The matrix family's gate options, bypass leftmost. */
const ENGAGE_BYPASS = [
  { value: "0", label: "Bypass" },
  { value: "1", label: "Engage" },
];

/** The keys the Crossfeed block stages: Bauer's four, the pipeline rows a Structural install writes, and its fixes. */
const CROSSFEED_KEYS = [
  "crossfeed_enabled",
  "crossfeed_preset",
  "crossfeed_frequency",
  "crossfeed_level",
  "matrix_pipelines",
  "pipelines",
  "matrix_iir2fir",
];

/** The keys the Loudness block stages: both bands' four parameters and the two bounds. */
const LOUDNESS_KEYS = [
  ...["low", "high"].flatMap((side) => ["type", "freq", "steep", "level"].map((p) => `loudness_${side}_${p}`)),
  "loudness_range_low",
  "loudness_range_high",
];

/** @type {DrawerSchema} */
export const CROSSFEED_DRAWER = {
  id: "crossfeed",
  family: "matrix",
  title: "Crossfeed",
  aria: "Crossfeed settings",
  tabs: [{ id: "crossfeed", label: "Crossfeed", body: [{ block: "crossfeed", keys: CROSSFEED_KEYS }] }],
};

/** @type {DrawerSchema} */
export const LOUDNESS_DRAWER = {
  id: "loudness",
  family: "matrix",
  title: "Loudness",
  aria: "Loudness settings",
  tabs: [
    {
      id: "loudness",
      label: "Loudness",
      body: [{ row: { key: "loudness_enabled", options: ENGAGE_BYPASS } }, { block: "loudness", keys: LOUDNESS_KEYS }],
    },
  ],
};

/** The components the two schemas' blocks mount, by name. */
export const FAMILY_BLOCKS = { crossfeed: CrossfeedBody, loudness: LoudnessBody };
